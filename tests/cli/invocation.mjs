// Runs the product CLI from the declared revision's committed source and
// checks how it answers the way it is invoked: help at every level prints the
// usage on standard output and succeeds, and a command or surface it does not
// know is a usage refusal that names what it does know.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { committedSource, criterionReport } from '../source.mjs';

const journey = fileURLToPath(import.meta.url);
const root = resolve(dirname(journey), '../..');
const run = join(root, '.build', 'cli-invocation', randomUUID());
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
function exitStatus(name) {
  const value = Number(required(name));
  assert.ok(Number.isSafeInteger(value), `${name} is an exit status`);
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
  const success = exitStatus('LAS_TEST_SUCCESS_EXIT');
  const usage = exitStatus('LAS_TEST_USAGE_EXIT');
  assert.notEqual(success, usage, 'a usage refusal is not a success');
  const { revision, source } = await committedSource({
    command, root, run, journey, declared: required('LAS_TEST_SOURCE_REVISION'), success,
  });
  report.sourceRevision = revision;
  const cli = join(source, 'src/cli.mjs');
  const las = args => command(process.execPath, [cli, ...args]);
  const helped = async args => {
    const answered = await las(args);
    assert.equal(answered.signal, null, answered.stderr);
    assert.equal(answered.exit, success, `las ${args.join(' ')}: ${answered.stderr}`);
    assert.match(answered.stdout, /^usage: las /, `las ${args.join(' ')} prints no usage on stdout`);
    return answered;
  };

  for (const args of [['--help'], ['-h'], ['help'], ['check', '-h']]) await helped(args);
  const adoptHelp = await helped(['adopt', '--help']);
  assert.match(adoptHelp.stdout, /adopt \[--replace\]/, 'las adopt --help names the adopt command');

  const unknownCommand = await las(['no-such-command']);
  assert.equal(unknownCommand.exit, usage, unknownCommand.stderr);
  assert.match(unknownCommand.stderr, /unknown command 'no-such-command'/);
  assert.match(unknownCommand.stderr, /usage: las /, 'an unknown command is answered with the usage');

  const unknownSurface = await las(['check', 'no-such-surface']);
  assert.equal(unknownSurface.exit, usage, unknownSurface.stderr);
  assert.match(unknownSurface.stderr, /unknown surface 'no-such-surface'; known: \S/, 'an unknown surface names the known ones');

  const refusals = report.commands
    .filter(({ exit }) => exit === usage)
    .map(({ args, exit, stderr }) => ({ args, exit, stderr }));
  criterionReport({ run, revision, journey, commands: report.commands, success, observed: { refusals } });
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
