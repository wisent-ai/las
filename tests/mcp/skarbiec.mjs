// Runs Las's MCP server from the declared revision's committed source with the
// Skarbiec surface federated: a stand-in broker child is built where the
// registry looks for Skarbiec, described, signed and trusted with `las release`,
// and then agents connect. A client that sends no agentId runs as the
// operator's SKARBIEC_MCP_AGENT_ID, one that names another agent is refused,
// a pending capability_request answer passes Las's result policy, and
// access_request_status reaches the broker. Without the operator's identity
// Las refuses to initialize and says what to set.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, constants, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { committedSource, criterionReport } from '../source.mjs';

const journey = fileURLToPath(import.meta.url);
const root = resolve(dirname(journey), '../..');
const run = join(root, '.build', 'mcp-skarbiec', randomUUID());
const home = join(run, 'home');
mkdirSync(home, { recursive: true });
const report = { verdict: 'failed', commands: [], startedAt: new Date().toISOString(), node: process.version };
const save = () => writeFileSync(join(run, 'report.json'), JSON.stringify(report));
// Read and write for the owner alone (chmod(2) S_IRUSR | S_IWUSR), as Las requires of release state.
const OWNER_ONLY = constants.S_IRUSR | constants.S_IWUSR;
// Owner read, write and execute (chmod(2) S_IRWXU), so the stand-in broker can be launched.
const OWNER_EXECUTABLE = constants.S_IRWXU;
// How far ahead the manifest expires: one day, in milliseconds (24 h × 3600 s × 1000 ms).
const MANIFEST_LIFETIME_MS = 24 * 3600 * 1000;
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
try {
  const success = Number(required('LAS_TEST_SUCCESS_EXIT'));
  const refusal = Number(required('LAS_TEST_REFUSAL_EXIT'));
  assert.ok(Number.isSafeInteger(success) && Number.isSafeInteger(refusal) && success !== refusal);
  const { revision, source } = await committedSource({
    command, root, run, journey, declared: required('LAS_TEST_SOURCE_REVISION'), success,
  });
  report.sourceRevision = revision;
  const load = file => import(pathToFileURL(join(source, file)).href);
  const { CODE_INVALID_REQUEST, JSONRPC_VERSION, PROTOCOL_VERSION } = await load('src/mcp/protocol.mjs');
  const { SURFACES } = await load('src/registry/surfaces.mjs');
  const { SKARBIEC_TOOL_SCHEMAS } = await load('src/registry/skarbiec.mjs');
  const skarbiec = SURFACES.find(surface => surface.name === 'skarbiec');
  const agent = `agent-${randomUUID()}`;
  const requestId = randomUUID();
  const capabilityId = randomUUID().replaceAll('-', '').repeat(2);

  // The stand-in broker sits where the committed registry launches Skarbiec
  // (the run directory is that source's workspace) and answers broker v1, but
  // only to the agent identity Las forwards to it.
  const broker = join(dirname(skarbiec.command), 'broker.mjs');
  mkdirSync(dirname(skarbiec.command), { recursive: true });
  writeFileSync(broker, `import readline from 'node:readline';
const tools = ${JSON.stringify([...SKARBIEC_TOOL_SCHEMAS].map(([name, inputSchema]) => ({ name, description: name, inputSchema })))};
const answers = ${JSON.stringify({
    health: { ok: true, service: 'skarbiec-capability-broker', wire: 'skarbiec.redeem.v1', policy_sequence: 1, registry_sequence: 1, active_capabilities: 0, anomaly_count: 0 },
    capability_available: { available: false },
    capability_request: { status: 'pending', request_id: requestId },
    access_request_status: { request_id: requestId, state: 'approved', capability_id: capabilityId },
  })};
const write = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method === 'initialize') return write({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'skarbiec', version: '0' } } });
  if (method === 'tools/list') return write({ id, result: { tools } });
  const known = process.env.SKARBIEC_MCP_AGENT_ID === ${JSON.stringify(agent)};
  const wanted = params.name !== 'access_request_status' || params.arguments.request_id === ${JSON.stringify(requestId)};
  if (method !== 'tools/call' || !known || !wanted) return write({ id, error: { code: -32602, message: 'refused' } });
  write({ id, result: { content: [{ type: 'text', text: JSON.stringify(answers[params.name]) }] } });
});
`);
  for (const path of [process.execPath, broker]) assert.ok(!path.includes("'"), `${path} must not hold a quote`);
  writeFileSync(skarbiec.command, `#!/bin/sh\nexec '${process.execPath}' '${broker}' "$@"\n`);
  chmodSync(skarbiec.command, OWNER_EXECUTABLE);

  const state = join(run, 'release');
  mkdirSync(state);
  const files = {
    key: join(state, 'signing-key.pem'),
    trust: join(state, 'trust-store.json'),
    watermark: join(state, 'watermark.json'),
    manifest: join(state, 'release-manifest.json'),
    signature: join(state, 'release-manifest.sig.json'),
  };
  const environment = {
    LAS_ONLY: 'skarbiec',
    LAS_RELEASE_MANIFEST_FILE: files.manifest,
    LAS_RELEASE_MANIFEST_SIGNATURE_FILE: files.signature,
    LAS_RELEASE_TRUST_STORE_FILE: files.trust,
    LAS_RELEASE_WATERMARK_FILE: files.watermark,
    SKARBIEC_MCP_AGENT_ID: agent,
  };
  const las = (args, extra = {}, input) =>
    command(process.execPath, [join(source, 'src/cli.mjs'), ...args], { ...environment, ...extra }, input);

  const keygen = await las(['release', 'keygen', '--key-id', 'journey', '--private-key', files.key, '--trust-store', files.trust]);
  assert.equal(keygen.exit, success, keygen.stderr);
  assert.ok(!keygen.stdout.includes('PRIVATE KEY'), 'keygen never prints the private key');
  writeFileSync(files.watermark, `${JSON.stringify({ version: 1, sequence: 0 })}\n`, { mode: OWNER_ONLY });
  const entry = await las(['release', 'entry', 'skarbiec']);
  assert.equal(entry.exit, success, entry.stderr);
  const manifest = {
    type: 'las.release-manifest',
    version: 1,
    sequence: 1,
    expires_at: new Date(Date.now() + MANIFEST_LIFETIME_MS).toISOString(),
    surfaces: [JSON.parse(entry.stdout)],
  };
  writeFileSync(files.manifest, JSON.stringify(manifest));
  const signArgs = ['release', 'sign', '--key-id', 'journey', '--private-key', files.key, '--manifest', files.manifest,
    '--signature', files.signature, '--trust-store', files.trust, '--watermark', files.watermark];
  const signed = await las(signArgs);
  assert.equal(signed.exit, success, signed.stderr);

  const request = (id, method, params) => JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, ...(params && { params }) });
  const initialize = extra => request('init', 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'journey', version: '0' }, ...extra });
  const serve = async (lines, extra) => {
    const served = await command(process.execPath, [join(source, 'src/mcp.mjs')], { ...environment, ...extra }, `${lines.join('\n')}\n`);
    assert.equal(served.exit, success, served.stderr);
    return new Map(served.stdout.trim().split('\n').map(text => JSON.parse(text)).map(answer => [answer.id, answer]));
  };
  const payload = answer => {
    assert.ok(answer.result, JSON.stringify(answer));
    return JSON.parse(answer.result.content[0].text);
  };

  // A client that names no agent (omp, Claude Code, Codex) runs as the operator's.
  const capability = { purpose: 'brama.provider.authenticate', resource: 'provider:journey', target: 'brama', ttl_seconds: 1, max_uses: 1 };
  const plain = await serve([
    initialize(),
    request('list', 'tools/list'),
    request('ask', 'tools/call', { name: 'skarbiec__capability_request', arguments: capability }),
    request('status', 'tools/call', { name: 'skarbiec__access_request_status', arguments: { request_id: requestId } }),
  ]);
  assert.ok(plain.get('init').result, JSON.stringify(plain.get('init')));
  assert.deepEqual(
    plain.get('list').result.tools.map(tool => tool.name).filter(name => name.startsWith('skarbiec__')),
    skarbiec.allowTools.map(name => `skarbiec__${name}`),
  );
  assert.deepEqual(payload(plain.get('ask')), { status: 'pending', request_id: requestId });
  assert.deepEqual(payload(plain.get('status')), { request_id: requestId, state: 'approved', capability_id: capabilityId });

  // The same agent named explicitly is admitted; another agent is not.
  const same = await serve([initialize({ agentId: agent })]);
  assert.ok(same.get('init').result, JSON.stringify(same.get('init')));
  const other = await serve([initialize({ agentId: `${agent}-other` })]);
  assert.equal(other.get('init').error?.code, CODE_INVALID_REQUEST);
  assert.match(other.get('init').error.message, /agent identity rejected/);

  // No operator identity: initialization is refused and names what to set.
  const unset = await serve([initialize()], { SKARBIEC_MCP_AGENT_ID: undefined });
  assert.equal(unset.get('init').error?.code, CODE_INVALID_REQUEST);
  assert.match(unset.get('init').error.message, /set SKARBIEC_MCP_AGENT_ID/);

  // Las has now held sequence 1; signing that sequence again is refused.
  const replay = await las(signArgs);
  assert.equal(replay.exit, refusal, replay.stderr);
  assert.match(replay.stderr, /not above the watermark/);

  criterionReport({
    run, revision, journey, commands: report.commands, success,
    observed: { plain: [...plain.values()], same: [...same.values()], other: [...other.values()], unset: [...unset.values()], replay: replay.stderr },
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
