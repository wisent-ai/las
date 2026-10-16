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

Every command that reads the catalogue (`list`, `tools`, `check`, `forget`,
`adopt`) treats only a missing file as "no catalogue". A catalogue that
cannot be inspected, is not a regular file, cannot be read, or does not parse
is a refusal naming the path and the cause: `Las catalogue cannot be
inspected: <path>: EACCES …`, `Las catalogue cannot be read: <path>: EACCES
…`, `Las catalogue is not valid JSON: <path>: Expected property name or '}'
in JSON at position 1 …`. Las never runs as if nothing were registered when
the catalogue is merely unreadable.

### Use the graphical importer
Before launch, declare `LAS_GUI_MAX_REQUEST_BYTES` and `LAS_GUI_SESSION_TOKEN_BYTES` in the deployment environment as positive whole byte counts. Missing or unrepresentable declarations refuse startup before binding; request failures name the actual and declared size, and token-generation failures preserve their cause. An oversized request is paused while its HTTP refusal is sent, then the connection closes; malformed JSON reports the decoder cause instead of an unexplained connection reset.
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
Each citation must be an object with nonblank string `at` and `contains`
fields and an exactly representable positive line number. Other shapes refuse
with the entry and invalid field named; a boolean or number is never coerced
into quoted source text.
The register and its `outcomes` field must be objects, and each dependency
entry must be an object. Invalid containers name the register field or entry
instead of failing while dereferencing a missing product or citation.
Citation paths stay inside the named workspace repository. Parent traversal,
absolute file paths, a symlinked repository root or a file symlink escaping
that root fail evidence checking with the path and reason retained. `set`
cannot record such evidence; CLI and GUI show the same failed citation.
`las dependencies check` reads each cited file again and exits `1` when a
quote changed, vanished or now stands on several lines, naming the file, the
line, the quoted text and what the line says now (or that the file cannot be
read). A quote that only moved to exactly one other line of the same file
still holds: the code says the same thing, so the check passes and lists it as
`moved: <file>:<line> is now line <n>`, and `las dependencies check
--move-lines` rewrites those line numbers in the register and lists every
citation whose quote changed or vanished, which needs a person to read the
code again (exit `1`). A citation recorded with `set` must name the line its
quote is on now. A product name the register
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
whose process has exited is taken over. A lock with no complete holder pid is
refused without removal, because its owner may still be initializing it.
The holder must be a positive, exactly representable decimal PID. Partial
numbers, process-group IDs and malformed holder declarations are not probed
as another process or treated as permission to remove its lock.
Process-inspection errors other than permission denial or a nonexistent
process retain their cause and refuse the change rather than claiming the
holder has exited.
If writing the holder identity fails, the process closes its descriptor and
removes its incomplete lock before returning the failure. Replacement output
is created exclusively: an existing `.next` file is refused, not overwritten
or deleted. A replacement created by this invocation is removed after a write
or rename failure; the original register is not replaced by partial output.

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

See [First use and retained state](onboarding/state.md) for replay, control-plane diagnostics, and CLI refusal/recovery qualification.

The native Byk posture console reads Oko's Rust package, MCP, goal and telemetry
source directories and its local executable. These are source/artifact checks,
not a child handshake, signed-release verification or database access proof.
Oko's MCP command is `oko mcp serve`; Las still requires its exact launch
contract and tool schemas to match the signed release before federation.
The Most and Probierz native consoles inspect their Rust sources, and Echo
inspects `mcp/server.mjs`; those checks also establish source presence only.
Native source checks show the failed filesystem operation, path and cause in the card detail.
Unreadable directories or entries make counts unavailable, not zero or partial; refused symbolic links are identified.
Probierz and Stado federation launch their current Rust executables with `mcp`,
not `probierz-mcp` or the retired `stado.mcp.server` Python module. Native workspace
discovery requires `stado/`, not `wisent-compute/`, and follows candidate ancestors to the filesystem root without a depth cap; each new launch contract still needs its own signed authorization.

### MCP server

The MCP transport, how each malformed request is answered, what Las says about
a failing child and how tools are namespaced are in [mcp.md](mcp.md).

### Operator filters

```bash
LAS_ONLY=tama,brama las list
LAS_SKIP=weles,finance las list
```

Both filters only subtract from eligible configured surfaces. They cannot add an
unsigned surface or bypass local configuration.

