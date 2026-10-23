// `las release …`: what an operator runs on their own machine to produce the
// owner-signed release Las verifies. `keygen` makes an Ed25519 signing key and
// trusts its public half, `entry` describes one built surface as a manifest
// entry, and `sign` writes the detached signature over a manifest. The private
// key stays in the owner-only file the operator names; Las never reads it when
// it serves, and no command prints it.
import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign,
} from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	fsyncSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { connect, handshake } from "../registry/client.mjs";
import {
	buildChildEnvironment,
	validateCommand,
	validateCwd,
} from "../registry/launch.mjs";
import { SURFACES } from "../registry/surfaces.mjs";
import {
	DOMAIN,
	fileSha256,
	jsonSha256,
	KEY_ID,
	ownerOnlyFile,
	readTrustStore,
	TYPE,
	validateManifest,
} from "./signed-manifest.mjs";
import { assertExactKeys, parseStrictJson } from "./strict-json.mjs";

// Read and write for the owner alone (chmod(2) S_IRUSR | S_IWUSR).
const OWNER_ONLY_MODE = constants.S_IRUSR | constants.S_IWUSR;
const ENVELOPE_VERSION = 1;
const STORE_VERSION = 1;

export const RELEASE_USAGE = [
	{
		name: "release",
		usage: "release keygen --key-id ID --private-key FILE --trust-store FILE",
		help: "make an Ed25519 signing key (owner-only file) and add its public key to the trust store",
	},
	{
		name: "release",
		usage: "release entry <surface> [--code-path FILE]",
		help: "print the signed-manifest entry for one built surface (digests, argv, env names, tool schemas)",
	},
	{
		name: "release",
		usage:
			"release sign --key-id ID --private-key FILE --manifest FILE --signature FILE [--trust-store FILE] [--watermark FILE]",
		help: "write the detached signature over a manifest; refuses a sequence the watermark already holds",
	},
];

function options(args, names, label) {
	const found = {};
	const rest = [];
	for (let index = 0; index < args.length; index += 1) {
		const word = args[index];
		if (!word.startsWith("--")) {
			rest.push(word);
			continue;
		}
		const name = word.slice("--".length);
		if (!names.includes(name))
			throw new Error(`release ${label}: unknown option '${word}'`);
		const value = args[index + 1];
		if (value === undefined || value.startsWith("--"))
			throw new Error(`release ${label}: ${word} needs a value`);
		found[name] = value;
		index += 1;
	}
	return { found, rest };
}

function required(found, name, label) {
	const value = found[name];
	if (!value) throw new Error(`release ${label}: --${name} is required`);
	return path.resolve(value);
}

function keyId(found, label) {
	const value = found["key-id"];
	if (typeof value !== "string" || !KEY_ID.test(value))
		throw new Error(
			`release ${label}: --key-id must match ${KEY_ID.source} (letters, digits, '.', '_', '-')`,
		);
	return value;
}

