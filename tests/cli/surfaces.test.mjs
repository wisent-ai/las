// The las command-line program as a user runs it, under a home directory the
// journey owns: `las list` reports every federated surface of the registry,
// the usage names the same surfaces, and a surface the registry does not hold
// is refused by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SURFACES } from "../../src/registry.mjs";

const checkout = fileURLToPath(new URL("../../", import.meta.url));
const home = fileURLToPath(new URL("../../.build/test-home/", import.meta.url));
mkdirSync(home, { recursive: true });

function las(...args) {
  return spawnSync(process.execPath, ["src/cli.mjs", ...args], {
    cwd: checkout,
    env: { ...process.env, HOME: home, LAS_ONLY: "", LAS_SKIP: "" },
    encoding: "utf8",
  });
}

test("las list reports every surface of the registry", () => {
  const run = las("list");
  assert.equal(run.status, 0, run.stderr);
  const rows = JSON.parse(run.stdout);
  assert.deepEqual(rows.map((row) => row.surface), SURFACES.map((surface) => surface.name));
  for (const row of rows) {
    assert.equal(typeof row.summary, "string", JSON.stringify(row));
    assert.ok(row.summary.length > 0, JSON.stringify(row));
    assert.ok(["compiled-default", "adopted", "absent"].includes(row.registration), JSON.stringify(row));
    assert.equal(typeof row.configured, "boolean", JSON.stringify(row));
    assert.equal(typeof row.active, "boolean", JSON.stringify(row));
  }
});

test("a surface the registry does not hold is refused by name", () => {
  const run = las("tools", "no-such-surface");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /unknown surface 'no-such-surface'/);
});

test("the usage names every surface", () => {
  const run = las();
  for (const surface of SURFACES) {
    assert.match(run.stderr, new RegExp(`\\b${surface.name}\\b`));
  }
});
