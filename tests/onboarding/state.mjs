// Runs the product CLI from the declared revision's committed source; no
// transport is simulated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { committedSource } from '../source.mjs';

const journey = fileURLToPath(import.meta.url);
const root = resolve(dirname(journey), '../..');
const run = join(root, '.build', 'onboarding-state', randomUUID());
const home = join(run, 'home');
const state = join(run, 'state');
mkdirSync(home, { recursive: true });
mkdirSync(state, { recursive: true });
const report = { verdict: 'failed', commands: [], startedAt: new Date().toISOString(), node: process.version };
const save = () => writeFileSync(join(run, 'report.json'), JSON.stringify(report));
function required(name) {
  const value = process.env[name];
  assert.ok(value?.trim(), `${name} is required`);
  return value;
}
async function command(program, args) {
  const record = { program, args, stdout: '', stderr: '' };
  report.commands.push(record);
  save();
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: state };
  delete env.STADO_INTEGRATION_API_URL;
  delete env.LAS_STADO_INTEGRATION_TOKEN;
  const child = spawn(program, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
    record[stream] += bytes;
    save();
  });
  await new Promise((resolveExit, reject) => {
    child.once('error', error => { record.error = error.message; reject(error); });
    child.once('close', (exit, signal) => { Object.assign(record, { exit, signal }); resolveExit(); });
  });
  save();
  return record;
}
try {
  const success = Number(required('LAS_TEST_SUCCESS_EXIT'));
  const refusal = Number(required('LAS_TEST_REFUSAL_EXIT'));
  assert.ok(Number.isSafeInteger(success) && Number.isSafeInteger(refusal) && success !== refusal);
  const { revision, source } = await committedSource({
    command, root, run, journey, declared: required('LAS_TEST_SOURCE_REVISION'), success,
  });
  report.sourceRevision = revision;
  const cli = join(source, 'src/cli.mjs');
  report.cliSha256 = createHash('sha256').update(readFileSync(cli)).digest('hex');
  const invoke = action => command(process.execPath, [cli, 'onboarding', action]);
  const started = await invoke('show');
  assert.equal(started.signal, null, started.stderr);
  assert.equal(started.exit, success, started.stderr);
  const path = join(state, 'las', 'onboarding.json');
  const original = readFileSync(path);
  writeFileSync(join(run, 'original.json'), original);
  const retained = JSON.parse(original);
  assert.ok(typeof retained.installation_id === 'string' && retained.installation_id.trim());
  for (const invalid of [
    { bytes: '{', cause: 'JSON' },
    { bytes: JSON.stringify({ ...retained, schema_version: null }), cause: 'schema_version' },
    ...[
      ['installation_id', null],
      ['installation_id', ''],
      ['installation_id', '   '],
      ['pending_events', {}],
      ['evidence', []],
      ['meta', []],
    ].map(([field, value]) => ({
      bytes: JSON.stringify({ ...retained, [field]: value }),
      cause: field,
    })),
  ]) {
    writeFileSync(path, invalid.bytes);
    for (const action of ['status', 'advance']) {
      const failed = await invoke(action);
      assert.equal(failed.signal, null, failed.stderr);
      assert.equal(failed.exit, refusal, failed.stderr);
      assert.ok(failed.stderr.includes(path) && failed.stderr.includes(invalid.cause), failed.stderr);
      assert.equal(readFileSync(path, 'utf8'), invalid.bytes, 'refusal replaced retained bytes');
    }
  }
  writeFileSync(path, original);
  const backup = join(run, 'owned-state.backup');
  renameSync(path, backup);
  mkdirSync(path);
  try {
    const failed = await invoke('status');
    assert.equal(failed.signal, null, failed.stderr);
    assert.equal(failed.exit, refusal, failed.stderr);
    assert.ok(failed.stderr.includes(path), failed.stderr);
    assert.match(failed.stderr, /EISDIR/, 'the read refusal names the system error');
    assert.equal(statSync(path).isDirectory(), true, 'read refusal replaced its input');
  } finally {
    rmSync(path, { recursive: true });
    renameSync(backup, path);
  }
  const recovered = await invoke('status');
  assert.equal(recovered.signal, null, recovered.stderr);
  assert.equal(recovered.exit, success, recovered.stderr);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).installation_id, retained.installation_id);
  report.verdict = 'passed';
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  save();
  console.log(join(run, 'report.json'));
}
