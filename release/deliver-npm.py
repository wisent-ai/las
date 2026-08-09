#!/usr/bin/env python3
import hashlib
import json
import os
import pathlib
import subprocess
import tarfile
import tempfile


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing {name}")
    return value

archive = pathlib.Path(required("WISENT_RELEASE_ARCHIVE"))
digest = required("WISENT_RELEASE_SHA256")
if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
    raise RuntimeError("canonical Stado archive digest mismatch")
with tempfile.TemporaryDirectory() as temporary:
    root = pathlib.Path(temporary)
    with tarfile.open(archive, "r:gz") as bundle:
        bundle.extract("las.tgz", root, filter="data")
    npmrc = root / "npmrc"
    npmrc.write_text("//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n")
    env = os.environ.copy()
    env["NPM_CONFIG_USERCONFIG"] = str(npmrc)
    completed = subprocess.run(
        ["npm", "publish", str(root / "las.tgz"), "--access", "public", "--ignore-scripts", "--json"],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
receipt = {
    "schema_version": 1,
    "channel": "npm",
    "product": required("WISENT_PRODUCT"),
    "version": required("WISENT_VERSION"),
    "release_uri": required("WISENT_RELEASE_URI"),
    "release_sha256": digest,
    "provider": json.loads(completed.stdout),
}
out = pathlib.Path(required("WISENT_OUTPUT_DIR"))
out.mkdir(parents=True, exist_ok=True)
(out / "npm-receipt.json").write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n")
