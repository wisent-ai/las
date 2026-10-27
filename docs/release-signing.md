# Signing a Las release

Las federates a surface only when an owner-signed release manifest describes
it. The operator who runs Las makes and signs that manifest on their own
machine with `las release`; Las itself holds only the public key.

## Files and environment

| Variable | File | Who writes it | Mode |
|---|---|---|---|
| `LAS_RELEASE_MANIFEST_FILE` | the manifest (strict JSON) | the operator | any |
| `LAS_RELEASE_MANIFEST_SIGNATURE_FILE` | the detached Ed25519 signature | `las release sign` | any |
| `LAS_RELEASE_TRUST_STORE_FILE` | `{version:1, keys:[{key_id, public_key_spki}]}` | `las release keygen` | owner-only, owned by you |
| `LAS_RELEASE_WATERMARK_FILE` | `{version:1, sequence}`, the highest sequence Las accepted | you once, then Las | owner-only, owned by you |
| — | the Ed25519 private key (PKCS#8 PEM) | `las release keygen` | owner-only |

All four variables must be absolute paths. Keep the private key outside every
git checkout (for example `~/.config/las/release-signing-key.pem`, or as an
item in your Skarbiec vault that you export only while signing). Never commit
it, never pass it to a child surface, and never paste it into an issue.

## 1. Once: a signing key, the trust store and the watermark

```bash
mkdir -p ~/.config/las && chmod 700 ~/.config/las
export LAS_RELEASE_TRUST_STORE_FILE=~/.config/las/trust-store.json
export LAS_RELEASE_WATERMARK_FILE=~/.config/las/watermark.json
export LAS_RELEASE_MANIFEST_FILE=~/.config/las/release-manifest.json
export LAS_RELEASE_MANIFEST_SIGNATURE_FILE=~/.config/las/release-manifest.sig.json

las release keygen --key-id las-release-2026-10 \
  --private-key ~/.config/las/release-signing-key.pem \
  --trust-store "$LAS_RELEASE_TRUST_STORE_FILE"
(umask 077; printf '{"version":1,"sequence":0}\n' > "$LAS_RELEASE_WATERMARK_FILE")
```

`keygen` writes the private key with mode `0600` and refuses to replace an
existing file; it adds the public key under the key id to the trust store
(creating it owner-only), refuses a key id the store already trusts, and
prints the key id, the paths and the public key. Rotate by generating a key
under a new id; remove an old id from the trust store by hand.

## 2. Each release: describe the surfaces

Build each surface first (for Skarbiec: `cargo build --release` in
`skarbiec/`), then let Las describe it exactly as it will launch it:

```bash
las release entry skarbiec > /tmp/skarbiec.entry.json
```

`entry` spawns the surface from the registry's command, cwd and argv with its
declared environment, asks its `tools/list`, and prints the manifest entry:
command, cwd, argv, env names, `binary_sha256`, `code_path` and `code_sha256`
(the first absolute argument, else the command; override with
`--code-path FILE`), and each tool's `input_schema_sha256`, in the registry's
`allowTools` order. Skarbiec needs `SKARBIEC_MCP_AGENT_ID` set for the spawn.
Credential templates are empty; add any by hand.

Write the manifest from the entries, with a `sequence` above the watermark's
and an expiry in UTC:

```json
{
  "type": "las.release-manifest",
  "version": 1,
  "sequence": 2,
  "expires_at": "2027-01-31T00:00:00Z",
  "surfaces": [ …the entries… ]
}
```

## 3. Each release: sign

```bash
las release sign --key-id las-release-2026-10 \
  --private-key ~/.config/las/release-signing-key.pem \
  --manifest "$LAS_RELEASE_MANIFEST_FILE" \
  --signature "$LAS_RELEASE_MANIFEST_SIGNATURE_FILE" \
  --trust-store "$LAS_RELEASE_TRUST_STORE_FILE" \
  --watermark "$LAS_RELEASE_WATERMARK_FILE"
```

`sign` validates the manifest as Las will (strict JSON, schema, unexpired),
refuses a `sequence` not above the watermark, checks that the trust store holds
this key's public key under `--key-id`, and writes
`{type:"las.release-manifest", version:1, key_id, signature}`: a base64
Ed25519 signature over `LAS\0release-manifest\0v1\0` followed by the manifest's
exact bytes. Editing the manifest afterwards, even whitespace, invalidates it.

Then restart the Las MCP clients and check:

```bash
las list
las check skarbiec
```

The first Las process that verifies the manifest advances the watermark to its
sequence; an older manifest is then refused as a rollback.
