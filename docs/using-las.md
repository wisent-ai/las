<!-- Moved out of README.md on 2026-09-21: that file stood at 577 lines,
     past the three-hundred-line limit every file in this workshop lives
     under. Nothing here was rewritten. -->

## Quick start

### Prerequisites

- Node.js 18 or newer;
- a local Wisent workspace whose parent contains `las/` and the required sibling
  product repositories/build artifacts at registry-defined paths;
- current child binaries/modules;
- four absolute manifest/trust/watermark paths;
- owner-only trust-store and watermark files;
- a valid, unexpired, owner-signed release manifest and detached signature;
- child-specific configuration allowed by the registry.

```bash
git clone https://github.com/wisent-ai/las.git
cd las
npm install
```

`npm install` installs no runtime dependencies in the current package; Node core
modules implement the server. It does not populate sibling repositories or
release material.
### Adopt existing MCP configuration

```bash
las adopt
las adopt /path/to/existing/mcp.json
```

With no path, Las discovers `.mcp.json` in the current directory, VS Code's
`.vscode/mcp.json`, and Claude Desktop's platform configuration. It accepts the
established top-level `mcpServers` object or VS Code `servers` object and only
stdio entries whose name, command, arguments, working directory, and
environment names match a canonical Las surface. It does not execute a child
or call a tool during adoption.

All selected files and entries are validated before one atomic write to
`${LAS_CATALOG_PATH:-${XDG_CONFIG_HOME:-~/.config}/las/catalog.json}`. The file
is owner-only because approved environment values are retained there; command
output reports source, entry name, and status but never an environment value.
Repeating the same registration is `unchanged`. Unsupported entries, unknown
fields, unresolved client interpolation, disabled/remote servers, and malformed
JSON are `rejected`; two definitions of one surface or an existing different
registration are `conflicting`. Either condition refuses the whole operation
and preserves the current catalogue. `--replace` explicitly updates a
conflicting retained registration while preserving every unrelated one.

Once the durable catalogue exists, only registered canonical surfaces are
eligible for federation. Signed release verification and `LAS_ONLY`/`LAS_SKIP`
still apply, and the imported environment is consumed only through each
surface's existing allowlist.

### Use the graphical importer

```bash
las gui
las gui --port 41731
```

`las gui` serves the frontend shipped in the npm package on `127.0.0.1`; port
`0` (the default) asks the OS for an available port. Open the exact URL printed
to stdout. Las does not open the browser itself. The URL carries a random
per-session token that the page removes from its address after loading.

Choose discovery, enter one or more exact local paths, or upload JSON files.
Uploads are retained in the owner's Las state directory rather than `/tmp`.
The Replace checkbox is the graphical equivalent of `--replace`. The API calls
the same `adoptMcpConfigurations` engine as `las adopt`, so signed surface
matching, environment-name allowlists, credential-reference constraints,
all-or-nothing writes, source identity, and refusal reasons are identical.

The result shows every `imported`, `unchanged`, `conflicting`, and `rejected`
record. Its catalogue table is a fresh readback from the canonical registry and
durable catalogue; it does not infer success from selection or input, expose
environment values, start an MCP child, or run a connectivity check.



Configure the signed release boundary:

```bash
export LAS_RELEASE_MANIFEST_FILE=/absolute/path/release-manifest.json
export LAS_RELEASE_MANIFEST_SIGNATURE_FILE=/absolute/path/release-manifest.sig.json
export LAS_RELEASE_TRUST_STORE_FILE=/absolute/path/trust-store.json
export LAS_RELEASE_WATERMARK_FILE=/absolute/path/watermark.json
```

Then adopt the existing MCP registrations and inspect the registry without
spawning children:

```bash
node src/cli.mjs adopt /path/to/existing/mcp.json
node src/cli.mjs list
```

Expected result: adoption reports imported or unchanged canonical surfaces, and
`list` returns each known surface with `registration`, `configured`, and
`active`; an unconfigured surface also carries `unconfigured`, the refusal of
the step that failed, for example `las manifest: LAS_RELEASE_MANIFEST_FILE must
name an absolute path`. A missing/invalid signed manifest still makes ordinary
signed surfaces unconfigured rather than trusting current files. `tools` and
`check` on a named surface refuse with `las: surface '<name>' is not
configured: <reason>` or `las: surface '<name>' is excluded by LAS_ONLY or
LAS_SKIP` (exit `1`).

Check a selected subset:

```bash
LAS_ONLY=tama,brama node src/cli.mjs check tama brama
```

Expected result: per-surface JSON with `ok` and verified `toolCount`; exit `1` if
any selected child fails.

## Primary interfaces

### CLI

```text
las adopt [--replace] [config...]
las gui [--port PORT]
las onboarding [show|status|advance|skip|reset]
las list
las tools [surface...]
las check [surface...]
las dependencies [product...] [--requires PRODUCT] [--without PRODUCT[,PRODUCT...]] [--json]
las dependencies check [--move-lines] [--json]
las dependencies set <product> <requires> --feature TEXT --how TEXT --when-absent OUTCOME --detail TEXT [--alternative TEXT] --at <repository>/<file>:<line> --contains TEXT [--at … --contains …]
las dependencies remove <product> <requires> --feature TEXT
```

