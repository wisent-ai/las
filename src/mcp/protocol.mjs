// The JSON-RPC messages Las speaks, one per stdio line, as server and as the
// client of each child surface.
import { readFileSync } from "node:fs";

export const JSONRPC_VERSION = "2.0"; // https://www.jsonrpc.org/specification
export const PROTOCOL_VERSION = "2024-11-05";
/** The version Las names in MCP handshakes: the one its package declares. */
export const LAS_VERSION = JSON.parse(
	readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;
// The error codes JSON-RPC 2.0 defines, and two from the server-error range it
// leaves to the implementation: https://www.jsonrpc.org/specification#error_object
export const CODE_PARSE_ERROR = -32700; // https://www.jsonrpc.org/specification#error_object
export const CODE_INVALID_REQUEST = -32600; // https://www.jsonrpc.org/specification#error_object
export const CODE_METHOD_NOT_FOUND = -32601; // https://www.jsonrpc.org/specification#error_object
export const CODE_INVALID_PARAMS = -32602; // https://www.jsonrpc.org/specification#error_object
export const CODE_INTERNAL_ERROR = -32000; // https://www.jsonrpc.org/specification#error_object
export const CODE_NOT_INITIALIZED = -32002; // https://www.jsonrpc.org/specification#error_object

export function send(message) {
	process.stdout.write(JSON.stringify(message) + "\n");
}

export function ok(id, result) {
	return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function fail(id, code, message) {
	return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

/** A JSON-RPC message that names an id: its caller waits on the answer. */
export function awaited(request) {
	return (
		request !== null &&
		typeof request === "object" &&
		!Array.isArray(request) &&
		Object.hasOwn(request, "id")
	);
}
