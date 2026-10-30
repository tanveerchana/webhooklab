import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkspace, mutateWorkspace, StorageError, ContentionError } from '../api/_lib/store.ts';
import { createWorkspaceHandler } from '../api/_lib/workspace.ts';

const token = 'a'.repeat(64);
const originalFetch = globalThis.fetch;
const env = { ...process.env };
beforeEach(() => { process.env.SUPABASE_URL = 'https://project.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'; });
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...env }; });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fakeStore(initial?: {state: {count: number}; revision: number}) {
  let row = initial;
  const seen: {url: string; init?: RequestInit}[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({url: String(url), init});
    assert.equal(new Headers(init?.headers).get('x-demo-token'), token);
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_publishable_test');
    if (init?.method !== 'POST') return json(row ? [row] : []);
    const body = JSON.parse(String(init.body));
    if ((!row && body.p_expected_revision === -1) || row?.revision === body.p_expected_revision) {
      row = {state: body.p_state, revision: body.p_expected_revision + 1};
      return json({ok: true, ...row});
    }
    return json({ok: false});
  }) as typeof fetch;
  return {seen, get row() { return row; }};
}
test('GET seeds via CAS then loads the same isolated workspace', async () => {
  const db = fakeStore();
  assert.deepEqual(await loadWorkspace('webhooklab', token, () => ({count: 0})), {state: {count: 0}, revision: 0});
  assert.deepEqual(await loadWorkspace('webhooklab', token, () => ({count: 99})), {state: {count: 0}, revision: 0});
  assert.equal(db.seen.filter(x => x.init?.method === 'POST').length, 1);
});
test('mutation returns committed revision and domain result', async () => {
  fakeStore({state: {count: 4}, revision: 3});
  const saved = await mutateWorkspace('fieldpilot', token, () => ({count: 0}), state => ({state: {count: state.count + 1}, result: {id: 'r1'}}));
  assert.deepEqual(saved, {state: {count: 5}, revision: 4, result: {id: 'r1'}});
});
test('conflict retries from fresh cloned state, not mutated prior state', async () => {
  let reads = 0; let writes = 0;
  globalThis.fetch = (async (_url, init) => {
    if (init?.method !== 'POST') return json([{state: {count: ++reads === 1 ? 2 : 7}, revision: reads}]);
    const body = JSON.parse(String(init.body));
    if (++writes === 1) return json({ok: false});
    assert.equal(body.p_state.count, 8);
    return json({ok: true, state: body.p_state, revision: body.p_expected_revision + 1});
  }) as typeof fetch;
  assert.equal((await mutateWorkspace('payroute', token, () => ({count: 0}), state => { state.count++; return state; })).state.count, 8);
  assert.equal(writes, 2);
});
test('bounded retries surface contention', async () => {
  let writes = 0;
  globalThis.fetch = (async (_url, init) => init?.method === 'POST' ? (writes++, json({ok: false})) : json([{state: {count: 0}, revision: 1}])) as typeof fetch;
  await assert.rejects(mutateWorkspace('payroute', token, () => ({count: 0}), state => state), ContentionError);
  assert.equal(writes, 5);
});
test('network failures and invalid storage responses are sanitized', async () => {
  globalThis.fetch = (async () => { throw new Error('private database internals'); }) as typeof fetch;
  await assert.rejects(loadWorkspace('webhooklab', token, () => ({})), e => e instanceof StorageError && !e.message.includes('private'));
});
function response() {
  return {statusCode: 200, headers: {} as Record<string, string>, body: '', setHeader(name: string, value: string) {this.headers[name] = value;}, end(value?: string) {this.body = value ?? '';}};
}
const handler = createWorkspaceHandler({app: 'webhooklab', seed: () => ({count: 0}), reduce: (state: {count: number}, command: any) => { if (command.type !== 'increment') throw new Error('Unknown command.'); return {count: state.count + 1}; }});
test('HTTP rejects malformed tokens before any storage request', async () => {
  globalThis.fetch = (async () => { throw new Error('must not call'); }) as typeof fetch;
  for (const auth of [undefined, 'Bearer '+ 'A'.repeat(64), 'Bearer short', 'Bearer '+token+' extra']) {
    const res = response(); await handler({method: 'GET', headers: {authorization: auth}}, res);
    assert.equal(res.statusCode, 401); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});
test('HTTP rejects malformed commands and oversized body', async () => {
  fakeStore();
  for (const body of ['{', {command: null}, {command: {type: ''}}, {command: {type: 'x', data: 'x'.repeat(65536)}}]) {
    const res = response(); await handler({method: 'POST', headers: {authorization: 'Bearer '+token}, body}, res); assert.equal(res.statusCode, 400);
  }
});
test('HTTP accepts parsed and string bodies; maps domain errors', async () => {
  fakeStore();
  const res = response(); await handler({method: 'POST', headers: {authorization: 'Bearer '+token}, body: JSON.stringify({command: {type: 'increment'}})}, res);
  assert.equal(res.statusCode, 200); assert.equal(JSON.parse(res.body).state.count, 1);
  const bad = response(); await handler({method: 'POST', headers: {authorization: 'Bearer '+token}, body: {command: {type: 'unknown'}}}, bad);
  assert.equal(bad.statusCode, 400); assert.equal(JSON.parse(bad.body).error, 'Unknown command.');
});
test('HTTP conceals storage internals and rejects unsafe database bases', async () => {
  process.env.SUPABASE_URL = 'http://169.254.169.254';
  const res = response(); await handler({method: 'GET', headers: {authorization: 'Bearer '+token}}, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.includes('169.254'), false);
});
test('concurrent initializer reloads committed seed after insert conflict', async () => {
  let reads = 0;
  globalThis.fetch = (async (_url, init) => {
    if (init?.method === 'POST') return json({ok: false});
    return json(++reads === 1 ? [] : [{state: {count: 17}, revision: 0}]);
  }) as typeof fetch;
  assert.deepEqual(await loadWorkspace('webhooklab', token, () => ({count: 9})), {state: {count: 17}, revision: 0});
});
test('invalid revisions and oversized upstream bodies are storage failures', async () => {
  for (const payload of [[{state: {}, revision: -1}], [{state: {}, revision: '0'}], 'x'.repeat(1024 * 1024 + 1)]) {
    globalThis.fetch = (async () => json(payload)) as typeof fetch;
    await assert.rejects(loadWorkspace('webhooklab', token, () => ({})), StorageError);
  }
});
test('raw domain objects with a state property and other fields stay raw', async () => {
  let saved: unknown;
  globalThis.fetch = (async (_url, init) => {
    if (init?.method !== 'POST') return json([{state: {state: 'initial', count: 2}, revision: 0}]);
    const body = JSON.parse(String(init.body)); saved = body.p_state;
    return json({ok: true, state: saved, revision: 1});
  }) as typeof fetch;
  await mutateWorkspace('webhooklab', token, () => ({state: 'initial', count: 0}), state => ({...state, count: state.count + 1}));
  assert.deepEqual(saved, {state: 'initial', count: 3});
});
test('streamed Node request body obeys the limit and parses a normal command', async () => {
  fakeStore();
  const headers = {authorization: 'Bearer '+token};
  const valid = response();
  await handler({method: 'POST', headers, async *[Symbol.asyncIterator]() {yield Buffer.from('{"command":'); yield Buffer.from('{"type":"increment"}}');}}, valid);
  assert.equal(valid.statusCode, 200);
  const large = response();
  await handler({method: 'POST', headers, async *[Symbol.asyncIterator]() {yield Buffer.alloc(65537);}}, large);
  assert.equal(large.statusCode, 400);
});
test('HTTP maps exhausted contention to 409 and unsupported methods to 405', async () => {
  globalThis.fetch = (async (_url, init) => init?.method === 'POST' ? json({ok: false}) : json([{state: {count: 0}, revision: 0}])) as typeof fetch;
  const conflicted = response(); await handler({method: 'POST', headers: {authorization: 'Bearer '+token}, body: {command: {type: 'increment'}}}, conflicted);
  assert.equal(conflicted.statusCode, 409);
  const method = response(); await handler({method: 'DELETE', headers: {authorization: 'Bearer '+token}}, method);
  assert.equal(method.statusCode, 405); assert.equal(method.headers.Allow, 'GET, POST');
});
test('server rejects a secret key before network access', async () => {
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_do_not_forward';
  globalThis.fetch = (async () => { assert.fail('secret key must never be forwarded'); }) as typeof fetch;
  await assert.rejects(loadWorkspace('webhooklab', token, () => ({})), StorageError);
});
