// Runs the product CLI from the declared clean source against catalogues it
// cannot inspect, read or parse; every refusal must carry the path and cause.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, constants, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from '../../src/catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = join(root, '.build', 'catalog-load', randomUUID());
const home = join(run, 'home');
mkdirSync(home, { recursive: true });
const report = { verdict: 'failed', commands: [], startedAt: new Date().toISOString(), node: process.version };
const save = () => writeFileSync(join(run, 'report.json'), JSON.stringify(report));
function required(name) {
  const value = process.env[name];
  assert.ok(value?.trim(), `${name} is required`);
  return value;
}
async function command(program, args, extra) {
  const record = { program, args, stdout: '', stderr: '' };
  report.commands.push(record);
  save();
  const env = { ...process.env, HOME: home, ...extra };
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
// Strips every permission bit from the measured mode; the original is restored after.
const anyAccess = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;
async function sealed(target, body) {
  const original = statSync(target).mode;
  chmodSync(target, original & ~anyAccess);
  try {
    await body();
  } finally {
    chmodSync(target, original);
  }
}
try {
  const success = Number(required('LAS_TEST_SUCCESS_EXIT'));
  const refusal = Number(required('LAS_TEST_REFUSAL_EXIT'));
  assert.ok(Number.isSafeInteger(success) && Number.isSafeInteger(refusal) && success !== refusal);
  const revision = await command('git', ['rev-parse', 'HEAD']);
  assert.equal(revision.exit, success, revision.stderr);
  assert.equal(revision.stdout.trim(), required('LAS_TEST_SOURCE_REVISION'));
  report.sourceRevision = revision.stdout.trim();
  const clean = await command('git', ['status', '--porcelain']);
  assert.equal(clean.exit, success, clean.stderr);
  assert.equal(clean.stdout.trim(), '', 'commit the candidate before qualification');
  const cli = join(root, 'src/cli.mjs');
  report.cliSha256 = createHash('sha256').update(readFileSync(cli)).digest('hex');
  const list = catalogue => command(process.execPath, [cli, 'list'], { LAS_CATALOG_PATH: catalogue });
  const empty = JSON.stringify({ schemaVersion: SCHEMA_VERSION, registrations: [] });

  const absent = join(run, 'absent', 'catalog.json');
  const none = await list(absent);
  assert.equal(none.signal, null, none.stderr);
  assert.equal(none.exit, success, none.stderr);

  const directory = join(run, 'directory');
  mkdirSync(directory);
  const notFile = await list(directory);
  assert.equal(notFile.exit, refusal, notFile.stderr);
  assert.ok(notFile.stderr.includes(directory) && /regular file/.test(notFile.stderr), notFile.stderr);

  const malformed = join(run, 'malformed.json');
  writeFileSync(malformed, empty.slice(empty.indexOf('{'), empty.lastIndexOf('}')));
  const parse = await list(malformed);
  assert.equal(parse.exit, refusal, parse.stderr);
  assert.ok(parse.stderr.includes(malformed) && /not valid JSON/.test(parse.stderr), parse.stderr);
  assert.match(parse.stderr, /position \d+/, 'parse refusal names where the catalogue breaks');

  const unreadableFile = join(run, 'unreadable.json');
  writeFileSync(unreadableFile, empty);
  await sealed(unreadableFile, async () => {
    const unreadable = await list(unreadableFile);
    assert.equal(unreadable.exit, refusal, unreadable.stderr);
    assert.ok(unreadable.stderr.includes(unreadableFile) && /cannot be read/.test(unreadable.stderr), unreadable.stderr);
    assert.match(unreadable.stderr, /EACCES/, 'read refusal names the system error');
  });

  const closed = join(run, 'closed');
  mkdirSync(closed);
  const hidden = join(closed, 'catalog.json');
  writeFileSync(hidden, empty);
  await sealed(closed, async () => {
    const uninspectable = await list(hidden);
    assert.equal(uninspectable.exit, refusal, uninspectable.stderr);
    assert.ok(uninspectable.stderr.includes(hidden) && /cannot be inspected/.test(uninspectable.stderr), uninspectable.stderr);
    assert.match(uninspectable.stderr, /EACCES/, 'inspect refusal names the system error');
  });
  report.verdict = 'passed';
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  rmSync(home, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  save();
  console.log(join(run, 'report.json'));
}
