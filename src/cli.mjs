#!/usr/bin/env node
// las — command-line view of the federated ecosystem agent surface.
//
// Reads the same registry the aggregator server uses (one source of truth for
// which surfaces exist) and offers three read-only views:
//   las list                 — every federated surface + its one-line summary
//   las tools [surface...]    — advertised tools, spawning each child to ask
//   las check [surface...]    — connectivity: spawn + initialize handshake
// With no surface arguments, tools/check cover every active surface (honoring
// the LAS_ONLY / LAS_SKIP environment filters).
import { SURFACES, activeSurfaces, connect, handshake } from "./registry.mjs";

const SEP = "__";

function usage() {
  process.stderr.write(
    [
      "usage: las <command> [surface...]",
      "  list                 list every federated surface",
      "  tools [surface...]   list advertised tools (spawns each child)",
      "  check [surface...]   connectivity handshake against each child",
      "",
      "surfaces: " + SURFACES.map((s) => s.name).join(", "),
      "env: LAS_ONLY=a,b (allow-list)  LAS_SKIP=a,b (deny-list)",
    ].join("\n") + "\n",
  );
}

// Resolve the surfaces a command should act on: explicit names (validated
// against the registry) or, when none are given, every active surface.
function pick(names) {
  if (!names.length) return activeSurfaces();
  const byName = new Map(SURFACES.map((s) => [s.name, s]));
  const chosen = [];
  for (const n of names) {
    const s = byName.get(n);
    if (!s) {
      process.stderr.write(`las: unknown surface '${n}'\n`);
      process.exitCode = Number("1");
      return null;
    }
    chosen.push(s);
  }
  return chosen;
}

function cmdList() {
  const rows = SURFACES.map((s) => ({ surface: s.name, summary: s.summary }));
  process.stdout.write(JSON.stringify(rows, null, Number("2")) + "\n");
}

async function withChild(surface, fn) {
  const client = connect(surface);
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function cmdTools(names) {
  const surfaces = pick(names);
  if (!surfaces) return;
  const out = {};
  for (const surface of surfaces) {
    try {
      const tools = await withChild(surface, (client) => handshake(client));
      out[surface.name] = tools.map((t) => `${surface.name}${SEP}${t.name}`);
    } catch (err) {
      out[surface.name] = { error: err.message };
    }
  }
  process.stdout.write(JSON.stringify(out, null, Number("2")) + "\n");
}

async function cmdCheck(names) {
  const surfaces = pick(names);
  if (!surfaces) return;
  const report = {};
  let anyDown = false;
  for (const surface of surfaces) {
    try {
      const tools = await withChild(surface, (client) => handshake(client));
      report[surface.name] = { ok: true, toolCount: tools.length };
    } catch (err) {
      report[surface.name] = { ok: false, error: err.message };
      anyDown = true;
    }
  }
  process.stdout.write(JSON.stringify(report, null, Number("2")) + "\n");
  if (anyDown) process.exitCode = Number("1");
}

async function main() {
  const argv = process.argv.slice(Number("2"));
  const [command, ...rest] = argv;
  if (command === "list") {
    cmdList();
  } else if (command === "tools") {
    await cmdTools(rest);
  } else if (command === "check") {
    await cmdCheck(rest);
  } else {
    usage();
    process.exitCode = Number("1");
  }
}

main().catch((err) => {
  process.stderr.write(`las: ${err.message}\n`);
  process.exitCode = Number("1");
});
