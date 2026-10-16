// Runs Las's MCP server from the declared revision's committed source and sends
// it requests a client can get wrong; every request that names an id must be
// answered, with the JSON-RPC code and the cause, and a notification must not be.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { committedSource } from '../source.mjs';

const journey = fileURLToPath(import.meta.url);
const root = resolve(dirname(journey), '../..');
const run = join(root, '.build', 'mcp-requests', randomUUID());
const home = join(run, 'home');
mkdirSync(home, { recursive: true });
const report = { verdict: 'failed', commands: [], startedAt: new Date().toISOString(), node: process.version };
const save = () => writeFileSync(join(run, 'report.json'), JSON.stringify(report));
function required(name) {
  const value = process.env[name];
  assert.ok(value?.trim(), `${name} is required`);
  return value;
}
async function command(program, args, extra, input) {
  const record = { program, args, input, stdout: '', stderr: '' };
  report.commands.push(record);
  save();
  const env = { ...process.env, HOME: home, ...extra };
  const child = spawn(program, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
    record[stream] += bytes;
    save();
  });
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', error => { record.error = error.message; reject(error); });
    child.once('close', (exit, signal) => { Object.assign(record, { exit, signal }); resolveExit(); });
  });
  child.stdin.end(input);
  await exited;
  save();
  return record;
}
const shape = answers => answers.map(({ id, answer }) => JSON.stringify([id, answer])).sort();
try {
  const success = Number(required('LAS_TEST_SUCCESS_EXIT'));
  const refusal = Number(required('LAS_TEST_REFUSAL_EXIT'));
  assert.ok(Number.isSafeInteger(success) && Number.isSafeInteger(refusal) && success !== refusal);
  const { revision, source } = await committedSource({
    command, root, run, journey, declared: required('LAS_TEST_SOURCE_REVISION'), success,
  });
  report.sourceRevision = revision;
  const protocol = await import(pathToFileURL(join(source, 'src/mcp/protocol.mjs')).href);
  const { CODE_INVALID_PARAMS, CODE_INVALID_REQUEST, CODE_PARSE_ERROR, JSONRPC_VERSION, LAS_VERSION } = protocol;
  const request = (id, method, params) => ({ jsonrpc: JSONRPC_VERSION, id, method, ...(params && { params }) });
  // What each line is answered with: an id and an error code, `result` for a
  // success, or nothing for a notification.
  const cases = [
    { send: request('init', 'initialize', {}), id: 'init', answer: 'result' },
    { send: { jsonrpc: JSONRPC_VERSION, id: 'no-method' }, id: 'no-method', answer: CODE_INVALID_REQUEST },
    { send: 'null', id: null, answer: CODE_INVALID_REQUEST },
    { send: '[]', id: null, answer: CODE_INVALID_REQUEST },
    { send: { jsonrpc: JSONRPC_VERSION, id: 'boolean-method', method: true }, id: 'boolean-method', answer: CODE_INVALID_REQUEST },
    { send: { jsonrpc: JSONRPC_VERSION, method: 'notifications/initialized' } },
    { send: '{"jsonrpc":', id: null, answer: CODE_PARSE_ERROR },
    { send: request('no-params', 'tools/call'), id: 'no-params', answer: CODE_INVALID_PARAMS },
    { send: request('bad-arguments', 'tools/call', { name: 'las__onboarding', arguments: [] }), id: 'bad-arguments', answer: CODE_INVALID_PARAMS },
    { send: request('last', 'ping'), id: 'last', answer: 'result' },
  ];

  // LAS_ONLY names no surface, so no child is federated and only Las answers.
  const input = cases.map(({ send }) => (typeof send === 'string' ? send : JSON.stringify(send))).join('\n') + '\n';
  const served = await command(process.execPath, [join(source, 'src/mcp.mjs')], { LAS_ONLY: `none-${randomUUID()}` }, input);
  assert.equal(served.signal, null, served.stderr);
  assert.equal(served.exit, success, served.stderr);
  assert.equal(served.stderr, '', 'Las wrote no handler failure');
  const answers = served.stdout.trim().split('\n').map(text => JSON.parse(text));
  assert.deepEqual(
    shape(answers.map(answer => ({ id: answer.id, answer: answer.error ? answer.error.code : 'result' }))),
    shape(cases.filter(({ answer }) => answer !== undefined)),
    'every request is answered once with its code, and the notification is not',
  );
  const byId = new Map(answers.filter(answer => answer.id !== null).map(answer => [answer.id, answer]));
  assert.equal(byId.get('init').result.serverInfo.version, LAS_VERSION);
  assert.match(byId.get('no-method').error.message, /method must be a non-empty string/);
  assert.match(byId.get('no-params').error.message, /params\.name must be a string/);
  const parse = answers.find(answer => answer.error?.code === CODE_PARSE_ERROR);
  assert.match(parse.error.message, /^parse error: .+JSON/, 'the parse error names the parser cause');
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
