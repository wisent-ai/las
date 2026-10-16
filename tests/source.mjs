// The committed source a journey runs: the declared revision's package, taken
// out of git into the run's own directory. A checkout other people work in
// holds their uncommitted files; they neither reach the run nor stop it, and
// the journey itself must match the revision it qualifies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Resolve LAS_TEST_SOURCE_REVISION and extract its `src/` and `package.json`
 * into `<run>/source`. `command(program, args)` runs one recorded process in
 * the checkout; `journey` is the path of the calling journey file.
 */
export async function committedSource({ command, root, run, journey, declared, success }) {
  const resolved = await command('git', ['rev-parse', '--verify', `${declared}^{commit}`]);
  assert.equal(resolved.exit, success, resolved.stderr);
  const revision = resolved.stdout.trim();
  const own = relative(root, journey);
  const drift = await command('git', ['diff', '--name-only', revision, '--', own, 'tests/source.mjs']);
  assert.equal(drift.exit, success, drift.stderr);
  assert.equal(drift.stdout.trim(), '', `${own} and tests/source.mjs must be the ones ${revision} holds`);
  const archive = join(run, 'source.tar');
  const written = await command('git', ['archive', '--format=tar', `--output=${archive}`, revision, 'src', 'package.json']);
  assert.equal(written.exit, success, written.stderr);
  const source = join(run, 'source');
  mkdirSync(source);
  const extracted = await command('tar', ['-xf', archive, '-C', source]);
  assert.equal(extracted.exit, success, extracted.stderr);
  return { revision, source };
}

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * When LAS_JOURNEY_REPORT names a path, write there the report a defect
 * register reads as a repair's evidence: the defect LAS_JOURNEY_SUBJECT names,
 * the criterion LAS_JOURNEY_CRITERION states, the revision, the bytes run and
 * the product invocations that answered with `success`. Refusals the journey
 * expected belong in `observed`, with their exit statuses.
 */
export function criterionReport({ run, revision, journey, commands, observed, success }) {
  const path = process.env.LAS_JOURNEY_REPORT;
  if (path === undefined) return;
  const named = name => {
    const value = process.env[name];
    assert.ok(value?.trim(), `${name} names what the report LAS_JOURNEY_REPORT asks for answers`);
    return value;
  };
  assert.ok(Object.keys(observed).length, 'a report carries the final state the journey observed');
  writeFileSync(path, JSON.stringify({
    defectId: named('LAS_JOURNEY_SUBJECT'),
    criterion: named('LAS_JOURNEY_CRITERION'),
    sourceRevision: revision,
    result: 'passed',
    binarySha256: sha256(join(run, 'source.tar')),
    testSha256: sha256(journey),
    commands: commands
      .filter(({ exit }) => exit === success)
      .map(({ program, args, exit, stderr }) => ({ executable: program, args, exit, stderr })),
    observedFinalState: observed,
  }));
}
