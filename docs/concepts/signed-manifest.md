# Signed manifest

What convinces Las that a surface may be spawned and its tools called? One
detached-signed strict-JSON document: the release manifest. It is the owner's
statement of exactly which surfaces, bytes, schemas, and environment names
are admitted. Everything in this page is implemented in
`src/signed-manifest.mjs`.

## The four files

Four required environment variables name the release material; each must be
an absolute path or loading refuses with
`las manifest: <VARIABLE> must name an absolute path`:

| Variable | File | Written by |
|---|---|---|
| `LAS_RELEASE_MANIFEST_FILE` | The manifest itself. | The owner. |
| `LAS_RELEASE_MANIFEST_SIGNATURE_FILE` | Detached Ed25519 signature envelope. | The owner. |
| `LAS_RELEASE_TRUST_STORE_FILE` | Public verification keys. Regular file, current-user-owned, owner-only permissions. | The operator. |
| `LAS_RELEASE_WATERMARK_FILE` | Sequence watermark, same ownership/permission rules. | Las — the only file it ever writes. |

## Signature envelope

The signature file is strict JSON with exactly these members:

```json
{
  "type": "las.release-manifest",
  "version": 1,
  "key_id": "toy-2026",
  "signature": "<canonical base64, exactly 64 bytes decoded>"
}
```

`key_id` must match `^[A-Za-z0-9._-]{1,128}$`. A wrong `type`/`version`/
`key_id` refuses with `las manifest signature: unsupported envelope`; a
non-64-byte signature with
`las manifest signature: Ed25519 signature must be 64 bytes`; padding tricks
with `…: invalid base64` or `…: non-canonical base64`.

## Trust store

```json
{
  "version": 1,
  "keys": [
    { "key_id": "toy-2026", "public_key_spki": "<base64 DER SPKI>" }
  ]
}
```

The store holds public verification keys only — never signing keys. It must
be a regular file owned by the current user with no group/other permission
bits, or loading refuses with `las trust store: missing regular file`,
`las trust store: file is not owned by the current user`, or
`las trust store: permissions must be owner-only`. The envelope's `key_id`
must select one key (`las trust store: signature key_id is not trusted`),
and that key must be Ed25519
(`las trust store: invalid Ed25519 public key`).

## The signature covers raw bytes under a domain separator

Verification signs/verifies `"LAS\0release-manifest\0v1\0" + <manifest file
bytes exactly as stored>`. There is no canonicalization step between disk and
signature: reformatting the manifest file invalidates it. Any mismatch —
tampered bytes, wrong key, wrong domain — refuses with
`las manifest: detached signature verification failed`.

## Manifest schema

Strict JSON with exactly `type`, `version`, `sequence`, `expires_at`,
`surfaces`:

| Member | Contract | Refusal sentence |
|---|---|---|
| `type` | `"las.release-manifest"` | `las manifest: unsupported type or version` |
| `version` | `1` | (same sentence) |
| `sequence` | positive safe integer | `las manifest: sequence must be a positive safe integer` |
| `expires_at` | RFC 3339 UTC (`YYYY-MM-DDTHH:MM:SS[.mmm]Z`), in the future | `las manifest: expires_at must be an RFC 3339 UTC timestamp` / `las manifest: manifest has expired` |
| `surfaces` | non-empty array, unique names | `las manifest: surfaces must be non-empty` / `las manifest: duplicate surface name` |

Each surface entry binds, with exact-key checking
(`las manifest surface[i]: unknown member '<k>'` / `missing member '<k>'`):

| Member | Contract |
|---|---|
| `name` | non-empty string; must also exist in the [registry](registry-entry.md), and must not be `finance` — otherwise the registry rejects the whole manifest with `las manifest: unknown or separately trusted surface '<name>'` (`src/registry.mjs`). |
| `command`, `cwd`, `code_path` | absolute paths (`las manifest surface[i]: command, cwd, and code_path must be absolute`). |
| `argv`, `env_names` | arrays of unique non-empty strings. |
| `binary_sha256`, `code_sha256` | lowercase SHA-256 of the launched binary and of the code file at `code_path`. |
| `tools` | non-empty array of `{name, input_schema_sha256, credential_templates}` with unique tool names. |

Each tool's `input_schema_sha256` is the SHA-256 of the canonical JSON of the
child's advertised input schema — canonicalization sorts object keys
(`jsonSha256`), so cosmetic re-serialization by the child keeps the digest
stable while any semantic schema change breaks it. `credential_templates` is
an array of `{argument, value}` with unique, identifier-shaped argument names
(`^[A-Za-z_][A-Za-z0-9_]*$`); at call time each template is injected as a
fixed argument the model cannot override ([policy](policy.md)).

## Strict JSON

Every release file is parsed by Las's own parser (`src/strict-json.mjs`),
not `JSON.parse`: it requires valid UTF-8
(`<label>: payload is not valid UTF-8`), rejects duplicate object keys
(`<label>: duplicate member '<key>' at byte <n>`), rejects anything after the
top-level value (`<label>: trailing data at byte <n>`), and refuses malformed
strings, escapes, numbers, and unescaped control characters, always naming
the byte offset. Objects are created with a null prototype, so a manifest
cannot smuggle `__proto__`. `assertExactKeys` then refuses any unknown or
missing member by name.

## Sequence and the watermark

The watermark file is strict JSON `{"version": 1, "sequence": <n>}` with the
same ownership/permission rules as the trust store. On every successful load:

- a manifest `sequence` **lower** than the stored watermark refuses with
  `las manifest: sequence rollback rejected` — a previously accepted release
  cannot be replayed over a newer one;
- an **equal** sequence is accepted without writing;
- a **higher** sequence advances the watermark through an exclusive
  owner-only temporary file (`O_CREAT|O_EXCL`, mode `0600`), `fsync`, and an
  atomic rename.

Verified on a real run: minting a sequence-1 manifest against a fresh
`{"version":1,"sequence":0}` watermark left `{"version":1,"sequence":1}`
behind after the first successful `las list`.

## Lifecycle in the process

`loadSignedManifest()` runs at most once per process (`src/registry.mjs`
memoizes the result *and* the error). Expiry is re-checked against the
memoized `expires_at` on every use, so a long-lived process refuses calls the
moment its manifest expires — but a repaired manifest on disk is only picked
up by a restart.

## Minting one

`docs/examples/mint-toy-release.mjs` mints a complete valid release for one
surface with a throwaway in-memory key — the executed transcript is in
[walkthrough-onboard-a-surface](../walkthrough-onboard-a-surface.md).
`docs/examples/verify-release.mjs` prints either the release summary or the
exact refusal sentence. Neither script touches anything outside its output
directory.
