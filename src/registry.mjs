// Registry of the child agent surfaces that las federates, plus the stdio
// JSON-RPC client used to reach each one.
//
// las (Polish for "forest") gathers every sibling agent surface into a single
// tree, including Tama's adaptive hook enforcement surface. Each child already speaks the
// Model Context Protocol over stdio; las only spawns a child, performs the
// initialize + tools/list handshake, and routes calls. It never widens any
// child's own security boundary — a read-only child stays read-only here.
import { createHash } from "node:crypto";
import { jsonSha256 } from "./release/signed-manifest.mjs";
import { connect as connectChild } from "./registry/client.mjs";
import {
	buildChildEnvironment,
	requiredSkarbiecAgentIdentity,
	validateCommand,
	validateCwd,
	validateReleaseBinding,
} from "./registry/launch.mjs";
import { releaseFor } from "./registry/release.mjs";
import {
	authorizeSkarbiecResult,
	SKARBIEC_TOOL_DESCRIPTIONS,
	validateSkarbiecArguments,
	verifySkarbiecReleasePolicy,
} from "./registry/skarbiec.mjs";

export { SURFACES } from "./registry/surfaces.mjs";
export {
	activeSurfaces,
	surfaceConfigured,
	surfaceUnconfiguredReason,
} from "./registry/release.mjs";
export { buildChildEnvironment, requiredSkarbiecAgentIdentity };

const FINANCE_POLICY_DOCUMENT = JSON.stringify({
	version: 1,
	surface: "finance",
	tools: ["finance_propose", "finance_status", "finance_cancel"],
	blocked: ["execute", "approve", "sign", "broadcast", "beneficiary", "policy"],
});
export const FINANCE_POLICY_FINGERPRINT =
	"d00d7b06f53f9c9e49dfc7313f77a0d2a9aa77260b053b44670dbdeac4a39cff";
const FINANCE_ALLOWED_TOOLS = new Set([
	"finance_propose",
	"finance_status",
	"finance_cancel",
]);
const FINANCE_FORBIDDEN_TOOL =
	/(?:^|[^a-z])(?:execute|approve|sign|broadcast|beneficiary|policy)(?:[^a-z]|$)/i;

function verifyFinancePolicyFingerprint() {
	const fingerprint = createHash("sha256")
		.update(FINANCE_POLICY_DOCUMENT)
		.digest("hex");
	if (fingerprint !== FINANCE_POLICY_FINGERPRINT) {
		throw new Error("finance: local tool policy fingerprint mismatch");
	}
}

export function authorizeTools(surface, tools) {
	if (!Array.isArray(tools))
		throw new Error(`${surface.name}: invalid tools/list response`);
	const unique = new Map();
	for (const tool of tools) {
		if (
			!tool ||
			typeof tool.name !== "string" ||
			unique.has(tool.name) ||
			!tool.inputSchema ||
			typeof tool.inputSchema !== "object" ||
			Array.isArray(tool.inputSchema)
		) {
			throw new Error(`${surface.name}: invalid or duplicate tool declaration`);
		}
		unique.set(tool.name, tool);
	}
	if (surface.name !== "finance") {
		const release = releaseFor(surface);
		verifySkarbiecReleasePolicy(release);
		if (unique.size !== release.tools.length)
			throw new Error(
				`${surface.name}: child tool surface does not match signed manifest`,
			);
		for (const expected of release.tools) {
			const advertised = unique.get(expected.name);
			if (!advertised)
				throw new Error(
					`${surface.name}: child tool surface does not match signed manifest`,
				);
			if (jsonSha256(advertised.inputSchema) !== expected.input_schema_sha256)
				throw new Error(
					`${surface.name}: input schema drift for '${expected.name}'`,
				);
		}
		return release.tools.map((expected) => {
			const advertised = unique.get(expected.name);
			if (surface.name !== "skarbiec") return advertised;
			return {
				name: expected.name,
				description: SKARBIEC_TOOL_DESCRIPTIONS.get(expected.name),
				inputSchema: structuredClone(advertised.inputSchema),
			};
		});
	}

	verifyFinancePolicyFingerprint();
	if ([...unique.keys()].some((name) => FINANCE_FORBIDDEN_TOOL.test(name))) {
		throw new Error("finance: child advertised a prohibited financial verb");
	}
	if (
		unique.size !== FINANCE_ALLOWED_TOOLS.size ||
		[...FINANCE_ALLOWED_TOOLS].some((name) => !unique.has(name))
	) {
		throw new Error(
			"finance: child tool policy does not match the locally bound proposal-only policy",
		);
	}
	return [...FINANCE_ALLOWED_TOOLS].map((name) => unique.get(name));
}

export function authorizeToolCall(surface, remoteName) {
	if (typeof remoteName !== "string")
		throw new Error(`${surface.name}: invalid tool name`);
	if (surface.name === "finance") {
		verifyFinancePolicyFingerprint();
		if (
			FINANCE_FORBIDDEN_TOOL.test(remoteName) ||
			!FINANCE_ALLOWED_TOOLS.has(remoteName)
		) {
			throw new Error(
				"finance: tool is not permitted by the proposal-only policy",
			);
		}
		return;
	}
	if (!releaseFor(surface).tools.some((tool) => tool.name === remoteName))
		throw new Error(`${surface.name}: tool is not permitted by signed policy`);
}

export function authorizeToolArguments(surface, remoteName, modelArguments) {
	if (
		!modelArguments ||
		typeof modelArguments !== "object" ||
		Array.isArray(modelArguments)
	)
		throw new Error(`${surface.name}: tool arguments must be an object`);
	if (surface.name === "finance") return modelArguments;
	const tool = releaseFor(surface).tools.find(
		(entry) => entry.name === remoteName,
	);
	if (!tool)
		throw new Error(`${surface.name}: tool is not permitted by signed policy`);
	const authorized = structuredClone(modelArguments);
	for (const template of tool.credential_templates) {
		if (Object.prototype.hasOwnProperty.call(authorized, template.argument))
			throw new Error(
				`${surface.name}: model arguments may not override credential template '${template.argument}'`,
			);
		authorized[template.argument] = structuredClone(template.value);
	}
	if (surface.name === "skarbiec")
		validateSkarbiecArguments(remoteName, authorized);
	return authorized;
}

/**
 * Admit a child's `tools/call` result. `args` are the arguments Las sent,
 * which a Skarbiec answer must refer back to.
 */
export function authorizeToolResult(surface, remoteName, args, result) {
	if (surface.name !== "skarbiec") return result;
	return authorizeSkarbiecResult(remoteName, args, result);
}

// Spawn a child surface after this module's own gates admit it. The
// protocol client lives beside this file; the decision to admit does not.
export function connect(surface) {
	return connectChild(surface, (admitted) => {
		validateCwd(admitted);
		validateCommand(admitted);
		validateReleaseBinding(admitted, verifySkarbiecReleasePolicy);
		return buildChildEnvironment(admitted);
	});
}

export { handshake } from "./registry/client.mjs";
