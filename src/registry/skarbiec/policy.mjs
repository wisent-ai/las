// The Skarbiec boundary: the broker tools Las admits from the Skarbiec child,
// their pinned schemas and descriptions, and the purpose/resource/target
// taxonomy their arguments must fall in. The answers Las passes back are
// checked in `results.mjs` beside this file.
//
// Split out of `src/registry.mjs`, which had grown past the
// three-hundred-line limit; the generic signed-release checks stay there.
import { jsonSha256 } from "../../release/signed-manifest.mjs";

const NON_EMPTY_STRING = { type: "string", minLength: 1 };
const BOUNDED_CAPABILITY = {
	purpose: NON_EMPTY_STRING,
	resource: NON_EMPTY_STRING,
	target: NON_EMPTY_STRING,
	ttl_seconds: { type: "integer", minimum: 1 },
	max_uses: { type: "integer", minimum: 1 },
};
const BOUNDED_CAPABILITY_REQUIRED = [
	"purpose",
	"resource",
	"target",
	"ttl_seconds",
	"max_uses",
];

// The broker tools in the order the owner-signed release lists them.
export const SKARBIEC_TOOL_SCHEMAS = new Map([
	[
		"health",
		{
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
	],
	[
		"capability_available",
		{
			type: "object",
			properties: BOUNDED_CAPABILITY,
			required: BOUNDED_CAPABILITY_REQUIRED,
			additionalProperties: false,
		},
	],
	[
		"capability_request",
		{
			type: "object",
			properties: {
				...BOUNDED_CAPABILITY,
				delegation_depth: { type: "integer", minimum: 0 },
			},
			required: BOUNDED_CAPABILITY_REQUIRED,
			additionalProperties: false,
		},
	],
	[
		"access_request_status",
		{
			type: "object",
			properties: { request_id: NON_EMPTY_STRING },
			required: ["request_id"],
			additionalProperties: false,
		},
	],
]);
const SKARBIEC_TOOL_SCHEMA_DIGESTS = new Map(
	[...SKARBIEC_TOOL_SCHEMAS].map(([name, schema]) => [
		name,
		jsonSha256(schema),
	]),
);
export const SKARBIEC_TOOL_DESCRIPTIONS = new Map([
	["health", "Return a non-sensitive broker health summary."],
	[
		"capability_available",
		"Check whether the authenticated agent may request an exactly bounded capability. Returns only availability.",
	],
	[
		"capability_request",
		"Request an opaque, bounded capability for the authenticated agent. Returns the issued opaque capability ID, or a pending access request ID when a person must decide first.",
	],
	[
		"access_request_status",
		"Return the state of an access request this agent filed: pending, approved (with its opaque capability ID), denied or withdrawn.",
	],
]);
export const CAPABILITY_ID = /^[0-9a-f]{64}$/;
// RFC 9562 section 4 text form, lowercase as Skarbiec writes it.
export const REQUEST_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKARBIEC_CAPABILITY_TAXONOMY = new Map([
	["weles.browser.fill", { target: "weles", prefixes: ["origin:"] }],
	["weles.captcha.solve", { target: "weles", prefixes: ["provider:"] }],
	["weles.sms.verify", { target: "weles", prefixes: ["provider:"] }],
	["weles.proxy.authenticate", { target: "weles", prefixes: ["proxy:"] }],
	["weles.brama.sign", { target: "weles", prefixes: ["brama:", "agent:"] }],
	[
		"most.service.authenticate",
		{ target: "most-service", resources: ["credential:most/service"] },
	],
	[
		"most.database.connect",
		{ target: "most-service", resources: ["credential:most/database"] },
	],
	[
		"most.twilio.authenticate",
		{ target: "most-service", resources: ["credential:most/twilio"] },
	],
	[
		"most.attachment.sign",
		{
			target: "most-service",
			resources: ["credential:most/attachment-signing"],
		},
	],
	[
		"most.remote-worker.authenticate",
		{ target: "most-service", resources: ["credential:most/remote-worker"] },
	],
	["brama.provider.authenticate", { target: "brama", prefixes: ["provider:"] }],
	["brama.supabase.connect", { target: "brama", prefixes: ["supabase:"] }],
	["brama.request.sign", { target: "brama", prefixes: ["agent:"] }],
	[
		"singularity.brama.bootstrap",
		{ target: "singularity-bootstrap", prefixes: ["brama:"] },
	],
	[
		"singularity.most.bootstrap",
		{ target: "singularity-bootstrap", prefixes: ["most:"] },
	],
]);

export function verifySkarbiecReleasePolicy(release) {
	if (release.name !== "skarbiec") return;
	if (release.tools.length !== SKARBIEC_TOOL_SCHEMA_DIGESTS.size)
		throw new Error(
			"skarbiec: signed tool policy does not match the capability broker v1 surface",
		);
	for (const tool of release.tools) {
		if (
			SKARBIEC_TOOL_SCHEMA_DIGESTS.get(tool.name) !== tool.input_schema_sha256
		)
			throw new Error(
				"skarbiec: signed tool schema does not match the capability broker v1 surface",
			);
	}
}

export function nonNegativeInteger(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

function contractRefusal() {
	return new Error(
		"skarbiec: capability arguments do not match the broker v1 contract",
	);
}

function plainText(value) {
	return (
		typeof value === "string" &&
		value.trim() === value &&
		value.length > 0 &&
		value !== "*" &&
		!value.includes("\0")
	);
}

function validateCapabilityTaxonomy(args) {
	const rule = SKARBIEC_CAPABILITY_TAXONOMY.get(args.purpose);
	if (!rule || args.target !== rule.target || args.resource.includes("*")) {
		throw new Error(
			"skarbiec: capability target is outside the contract taxonomy",
		);
	}
	const allowed = rule.resources
		? rule.resources.includes(args.resource)
		: rule.prefixes.some(
				(prefix) =>
					args.resource.startsWith(prefix) &&
					args.resource.length > prefix.length,
			);
	if (!allowed)
		throw new Error(
			"skarbiec: capability resource is outside the contract taxonomy",
		);
}

export function validateSkarbiecArguments(remoteName, args) {
	const schema = SKARBIEC_TOOL_SCHEMAS.get(remoteName);
	if (
		!schema ||
		Object.keys(args).some((name) => !Object.hasOwn(schema.properties, name))
	)
		throw contractRefusal();
	if (remoteName === "health") return;
	if (remoteName === "access_request_status") {
		if (!REQUEST_ID.test(args.request_id ?? ""))
			throw new Error(
				"skarbiec: request_id must be the access request ID capability_request answered",
			);
		return;
	}
	for (const name of ["purpose", "resource", "target"])
		if (!plainText(args[name])) throw contractRefusal();
	validateCapabilityTaxonomy(args);
	// How long, how often and how deep a capability may be used is Skarbiec's policy: it holds the
	// ceilings and refuses a request beyond them with its reason. Las only checks the shape.
	if (
		!Number.isSafeInteger(args.ttl_seconds) ||
		args.ttl_seconds < 1 ||
		!Number.isSafeInteger(args.max_uses) ||
		args.max_uses < 1
	) {
		throw new Error(
			"skarbiec: ttl_seconds and max_uses must be positive whole numbers",
		);
	}
	if (
		Object.hasOwn(args, "delegation_depth") &&
		!nonNegativeInteger(args.delegation_depth)
	) {
		throw new Error(
			"skarbiec: delegation_depth must be a whole number of at least zero",
		);
	}
}