When installed from an approved source, `package.json` exposes `las` and
`las-mcp`. Running source directly is equivalent:

```bash
node src/cli.mjs adopt /path/to/existing/mcp.json
node src/cli.mjs gui
node src/cli.mjs onboarding
node src/cli.mjs list
node src/cli.mjs tools tama brama
node src/cli.mjs check tama brama

node src/mcp.mjs
```

- `adopt` validates and atomically registers supported existing MCP entries
  without spawning them;
- `gui` serves the packaged graphical importer on loopback and invokes that same
  adoption engine; it prints the URL without opening a browser;
- `list` reads registry/configuration state only.
- `tools` spawns and handshakes selected children, returning namespaced tool
  names or a per-surface error object.
- `check` performs the same verified handshake and exits non-zero if any selected
  child is down.

- With no names, `tools`/`check` use every active surface after filters.
- Unknown, unsigned/unconfigured, or filtered-out explicit surfaces are rejected.
- After adoption, an unregistered surface is inactive even when a signed
  release exists; the registration never bypasses release or tool policy.
 

### What each product needs from another

A machine is not assumed to hold every Wisent product. `las dependencies`
prints the register in `src/dependencies/register.json`: for each place one
product calls another, what it is used for, how it is reached, and what a
machine without the other product gets:

- `alternative`: the product works without it through the path printed under
  `alternative` (for example Stado's credential store as a file instead of
  Skarbiec, or `brama serve --local-credentials-stdin`);
- `refusal`: the feature stops; the entry quotes the error;
- `degraded`: the feature goes on with less; the entry says what is lost.

```bash
las dependencies stado                 # everything Stado needs
las dependencies --requires skarbiec   # everything that needs Skarbiec
las dependencies --without brama,skarbiec   # what a machine without both gets
las dependencies --json
```

Every entry cites the source lines it was read from, as
`<repository>/<file>:<line>` with the text that line contains.
`las dependencies check` reads each cited line again and exits `1` when one no
longer says what the register quotes, naming the file, the line, the quoted
text and what the line says now (or that the file cannot be read). When the
quote only moved to exactly one other line of the same file, the report says
which line; `las dependencies check --move-lines` rewrites those line numbers
in the register and lists every citation whose quote changed or vanished, which
needs a person to read the code again (exit `1`). A product name the register
does not hold, an unknown option, `check` with a filter, or `--move-lines`
without `check` exits `2` with the usage.

An entry is recorded with `las dependencies set`. The entry with the same
product, required product and feature is replaced, otherwise it is added. It
is written only when it is valid (an `alternative` outcome names its
alternative, the outcome is one of the register's) and every `--at` line
contains the `--contains` text that follows it; otherwise nothing is written
and each failing citation is printed with what the line says now (exit `1`),
or the invalid field is named (exit `2`).

`set`, `remove` and `check --move-lines` change the register one at a time:
each holds `src/dependencies/register.json.lock` (its pid) while it reads,
changes and renames the new file into place. A second change while the first
runs is refused with `las: the dependency register is being changed by process
<pid> (…); run this change after it ends` (exit `1`) and writes nothing; a lock
whose process has exited is taken over.

`las dependencies remove <product> <requires> --feature TEXT` drops the entry
with that key, for a dependency that is gone or now described by another
entry, and prints `removed the entry`. A key the register does not hold is
refused with `las: no entry <product> -> <requires> with feature "…"` (exit
`1`).

`las gui` shows the same register under *Dependencies*: tick the products the
machine does not have and the table narrows to what needs them, with the
evidence check above it. The page reads `GET /api/dependencies?without=a,b`
with the session token, the same query as `--without`.

### First use and replay

`las onboarding` starts the shipped first-use journey and `las onboarding
advance` reaches the durable action, `las adopt`. A successful import or an
identical retained registration records `catalogue_adopted`; reading the
screens or running `las list` does not. `las onboarding reset` discards the
recorded journey progress so the same idempotent adoption can complete a new
attempt. `status` only inspects progress. `skip` preserves the current catalogue;
before a first adoption, compiled defaults remain eligible, while an existing
durable catalogue keeps governing eligibility.

### MCP transport

Las reads one JSON-RPC request per stdin line and writes one response per stdout
line. Protocol version is `2024-11-05`.

Supported methods:

- `initialize` (exactly once);
- `ping`;
- `tools/list`;
- `tools/call`.


Notifications receive no response. Requests before initialization fail. A later
request may not replace `agentId`; when Skarbiec is active, initialization must
provide the exact `SKARBIEC_MCP_AGENT_ID`.

### Namespacing

A child tool `health` from surface `most` becomes:

```text
most__health
```

Las removes ambiguity with a double-underscore separator. The remote child still
receives its original `health` name.

### Operator filters

```bash
LAS_ONLY=tama,brama las list
LAS_SKIP=weles,finance las list
```

Both filters only subtract from eligible configured surfaces. They cannot add an
unsigned surface or bypass local configuration.