// Replace `file` whole through an owner-only temporary file, so a reader
// sees the old document or the new one and never a part.
function writeOwnerOnly(file, text) {
	const temporary = `${file}.${process.pid}.tmp`;
	const fd = openSync(
		temporary,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
		OWNER_ONLY_MODE,
	);
	try {
		writeFileSync(fd, text, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(temporary, file);
}

function keygen(args) {
	const { found, rest } = options(
		args,
		["key-id", "private-key", "trust-store"],
		"keygen",
	);
	if (rest.length)
		throw new Error(`release keygen: unexpected argument '${rest[0]}'`);
	const id = keyId(found, "keygen");
	const privateFile = required(found, "private-key", "keygen");
	const storeFile = required(found, "trust-store", "keygen");
	let store = { version: STORE_VERSION, keys: [] };
	if (existsSync(storeFile)) {
		ownerOnlyFile(storeFile, "las trust store");
		store = parseStrictJson(readFileSync(storeFile), "las trust store");
		assertExactKeys(store, ["version", "keys"], [], "las trust store");
		if (store.version !== STORE_VERSION || !Array.isArray(store.keys))
			throw new Error("las trust store: unsupported schema");
		if (store.keys.some((entry) => entry?.key_id === id))
			throw new Error(`las trust store: key_id '${id}' is already trusted`);
	}
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	// `wx` refuses to replace a key that already exists at that path.
	writeFileSync(
		privateFile,
		privateKey.export({ type: "pkcs8", format: "pem" }),
		{ flag: "wx", mode: OWNER_ONLY_MODE },
	);
	const spki = publicKey
		.export({ type: "spki", format: "der" })
		.toString("base64");
	store.keys.push({ key_id: id, public_key_spki: spki });
	writeOwnerOnly(storeFile, `${JSON.stringify(store, null, 2)}\n`);
	return {
		key_id: id,
		private_key: privateFile,
		trust_store: storeFile,
		public_key_spki: spki,
	};
}

function watermarkSequence(file) {
	ownerOnlyFile(file, "las watermark");
	const current = parseStrictJson(readFileSync(file), "las watermark");
	assertExactKeys(current, ["version", "sequence"], [], "las watermark");
	if (!Number.isSafeInteger(current.sequence))
		throw new Error("las watermark: invalid schema");
	return current.sequence;
}

function signManifest(args) {
	const { found, rest } = options(
		args,
		[
			"key-id",
			"private-key",
			"manifest",
			"signature",
			"trust-store",
			"watermark",
		],
		"sign",
	);
	if (rest.length)
		throw new Error(`release sign: unexpected argument '${rest[0]}'`);
	const id = keyId(found, "sign");
	const privateFile = required(found, "private-key", "sign");
	const manifestFile = required(found, "manifest", "sign");
	const signatureFile = required(found, "signature", "sign");
	ownerOnlyFile(privateFile, "las signing key");
	const privateKey = createPrivateKey(readFileSync(privateFile));
	if (privateKey.asymmetricKeyType !== "ed25519")
		throw new Error("las signing key: not an Ed25519 private key");
	const payload = readFileSync(manifestFile);
	const manifest = parseStrictJson(payload, "las manifest");
	validateManifest(manifest);
	if (found.watermark) {
		const held = watermarkSequence(path.resolve(found.watermark));
		if (manifest.sequence <= held)
			throw new Error(
				`release sign: manifest sequence ${manifest.sequence} is not above the watermark's ${held}; raise "sequence"`,
			);
	}
	if (found["trust-store"]) {
		const trusted = readTrustStore(path.resolve(found["trust-store"]), id);
		const own = createPublicKey(privateKey).export({
			type: "spki",
			format: "der",
		});
		if (!own.equals(trusted.export({ type: "spki", format: "der" })))
			throw new Error(
				`release sign: the trust store's key '${id}' is not this private key's public key`,
			);
	}
	const signature = sign(null, Buffer.concat([DOMAIN, payload]), privateKey);
	writeFileSync(
		signatureFile,
		`${JSON.stringify({ type: TYPE, version: ENVELOPE_VERSION, key_id: id, signature: signature.toString("base64") })}\n`,
	);
	return {
		manifest: manifestFile,
		signature: signatureFile,
		key_id: id,
		sequence: manifest.sequence,
		expires_at: manifest.expires_at,
	};
}

async function entry(args) {
	const { found, rest } = options(args, ["code-path"], "entry");
	if (rest.length !== 1)
		throw new Error("release entry: name exactly one surface");
	const surface = SURFACES.find((candidate) => candidate.name === rest[0]);
	if (!surface || surface.name === "finance")
		throw new Error(
			`release entry: '${rest[0]}' is not a surface the signed manifest admits`,
		);
	const codePath = found["code-path"]
		? path.resolve(found["code-path"])
		: (surface.args.find((arg) => path.isAbsolute(arg)) ?? surface.command);
	const client = connect(surface, (admitted) => {
		validateCwd(admitted);
		validateCommand(admitted);
		return buildChildEnvironment(admitted);
	});
	let advertised;
	try {
		advertised = await handshake(client);
	} finally {
		client.close();
	}
	if (!Array.isArray(advertised))
		throw new Error(`release entry: ${surface.name} answered no tool list`);
	const byName = new Map(advertised.map((tool) => [tool?.name, tool]));
	const names = surface.allowTools ?? advertised.map((tool) => tool?.name);
	return {
		name: surface.name,
		command: surface.command,
		cwd: surface.cwd,
		argv: [...surface.args],
		env_names: [...surface.envAllowlist],
		binary_sha256: fileSha256(surface.command),
		code_path: codePath,
		code_sha256: fileSha256(codePath),
		tools: names.map((name) => {
			const tool = byName.get(name);
			if (!tool?.inputSchema)
				throw new Error(
					`release entry: ${surface.name} does not advertise '${name}' with an input schema`,
				);
			return {
				name,
				input_schema_sha256: jsonSha256(tool.inputSchema),
				credential_templates: [],
			};
		}),
	};
}

/** Run `las release <action> …` and return the answer to print. */
export async function cmdRelease(args) {
	const [action, ...rest] = args;
	if (action === "keygen") return keygen(rest);
	if (action === "sign") return signManifest(rest);
	if (action === "entry") return entry(rest);
	throw new Error(
		`release: unknown action '${action ?? ""}' (keygen, entry or sign)`,
	);
}
