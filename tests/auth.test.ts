import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandler, getAccountSession } from '../api/_lib/auth.ts';
import { enforceMutationOrigin } from '../api/_lib/account-http.ts';
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { role: 'owner' },
};
const access = 'verified.access.token';
const refresh = 'refresh_token_private';
const cookies = `__Host-portfolio_webhooklab_access=${access}; __Host-portfolio_webhooklab_refresh=${refresh}`;
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});
function res() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
    body: '',
    setHeader(k: string, v: string | string[]) {
      this.headers[k] = v;
    },
    end(v?: string) {
      this.body = v ?? '';
    },
  };
}
const headers = {
  host: 'app.example.test',
  origin: 'https://app.example.test',
  'content-type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const handler = createAuthHandler('webhooklab');
test('login stores server tokens only in host-only protected cookies', async () => {
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    const path = String(url);
    if (path.includes('grant_type=password')) {
      assert.equal(JSON.parse(String(init?.body)).email, user.email);
      return json({
        access_token: access,
        refresh_token: refresh,
        expires_in: 3600,
      });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + access);
    return json(user);
  }) as typeof fetch;
  const out = res();
  await handler(
    {
      method: 'POST',
      headers,
      body: {
        action: 'login',
        email: user.email,
        password: 'ValidPassword123!',
      },
    },
    out,
  );
  assert.equal(out.statusCode, 200);
  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(out.body), {
    user: { id: user.id, email: user.email },
  });
  const set = out.headers['Set-Cookie'] as string[];
  assert.equal(set.length, 2);
  for (const cookie of set) {
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/);
  }
  assert.ok(!out.body.includes(access) && !out.body.includes(refresh));
});
test('signup respects provider confirmation without creating a session', async () => {
  globalThis.fetch = (async () => json({ id: user.id, email: user.email })) as typeof fetch;
  const out = res();
  await handler(
    {
      method: 'POST',
      headers,
      body: {
        action: 'signup',
        email: user.email,
        password: 'ValidPassword123!',
      },
    },
    out,
  );
  assert.equal(out.statusCode, 200);
  assert.deepEqual(JSON.parse(out.body), {
    user: null,
    confirmationRequired: true,
  });
  assert.equal(out.headers['Set-Cookie'], undefined);
});
test('session verifies upstream identity, never cookie claims or metadata', async () => {
  let requested = '';
  globalThis.fetch = (async (url) => {
    requested = String(url);
    return json(user);
  }) as typeof fetch;
  const out = res();
  await handler({ method: 'GET', headers: { cookie: cookies } }, out);
  assert.match(requested, /\/auth\/v1\/user$/);
  assert.deepEqual(JSON.parse(out.body), {
    user: { id: user.id, email: user.email },
  });
});
test('expired access refreshes and verifies the new access upstream', async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (url, init) => {
    paths.push(String(url));
    if (paths.length === 1) return json({ message: 'expired' }, 401);
    if (paths.length === 2) {
      assert.equal(JSON.parse(String(init?.body)).refresh_token, refresh);
      return json({
        access_token: 'new.access.token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer new.access.token');
    return json(user);
  }) as typeof fetch;
  const out = res();
  const session = await getAccountSession(
    'webhooklab',
    { method: 'GET', headers: { cookie: cookies } },
    out,
  );
  assert.equal(session?.user.id, user.id);
  assert.equal(paths.length, 3);
  assert.ok(Array.isArray(out.headers['Set-Cookie']));
});
test('invalid access and refresh clear cookies and return anonymous', async () => {
  globalThis.fetch = (async () => json({ message: 'secret details' }, 401)) as typeof fetch;
  const out = res();
  await handler({ method: 'GET', headers: { cookie: cookies } }, out);
  assert.equal(out.statusCode, 200);
  assert.deepEqual(JSON.parse(out.body), { user: null });
  assert.match(String(out.headers['Set-Cookie']), /Max-Age=0/);
  assert.ok(!out.body.includes('secret'));
});
test('cookie mutations require exact same-origin and JSON before network work', async () => {
  globalThis.fetch = (async () => {
    assert.fail('must reject locally');
  }) as typeof fetch;
  for (const bad of [
    { ...headers, origin: 'https://attacker.test' },
    { host: headers.host, 'content-type': 'application/json' },
    { ...headers, 'content-type': 'text/plain' },
  ]) {
    const out = res();
    await handler({ method: 'POST', headers: bad, body: { action: 'logout' } }, out);
    assert.ok([403, 415].includes(out.statusCode));
  }
  assert.throws(() =>
    enforceMutationOrigin({
      headers: { ...headers, 'sec-fetch-site': 'cross-site' },
    }),
  );
});
test('logout revokes upstream session and clears both cookies', async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (url) => {
    paths.push(String(url));
    return String(url).includes('/logout') ? new Response(null, { status: 204 }) : json(user);
  }) as typeof fetch;
  const out = res();
  await handler(
    {
      method: 'POST',
      headers: { ...headers, cookie: cookies },
      body: { action: 'logout' },
    },
    out,
  );
  assert.equal(out.statusCode, 200);
  assert.ok(paths.some((p) => p.endsWith('/logout?scope=local')));
  assert.match(String(out.headers['Set-Cookie']), /Max-Age=0/);
});
test('rate limits and upstream errors never return provider internals', async () => {
  for (const status of [429, 500]) {
    globalThis.fetch = (async () =>
      json({ message: 'database secret details' }, status)) as typeof fetch;
    const out = res();
    await handler(
      {
        method: 'POST',
        headers,
        body: {
          action: 'login',
          email: user.email,
          password: 'ValidPassword123!',
        },
      },
      out,
    );
    assert.equal(out.statusCode, status === 429 ? 429 : 503);
    assert.ok(!out.body.includes('secret details'));
  }
});

test('existing accounts can sign in with older short provider passwords', async () => {
  globalThis.fetch = (async (url) =>
    String(url).endsWith('/user')
      ? json(user)
      : json({ access_token: access, refresh_token: refresh, expires_in: 3600 })) as typeof fetch;
  const out = res();
  await handler(
    { method: 'POST', headers, body: { action: 'login', email: user.email, password: 'old-pass' } },
    out,
  );
  assert.equal(out.statusCode, 200);
});

test('signup rejects passwords below twelve characters without contacting provider', async () => {
  globalThis.fetch = (async () => {
    assert.fail('must reject locally');
  }) as typeof fetch;
  const out = res();
  await handler(
    {
      method: 'POST',
      headers,
      body: { action: 'signup', email: user.email, password: 'old-pass' },
    },
    out,
  );
  assert.equal(out.statusCode, 400);
});
