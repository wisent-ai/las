// The stdio JSON-RPC client las reaches one child surface with: spawn it,
// read one response per line, and perform the MCP handshake.
//
// Split out of `src/registry.mjs`, which had grown past the
// three-hundred-line limit; which surfaces exist, and what each one is
// allowed to advertise, stay there.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import {
	JSONRPC_VERSION,
	LAS_VERSION,
	PROTOCOL_VERSION,
} from "../mcp/protocol.mjs";

const CLIENT_NAME = "las";

/**
 * A JSON-RPC error the child answered. Its message is the child's own text,
 * which never reaches a Las response or Las stderr: `ownCause` names it by
 * surface and code instead.
 */
export class ChildError extends Error {
	constructor(surface, error) {
		super(
			typeof error.message === "string"
				? error.message
				: `${surface} answered a JSON-RPC error without a message`,
		);
		this.surface = surface;
		this.code = error.code;
	}
}

/** What Las may say about `error`: its own message, or the child's code. */
export function ownCause(error) {
	if (error instanceof ChildError)
		return Number.isInteger(error.code)
			? `${error.surface} answered JSON-RPC error ${error.code}; its text is withheld`
			: `${error.surface} answered a JSON-RPC error without a numeric code; its text is withheld`;
	return error.message;
}
/**
 * Spawn a child surface's MCP server and return a small JSON-RPC client:
 * `{ surface, request(method, params) -> Promise<result>, close() }`.
 *
 * Resolution is completion-based: a pending request settles when the child
 * answers, or rejects if the child errors or exits first. No limit is
 * imposed on how long a child may take — it runs to completion.
 *
 * `admit` is the caller's own gate: it validates the surface and returns
 * the environment the child is allowed to see, so this module spawns and
 * speaks the protocol and decides nothing about authority.
 */
export function connect(surface, admit) {
	const env = admit(surface);
	const child = spawn(surface.command, surface.args, {
		cwd: surface.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env,
	});

	const pending = new Map();
	let fatal = null;

	function failAll(err) {
		fatal = err;
		for (const entry of pending.values()) entry.reject(err);
		pending.clear();
	}

	child.on("error", (err) => failAll(err));
	// A write to a child that already exited fails its requests with the
	// system's cause instead of an unhandled stream error.
	child.stdin.on("error", (err) => failAll(err));
	child.on("exit", (codeVal) => {
		if (pending.size) failAll(new Error(`${surface.name} exited (${codeVal})`));
	});
	// Child diagnostics belong on its own stderr; las does not forward them to
	// its stdout, which must stay a clean protocol stream.
	child.stderr.on("data", () => {});

	const rl = readline.createInterface({ input: child.stdout });
	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let msg;
		try {
			msg = JSON.parse(trimmed);
		} catch (parseError) {
			// The protocol stream carries JSON-RPC only. A line that is not
			// JSON may be the answer a request waits on, and requests have no
			// time limit, so ignoring it left the call pending for ever. The
			// child's text stays out of the message: child-controlled output
			// is never copied into a response or las stderr.
			failAll(
				new Error(
					`${surface.name} wrote a line that is not JSON-RPC on its protocol stream (${parseError.name})`,
				),
			);
			return;
		}
		const rid = msg && msg.id;
		if (rid === undefined || rid === null) return;
		const entry = pending.get(rid);
		if (!entry) return;
		pending.delete(rid);
		if (msg.error) entry.reject(new ChildError(surface.name, msg.error));
		else entry.resolve(msg.result);
	});

	function request(method, params) {
		return new Promise((resolve, reject) => {
			if (fatal) {
				reject(fatal);
				return;
			}
			const id = randomUUID();
			pending.set(id, { resolve, reject });
			const payload = JSON.stringify({
				jsonrpc: JSONRPC_VERSION,
				id,
				method,
				params,
			});
			child.stdin.write(payload + "\n");
		});
	}

	function close() {
		rl.close();
		child.stdin.end();
		child.kill();
	}

	return { surface, request, close };
}

// Standard MCP handshake against a connected child: initialize, then list its
// tools. Returns the child's tool array (possibly empty).
export async function handshake(client) {
	await client.request("initialize", {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: CLIENT_NAME, version: LAS_VERSION },
	});
	const result = await client.request("tools/list", {});
	if (result === null || typeof result !== "object")
		throw new Error(
			`${client.surface.name}: tools/list answered no result object`,
		);
	return result.tools;
}
