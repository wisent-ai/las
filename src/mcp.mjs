#!/usr/bin/env node
// las — the ecosystem aggregator MCP server.
//
// Federates every sibling agent surface (weles, skarbiec, stado, lem, echo,
// most) into one stdio Model Context Protocol server. On first use it spawns
// each active child's own MCP server, performs the initialize + tools/list
// handshake, and re-exposes each child tool under a "<surface>__<tool>"
// namespace so names never collide. A tools/call is routed to the owning
// child unchanged: las proxies, it never widens a child's security boundary.
import readline from "node:readline";
import {
	activeSurfaces,
	authorizeToolArguments,
	authorizeToolCall,
	authorizeToolResult,
	requiredSkarbiecAgentIdentity,
} from "./registry.mjs";
import { ownCause } from "./registry/client.mjs";
import {
	LAS_ONBOARDING_TOOL,
	runOnboardingAction,
} from "./onboarding/journey.mjs";
import { closeAll, federate, federationStarted } from "./mcp/federation.mjs";
import {
	awaited,
	CODE_INTERNAL_ERROR,
	CODE_INVALID_PARAMS,
	CODE_INVALID_REQUEST,
	CODE_METHOD_NOT_FOUND,
	CODE_NOT_INITIALIZED,
	CODE_PARSE_ERROR,
	fail,
	LAS_VERSION,
	ok,
	PROTOCOL_VERSION,
	send,
} from "./mcp/protocol.mjs";

let initialized = false;

function skarbiecActive() {
	return activeSurfaces().some((surface) => surface.name === "skarbiec");
}

async function initialize(id, params) {
	if (initialized) {
		send(fail(id, CODE_INVALID_REQUEST, "session is already initialized"));
		return;
	}
	if (skarbiecActive()) {
		let expected;
		try {
			expected = requiredSkarbiecAgentIdentity();
		} catch (error) {
			send(
				fail(
					id,
					CODE_INVALID_REQUEST,
					`agent identity is not configured: ${error.message}`,
				),
			);
			return;
		}
		if (
			!params ||
			typeof params !== "object" ||
			Array.isArray(params) ||
			params.agentId !== expected
		) {
			send(fail(id, CODE_INVALID_REQUEST, "agent identity rejected"));
			return;
		}
	}
	initialized = true;
	send(
		ok(id, {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: { tools: {} },
			serverInfo: { name: "las", version: LAS_VERSION },
		}),
	);
}

async function onboarding(id, params, given) {
	const args = params.arguments;
	if (
		given &&
		(!args ||
			typeof args !== "object" ||
			Array.isArray(args) ||
			Object.keys(args).some((key) => key !== "action") ||
			(args.action !== undefined && typeof args.action !== "string"))
	) {
		send(fail(id, CODE_INVALID_PARAMS, "invalid onboarding arguments"));
		return;
	}
	// An absent action is the one the tool's schema declares as its default.
	const action =
		given && args.action !== undefined
			? args.action
			: LAS_ONBOARDING_TOOL.inputSchema.properties.action.default;
	try {
		const result = await runOnboardingAction(action, { client: "mcp" });
		send(ok(id, { content: [{ type: "text", text: JSON.stringify(result) }] }));
	} catch (error) {
		send(fail(id, CODE_INTERNAL_ERROR, error.message));
	}
}

async function callTool(id, params) {
	if (
		params === null ||
		typeof params !== "object" ||
		typeof params.name !== "string"
	) {
		send(fail(id, CODE_INVALID_PARAMS, "params.name must be a string"));
		return;
	}
	const name = params.name;
	// MCP leaves arguments optional: a call without them has none.
	const given = Object.hasOwn(params, "arguments");
	if (name === LAS_ONBOARDING_TOOL.name) {
		await onboarding(id, params, given);
		return;
	}
	const fed = await federate();
	const route = fed.toolIndex.get(name);
	if (!route) {
		send(fail(id, CODE_METHOD_NOT_FOUND, "unknown tool"));
		return;
	}
	try {
		authorizeToolCall(route.surface, route.remoteName);
	} catch (error) {
		send(
			fail(
				id,
				CODE_METHOD_NOT_FOUND,
				`tool is not permitted: ${error.message}`,
			),
		);
		return;
	}
	try {
		const args = authorizeToolArguments(
			route.surface,
			route.remoteName,
			given ? params.arguments : {},
		);
		const result = await route.client.request("tools/call", {
			name: route.remoteName,
			arguments: args,
		});
		send(ok(id, authorizeToolResult(route.surface, route.remoteName, result)));
	} catch (error) {
		const cause = ownCause(error);
		process.stderr.write(
			`las: surface '${route.surface.name}' request failed: ${cause}\n`,
		);
		send(fail(id, CODE_INTERNAL_ERROR, `surface request failed: ${cause}`));
	}
}

async function handle(request) {
	if (
		request === null ||
		typeof request !== "object" ||
		Array.isArray(request)
	) {
		send(fail(null, CODE_INVALID_REQUEST, "a request must be one JSON object"));
		return;
	}
	// A request without an id key is a notification: never answer it.
	if (!awaited(request)) return;
	const { id, method } = request;
	if (typeof method !== "string" || !method) {
		send(fail(id, CODE_INVALID_REQUEST, "method must be a non-empty string"));
		return;
	}
	if (method === "initialize") {
		await initialize(id, request.params);
		return;
	}
	if (!initialized) {
		send(fail(id, CODE_NOT_INITIALIZED, "session is not initialized"));
		return;
	}
	if (
		request.params &&
		typeof request.params === "object" &&
		Object.hasOwn(request.params, "agentId")
	) {
		send(
			fail(
				id,
				CODE_INVALID_REQUEST,
				"agent identity is fixed at initialization",
			),
		);
		return;
	}
	if (method === "ping") {
		send(ok(id, {}));
		return;
	}
	if (method === "tools/list") {
		const fed = await federate();
		send(ok(id, { tools: fed.tools }));
		return;
	}
	if (method === "tools/call") {
		await callTool(id, request.params);
		return;
	}
	send(fail(id, CODE_METHOD_NOT_FOUND, "method not found"));
}

function serve() {
	const rl = readline.createInterface({ input: process.stdin });
	// Every handler currently in flight. On disconnect we await these so a
	// pending tools/call round-trip to a child finishes and flushes its response
	// before we close the children — otherwise the non-interactive batch case
	// races child shutdown against the child's own reply.
	const inFlight = new Set();
	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let request;
		try {
			request = JSON.parse(trimmed);
		} catch (error) {
			send(fail(null, CODE_PARSE_ERROR, `parse error: ${error.message}`));
			return;
		}
		const p = handle(request)
			.catch((error) => {
				// Child failures are caught where the child is called, so what
				// reaches here is Las's own and may be named. A request with an
				// id is still answered: its caller would otherwise wait for ever.
				process.stderr.write(`las: request handler failed: ${error.message}\n`);
				if (awaited(request))
					send(
						fail(
							request.id,
							CODE_INTERNAL_ERROR,
							`las could not answer this request: ${error.message}`,
						),
					);
			})
			.finally(() => {
				inFlight.delete(p);
			});
		inFlight.add(p);
	});
	rl.on("close", async () => {
		// Client disconnected. Let any in-flight federation build AND any pending
		// request handlers finish (so their responses flush), then close every
		// spawned child. With all children closed and stdin ended, the event loop
		// drains and the process exits on its own — no forced exit, no limit. A
		// federation that failed was answered to the request that asked for it.
		await Promise.allSettled([federationStarted(), ...inFlight]);
		closeAll();
	});
}

serve();
