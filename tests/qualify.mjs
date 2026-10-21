#!/usr/bin/env node
// Qualifies one committed revision of las by its journeys, for a defect
// register's revision-bound completion probe:
//
//   node tests/qualify.mjs <revision> <journey>...
//
// where a journey is a path below tests/ without .mjs (catalog/load,
// cli/invocation, mcp/requests, onboarding/state). Each journey already takes
// the revision's committed source out of git into its own run directory; this
// runs every named one with LAS_TEST_SOURCE_REVISION set to the revision,
// passing on the caller's LAS_TEST_SUCCESS_EXIT, LAS_TEST_REFUSAL_EXIT and
// LAS_TEST_USAGE_EXIT. Standard output
// lists the journeys that failed, one per line, and is empty when every one
// passed; the journeys' own output goes to standard error. A revision git
// cannot name ends the run as failed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// argv holds node and this script before the caller's words.
const [, , revision, ...journeys] = process.argv;
assert.ok(revision && journeys.length, 'usage: node tests/qualify.mjs <revision> <journey>...');
// A run succeeded when it started, no signal ended it and it exited zero
// (https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options).
const succeeded = (run) => !run.error && run.signal === null && !run.status;

const resolved = spawnSync('git', ['-C', root, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' });
assert.ok(succeeded(resolved), `git cannot name ${revision} as a commit: ${resolved.stderr}`);
const commit = resolved.stdout.trim();

for (const name of journeys) {
  const path = join(root, 'tests', `${name}.mjs`);
  if (!existsSync(path)) {
    console.log(`${name}: no such journey in this checkout`);
    continue;
  }
  const ran = spawnSync(process.execPath, [path], {
    cwd: root,
    env: { ...process.env, LAS_TEST_SOURCE_REVISION: commit },
    stdio: ['ignore', process.stderr, process.stderr],
  });
  if (!succeeded(ran)) console.log(`${name}: failed (${ran.status ?? ran.signal})`);
}
