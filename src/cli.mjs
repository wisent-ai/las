#!/usr/bin/env node
// las — command-line view of the federated ecosystem agent surface.
//
// Reads the same registry the aggregator server uses (one source of truth for
// which surfaces exist), exposes first-use guidance, and offers catalogue
// adoption plus four views:
//   las adopt [config...]    — adopt supported mcpServers entries
//   las gui [--port PORT]    — serve the local graphical catalogue importer
//   las onboarding           — explain federation and guide catalogue adoption
//   las list                 — every federated surface + its one-line summary
//   las tools [surface...]    — advertised tools, spawning each child to ask
//   las check [surface...]    — connectivity: spawn + initialize handshake
//   las dependencies [...]    — what each product needs from another one
// With no surface arguments, tools/check cover every active surface (honoring
// the LAS_ONLY / LAS_SKIP environment filters).
import { adoptMcpConfigurations, catalogRegistration } from "./catalog.mjs";
import { cmdDependencies } from "./dependencies/command.mjs";
import { startLasGui } from "./gui.mjs";
import { SURFACES, activeSurfaces, authorizeTools, connect, handshake, surfaceConfigured } from "./registry.mjs";
import { recordCatalogueAdopted, runOnboardingAction } from "./onboarding/journey.mjs";

const SEP = "__";

function usage(stream = process.stderr) {
  stream.write(
    [
      "usage: las <command> [arguments]",
      "  adopt [--replace] [config...]  adopt supported entries from standard mcpServers JSON",
      "  gui [--port PORT]    serve the loopback graphical catalogue importer",
      "  list                 list every federated surface",
      "  tools [surface...]   list advertised tools (spawns each child)",
      "  check [surface...]   connectivity handshake against each child",
      "  onboarding [action]  first-use adoption journey (show, status, advance, skip, reset)",
      "  dependencies [product...] [--requires P] [--without P,...] [--json]",
      "                       what each Wisent product needs from another and what happens without it",
      "  dependencies check [--move-lines] [--json]  re-read every source line the register cites",
      "  dependencies set <product> <requires> --feature … --how … --when-absent … --detail … --at … --contains …",
      "                       record one entry; refused unless every cited line says what it quotes",
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
  const active = new Set(activeSurfaces());
  const chosen = [];
  for (const n of names) {
    const s = byName.get(n);
    if (!s) {
      // A surface name the registry does not hold is a wrong invocation: exit 2 (cli.md rule 10).
      process.stderr.write(`las: unknown surface '${n}'; known: ${SURFACES.map((surface) => surface.name).join(", ")}\n`);
      process.exitCode = 2;
      return null;
    }
    if (!surfaceConfigured(s) || !active.has(s)) {
      process.stderr.write(`las: surface '${n}' is not active under the signed release and operator filters\n`);
      process.exitCode = 1;
      return null;
    }
    chosen.push(s);
  }
  return chosen;
}

async function cmdList() {
  const active = new Set(activeSurfaces());
  const rows = SURFACES.map((s) => {
    const registration = catalogRegistration(s);
    return {
      surface: s.name,
      summary: s.summary,
      registration: !registration.managed ? "compiled-default" : registration.valid ? "adopted" : "absent",
      ...(registration.registration ? {
        source: registration.registration.sourcePath,
        sourceEntry: registration.registration.sourceKey,
      } : {}),
      configured: surfaceConfigured(s),
      active: active.has(s),
    };
  });
  process.stdout.write(JSON.stringify(rows, null, 2) + "\n");

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
      const tools = authorizeTools(surface, await withChild(surface, (client) => handshake(client)));
      out[surface.name] = tools.map((t) => `${surface.name}${SEP}${t.name}`);
    } catch (err) {
      out[surface.name] = { error: err.message };
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

async function cmdCheck(names) {
  const surfaces = pick(names);
  if (!surfaces) return;
  const report = {};
  let anyDown = false;
  for (const surface of surfaces) {
    try {
      const tools = authorizeTools(surface, await withChild(surface, (client) => handshake(client)));
      report[surface.name] = { ok: true, toolCount: tools.length };
    } catch (err) {
      report[surface.name] = { ok: false, error: err.message };
      anyDown = true;
    }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (anyDown) process.exitCode = 1;
}
async function cmdAdopt(args) {
  const replace = args.includes("--replace");
  const sources = args.filter((argument) => argument !== "--replace");
  const unknown = sources.find((argument) => argument.startsWith("-"));
  if (unknown) throw new Error(`unknown adopt option '${unknown}'`);
  const result = adoptMcpConfigurations(SURFACES, { sources, replace });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status === "imported" || result.status === "unchanged") {
    await recordCatalogueAdopted({
      client: "cli",
      surfaceCount: result.imported.length + result.unchanged.length,
      catalogPath: result.catalogPath,
    });
  } else {
    process.exitCode = 1;
  }
}
async function cmdGui(args) {
  let port = 0;
  if (args.length) {
    let value;
    if (args.length === 2 && args[0] === "--port") value = args[1];
    else if (args.length === 1 && args[0].startsWith("--port=")) value = args[0].slice("--port=".length);
    else throw new Error("gui accepts only --port PORT");
    if (!/^\d+$/.test(value)) throw new Error("GUI port must be an integer from 0 through 65535");
    port = Number(value);
  }
  const { url } = await startLasGui({ port });
  process.stdout.write(`Las GUI: ${url}\n`);
}



async function cmdOnboarding(args) {
  if (args.length > 1) throw new Error("onboarding accepts at most one action");
  const result = await runOnboardingAction(args[0] || "show", { client: "cli" });
  process.stdout.write(
    [
      `${result.title}`,
      "",
      result.body,
      "",
      `Status: ${result.status}`,
      ...(result.actions?.length ? [`Next: ${result.actions.join(" or ")}`] : []),
    ].join("\n") + "\n",
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  // `--help`, `-h` or `help` anywhere prints the usage to stdout and runs
  // nothing: `las adopt --help` used to fail as an unknown adopt option and
  // `las --help` exited 1.
  if (argv.some((word) => word === "--help" || word === "-h") || command === "help") {
    usage(process.stdout);
    return;
  }
  if (command === "adopt") {
    await cmdAdopt(rest);
  } else if (command === "gui") {
    await cmdGui(rest);
  } else if (command === "list") {
    await cmdList();
  } else if (command === "tools") {
    await cmdTools(rest);
  } else if (command === "check") {
    await cmdCheck(rest);
  } else if (command === "onboarding") {
    await cmdOnboarding(rest);
  } else if (command === "dependencies") {
    await cmdDependencies(rest);
  } else {
    // No or an unknown command is a wrong invocation: exit 2 (cli.md rule 10).
    if (command) process.stderr.write(`las: unknown command '${command}'\n`);
    usage();
    process.exitCode = 2;
  }
}

main().catch((err) => {
  process.stderr.write(`las: ${err.message}\n`);
  process.exitCode = 1;
});
