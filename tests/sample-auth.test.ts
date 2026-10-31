import test from 'node:test';
import assert from 'node:assert/strict';
import sample from '../api/sample.js';
import { seedWorkspace } from '../src/domain.js';
import type { ApiRequest, ApiResponse } from '../api/_lib/http.js';
const id = '11111111-1111-4111-8111-111111111111';
function response() {
  let body = '';
  const headers = new Map();
  const res = {
    statusCode: 0,
    setHeader: (k: string, v: unknown) => headers.set(k, v),
    end: (v: string) => {
      body = v;
    },
  };
  return { res: res as unknown as ApiResponse, body: () => JSON.parse(body) };
}
function request(headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    headers: {
      host: 'webhooklab.test',
      origin: 'https://webhooklab.test',
      'content-type': 'application/json',
      'x-workspace-mode': 'account',
      'x-workspace-id': id,
      cookie: '__Host-portfolio_webhooklab_access=test_token',
      ...headers,
    },
    body: { raw: '{"type":"account.sample"}', scenario: 'recover', invalidSignature: false },
  } as unknown as ApiRequest;
}
test('account sample rejects cross-origin requests before storage', async () => {
  const out = response();
  await sample(request({ origin: 'https://other.test' }), out.res);
  assert.equal(out.res.statusCode, 403);
});
test('account viewer cannot create a sample and performs no state write', async () => {
  const previous = globalThis.fetch;
  const prevUrl = process.env.SUPABASE_URL,
    prevKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  let writes = 0;
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path.includes('/auth/v1/user')) return Response.json({ id, email: 'viewer@example.com' });
    if (path.endsWith('/portfolio_account_read'))
      return Response.json({
        state: seedWorkspace(),
        revision: 0,
        role: 'viewer',
        workspace: { id, name: 'Read only' },
      });
    writes++;
    throw new Error('Viewer attempted a state write');
  };
  try {
    const out = response();
    await sample(request(), out.res);
    assert.equal(out.res.statusCode, 403);
    assert.match(out.body().error, /role/i);
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = previous;
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = prevKey;
  }
});
