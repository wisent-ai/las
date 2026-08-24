# Walkthrough: onboard a surface into the catalogue

How does a surface go from `configured: false` to a verified, callable
federation target? This page is one real run, executed on 2026-08-24 with
Node v22.20.0 on an Apple Silicon workstation, against a toy release minted
into a temp directory — no operator state was touched, and the signing key
existed only in memory. The contracts behind each step live in
[concepts/signed-manifest](concepts/signed-manifest.md) and
[concepts/release-admission](concepts/release-admission.md).

The subject is `brama`, the model-gateway surface: its registry entry exists
(it always does — the registry is compiled in), its debug binary is built,
and nothing admits it yet.

## 0. Before: declared but refused

Without valid release material every ordinary surface is unconfigured, and
explicit selection refuses:

```console
$ node src/cli.mjs tools brama
las: surface 'brama' is not active under the signed release and operator filters
$ echo $?
1
```

## 1. Mint the toy release

`docs/examples/mint-toy-release.mjs` does what a real owner does: reads the
launch contract from the registry, handshakes the child once to capture its
advertised schemas, binds the manifest to the exact bytes, signs it under the
`LAS\0release-manifest\0v1\0` domain, and writes the four files with the
required permissions.

```console
$ node docs/examples/mint-toy-release.mjs brama /tmp/las-docs/toy-release
minted release for 'brama' (1 signed tool(s)) in /tmp/las-docs/toy-release
export LAS_RELEASE_MANIFEST_FILE=/tmp/las-docs/toy-release/release-manifest.json
export LAS_RELEASE_MANIFEST_SIGNATURE_FILE=/tmp/las-docs/toy-release/release-manifest.sig.json
export LAS_RELEASE_TRUST_STORE_FILE=/tmp/las-docs/toy-release/trust-store.json
export LAS_RELEASE_WATERMARK_FILE=/tmp/las-docs/toy-release/watermark.json
```

The minted manifest, verbatim except the workspace prefix (shortened to
`<workspace>`):

```json
{
  "type": "las.release-manifest",
  "version": 1,
  "sequence": 1,
  "expires_at": "2026-08-25T22:07:04.000Z",
  "surfaces": [
    {
      "name": "brama",
      "command": "<workspace>/brama/target/debug/brama",
      "cwd": "<workspace>/brama",
      "argv": ["mcp"],
      "env_names": [],
      "binary_sha256": "b12c85a4df3abfbd744e6ec24769875859178bee64d500944c3e79cfa2f501ec",
      "code_path": "<workspace>/brama/target/debug/brama",
      "code_sha256": "b12c85a4df3abfbd744e6ec24769875859178bee64d500944c3e79cfa2f501ec",
      "tools": [
        {
          "name": "brama_detect",
          "input_schema_sha256": "c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699",
          "credential_templates": []
        }
      ]
    }
  ]
}
```

Note what got signed: the exact launch (`command`, `cwd`, `argv`), the exact
bytes (for a compiled child, `code_path` is the binary itself, so both
digests coincide), and the canonical digest of the one advertised input
schema. Export the four variables the script printed.

## 2. Verify the release names itself

```console
$ node docs/examples/verify-release.mjs
release ok: /private/tmp/las-docs/toy-release/release-manifest.json
key_id: toy-2026
sequence: 1
expires_at: 2026-08-25T22:07:04.000Z
surfaces: brama
```

## 3. The catalogue admits exactly one surface

```console
$ node src/cli.mjs list
[
  …
  {
    "surface": "brama",
    "summary": "Multi-provider LLM gateway (formerly model-router). Read-only hardware detect + model list.",
    "configured": true,
    "active": true
  },
  …
]
```

Every other row reports `"configured": false, "active": false` — the manifest
names only brama, and [admission](concepts/release-admission.md) can only
refuse, never extend.

## 4. Handshake and verify

```console
$ node src/cli.mjs tools brama
{
  "brama": [
    "brama__brama_detect"
  ]
}
$ node src/cli.mjs check brama
{
  "brama": {
    "ok": true,
    "toolCount": 1
  }
}
$ echo $?
0
```

Between those two lines Las spawned the child with a frozen minimal
environment, performed `initialize` + `tools/list`, verified the advertised
tool set and schema digest against the signature, and closed the child.

## 5. The watermark advanced

The watermark started at `{"version":1,"sequence":0}`; the first successful
load moved it forward atomically:

```console
$ cat /tmp/las-docs/toy-release/watermark.json
{"version":1,"sequence":1}
```

From now on a manifest with `sequence` below 1 refuses with
`las manifest: sequence rollback rejected`.

## 6. Prove the boundary bites

Flip one bit and everything closes. Changing `"sequence": 1` to `2` in the
manifest file (without re-signing) and pointing
`LAS_RELEASE_MANIFEST_FILE` at the copy:

```console
$ node docs/examples/verify-release.mjs
las manifest: detached signature verification failed
$ node src/cli.mjs tools brama
las: surface 'brama' is not active under the signed release and operator filters
```

The CLI deliberately flattens the cause; the verify script names it. The full
symptom → sentence → repair table is the [runbook](runbook.md).

## Where to go next

Call the admitted surface through the MCP server —
[walkthrough-federated-session](walkthrough-federated-session.md) — or admit
a second surface by re-running the mint script with another name and a
`sequence` of 2 (the mint script always writes sequence 1; onboarding a real
fleet of surfaces means one manifest listing all of them, not one manifest
per surface, because each load replaces the whole admitted set).
