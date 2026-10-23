// The exact answers Las passes back from the Skarbiec broker: one text
// content item whose JSON is the broker v1 result for the tool called.
import { CAPABILITY_ID, nonNegativeInteger, REQUEST_ID } from "./policy.mjs";

const SKARBIEC_HEALTH_FIELDS = new Set([
	"ok",
	"service",
	"wire",
	"policy_sequence",
	"registry_sequence",
	"active_capabilities",
	"anomaly_count",
]);
const UNDECIDED_REQUEST_STATES = new Set(["pending", "denied", "withdrawn"]);

function exactObject(value, fields, label) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`skarbiec: invalid ${label} result`);
	const keys = Object.keys(value);
	if (keys.length !== fields.size || keys.some((key) => !fields.has(key)))
		throw new Error(`skarbiec: invalid ${label} result`);
}

function validHealth(payload) {
	exactObject(payload, SKARBIEC_HEALTH_FIELDS, "health");
	return (
		payload.ok === true &&
		payload.service === "skarbiec-capability-broker" &&
		payload.wire === "skarbiec.redeem.v1" &&
		Number.isSafeInteger(payload.policy_sequence) &&
		payload.policy_sequence >= 1 &&
		Number.isSafeInteger(payload.registry_sequence) &&
		payload.registry_sequence >= 1 &&
		nonNegativeInteger(payload.active_capabilities) &&
		nonNegativeInteger(payload.anomaly_count)
	);
}

function validCapabilityRequest(payload) {
	if (payload?.status === "pending") {
		exactObject(
			payload,
			new Set(["status", "request_id"]),
			"capability request",
		);
		return (
			typeof payload.request_id === "string" &&
			REQUEST_ID.test(payload.request_id)
		);
	}
	exactObject(
		payload,
		new Set(["status", "capability_id"]),
		"capability request",
	);
	return (
		payload.status === "issued" &&
		typeof payload.capability_id === "string" &&
		CAPABILITY_ID.test(payload.capability_id)
	);
}

function validRequestStatus(payload, requestId) {
	const approved = payload?.state === "approved";
	exactObject(
		payload,
		new Set(
			approved
				? ["request_id", "state", "capability_id"]
				: ["request_id", "state"],
		),
		"access request status",
	);
	return (
		payload.request_id === requestId &&
		(approved
			? typeof payload.capability_id === "string" &&
				CAPABILITY_ID.test(payload.capability_id)
			: UNDECIDED_REQUEST_STATES.has(payload.state))
	);
}

const PAYLOAD_RULES = new Map([
	["health", [validHealth, "health"]],
	[
		"capability_available",
		[
			(payload) => {
				exactObject(payload, new Set(["available"]), "capability availability");
				return typeof payload.available === "boolean";
			},
			"capability availability",
		],
	],
	["capability_request", [validCapabilityRequest, "capability request"]],
	[
		"access_request_status",
		[
			(payload, args) => validRequestStatus(payload, args.request_id),
			"access request status",
		],
	],
]);

/**
 * Admit one Skarbiec `tools/call` result: exactly one text content item whose
 * JSON is the broker v1 answer for `remoteName`, given the `args` Las sent.
 */
export function authorizeSkarbiecResult(remoteName, args, result) {
	const rule = PAYLOAD_RULES.get(remoteName);
	if (!rule)
		throw new Error("skarbiec: tool is not permitted by signed policy");
	exactObject(result, new Set(["content"]), "MCP envelope");
	if (!Array.isArray(result.content) || result.content.length !== 1)
		throw new Error("skarbiec: invalid MCP content result");
	const content = result.content[0];
	exactObject(content, new Set(["type", "text"]), "MCP content");
	if (content.type !== "text" || typeof content.text !== "string")
		throw new Error("skarbiec: invalid MCP content result");
	let payload;
	try {
		payload = JSON.parse(content.text);
	} catch {
		throw new Error("skarbiec: invalid capability result");
	}
	const [valid, label] = rule;
	if (!valid(payload, args))
		throw new Error(`skarbiec: invalid ${label} result`);
	return result;
}
