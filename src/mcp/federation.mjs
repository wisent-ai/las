// The children Las federates: each active surface's MCP server, spawned once,
// its tools re-exposed under "<surface>__<tool>".
import {
	activeSurfaces,
	authorizeTools,
	connect,
	handshake,
} from "../registry.mjs";
import { ownCause } from "../registry/client.mjs";
import { LAS_ONBOARDING_TOOL } from "../onboarding/journey.mjs";

const SEP = "__";

// Every child client ever spawned this session, so cleanup on disconnect can
// close all of them even if federation is still in progress.
const spawnedClients = new Set();

// Federation is built once; the PROMISE is memoized so a disconnect can await
// an in-flight build before closing children (the response still flushes).
// federation resolves to { toolIndex, tools }.
let federationPromise = null;

export function federate() {
	if (!federationPromise) federationPromise = buildFederation();
	return federationPromise;
}

/** The build in flight or done, or null when no request asked for one. */
export function federationStarted() {
	return federationPromise;
}

async function buildFederation() {
	const toolIndex = new Map();
	const tools = [];
	for (const surface of activeSurfaces()) {
		let client;
		try {
			client = connect(surface);
			spawnedClients.add(client);
			const childTools = authorizeTools(surface, await handshake(client));
			for (const tool of childTools) {
				const namespaced = `${surface.name}${SEP}${tool.name}`;
				toolIndex.set(namespaced, { client, remoteName: tool.name, surface });
				// MCP leaves a tool's description optional; one without it is
				// labelled by its surface alone.
				const described =
					typeof tool.description === "string" && tool.description.trim()
						? `[${surface.name}] ${tool.description.trim()}`
						: `[${surface.name}]`;
				// authorizeTools admits only tools whose inputSchema is an object.
				tools.push({
					name: namespaced,
					description: described,
					inputSchema: tool.inputSchema,
				});
			}
		} catch (error) {
			// The child's own error text is withheld; Las's cause is named.
			process.stderr.write(
				`las: surface '${surface.name}' unavailable: ${ownCause(error)}\n`,
			);
		}
	}
	tools.push(LAS_ONBOARDING_TOOL);
	return { toolIndex, tools };
}

export function closeAll() {
	for (const client of spawnedClients) client.close();
	spawnedClients.clear();
}
