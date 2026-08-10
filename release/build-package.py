#!/usr/bin/env python3
import json
import pathlib
import shutil
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
out = root / "dist"
shutil.rmtree(out, ignore_errors=True)
out.mkdir()
result = subprocess.run(
    ["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", str(out)],
    cwd=root,
    check=True,
    capture_output=True,
    text=True,
)
records = json.loads(result.stdout)
if len(records) != 1:
    raise RuntimeError("npm pack did not produce exactly one artifact")
source = out / records[0]["filename"]
target = out / "las.tgz"
source.replace(target)
(target.with_suffix(".tgz.sha256")).write_text(__import__("hashlib").sha256(target.read_bytes()).hexdigest() + "\n")
