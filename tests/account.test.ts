import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountCommandAllowed,
  loadAccountWorkspace,
  mutateAccountWorkspace,
} from '../api/_lib/account.ts';
import { createTeamHandler } from '../api/_lib/team.ts';
import {
  loadIntegrationWorkspace,
  mutateIntegrationWorkspace,
} from '../api/_lib/account-integration.ts';
import { createWorkspaceHandler } from '../api/_lib/workspace.ts';
import { ApiError } from '../api/_lib/account-http.ts';
const fetchOriginal = globalThis.fetch,
  envOriginal = { ...process.env };
const id = '22222222-2222-4222-8222-222222222222';
const session = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.test',
  },
  accessToken: 'verified.access.token',
};
const backend = 'b'.repeat(64),
  integration = 'whk_ingest_' + 'a'.repeat(64);
const headers = {
  host: 'app.example.test',
  origin: 'https://app.example.test',
  'content-type': 'application/json',
  cookie: '__Host-portfolio_fieldpilot_access=verified.access.token',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const row = (state: unknown, role = 'editor', revision = 0) => ({
  state,
  role,
  revision,
  workspace: { id, name: 'Synthetic team' },
});
function response() {
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
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.PORTFOLIO_BACKEND_KEY = backend;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  process.env = { ...envOriginal };
});
test('app-specific permissions do not accept forged or unsupported roles', () => {
  assert.equal(accountCommandAllowed('fieldpilot', 'staff', 'move_job'), true);
  assert.equal(accountCommandAllowed('fieldpilot', 'staff', 'pay_invoice'), false);
  assert.equal(accountCommandAllowed('payroute', 'editor', 'provider'), false);
  assert.equal(accountCommandAllowed('webhooklab', 'editor', 'rotate-secret'), false);
  assert.equal(accountCommandAllowed('webhooklab', 'editor', 'sample'), true);
  assert.equal(accountCommandAllowed('webhooklab', 'viewer', 'sample'), false);
  assert.equal(accountCommandAllowed('webhooklab', 'owner', 'arbitrary'), false);
  assert.equal(accountCommandAllowed('webhooklab', 'administrator' as any, 'sample'), false);
});
test('viewer API defensively redacts signing secrets', async () => {
  globalThis.fetch = (async () =>
    json(row({ secret: 'never return to viewer', events: [] }, 'viewer'))) as typeof fetch;
  const result = await loadAccountWorkspace<{ events: unknown[] }>('webhooklab', id, session);
  assert.deepEqual(result.state, { events: [] });
});
test('viewer and staff forbidden commands never reach CAS', async () => {
  let cas = 0;
  for (const [role, command] of [
    ['viewer', 'move_job'],
    ['staff', 'pay_invoice'],
  ]) {
    globalThis.fetch = (async (url) => {
      if (String(url).includes('_cas')) cas++;
      return json(row({ jobs: [], invoices: [] }, role));
    }) as typeof fetch;
    await assert.rejects(
      mutateAccountWorkspace('fieldpilot', id, session, command, (state) => state),
      (e) => e instanceof ApiError && e.status === 403,
    );
  }
  assert.equal(cas, 0);
});
test('account CAS forwards verified user JWT and independent app backend credential', async () => {
  let cas = 0;
  globalThis.fetch = (async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + session.accessToken);
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('_cas')) {
      cas++;
      assert.equal(body.p_backend_key, backend);
      assert.equal(body.p_app, 'fieldpilot');
      assert.equal(body.p_command, 'move_job');
      return json({ ...row(body.p_state, 'staff', 1), ok: true });
    }
    return json(row({ jobs: [{ id: 'j', status: 'scheduled' }] }, 'staff'));
  }) as typeof fetch;
  const saved = await mutateAccountWorkspace<{
    jobs: { id: string; status: string }[];
  }>('fieldpilot', id, session, 'move_job', (state) => {
    state.jobs[0].status = 'in_progress';
    return state;
  });
  assert.equal(saved.revision, 1);
  assert.equal(cas, 1);
});
test('missing backend credential prevents account CAS despite valid user session', async () => {
  delete process.env.PORTFOLIO_BACKEND_KEY;
  let cas = 0;
  globalThis.fetch = (async (url) => {
    if (String(url).includes('_cas')) cas++;
    return json(row({ transactions: [] }));
  }) as typeof fetch;
  await assert.rejects(
    mutateAccountWorkspace('payroute', id, session, 'simulate', (state) => state),
    (e) => e instanceof ApiError && e.status === 503,
  );
  assert.equal(cas, 0);
});
test('account CAS retries cloned fresh state after contention', async () => {
  let reads = 0,
    writes = 0;
  globalThis.fetch = (async (url, init) => {
    if (!String(url).includes('_cas'))
      return json(row({ count: ++reads === 1 ? 2 : 8 }, 'editor', reads));
    const body = JSON.parse(String(init?.body));
    if (++writes === 1) return json({ ok: false });
    assert.equal(body.p_state.count, 9);
    return json({ ...row(body.p_state, 'editor', 3), ok: true });
  }) as typeof fetch;
  assert.equal(
    (
      await mutateAccountWorkspace<{ count: number }>(
        'fieldpilot',
        id,
        session,
        'create_customer',
        (state) => {
          state.count++;
          return state;
        },
      )
    ).state.count,
    9,
  );
});
test('account mode requires cookies and never falls back to demo bearer', async () => {
  globalThis.fetch = (async () => {
    assert.fail('no cookies means no storage or auth request');
  }) as typeof fetch;
  const handler = createWorkspaceHandler({
    app: 'fieldpilot',
    seed: () => ({}),
    reduce: (state) => state,
  });
  const out = response();
  await handler(
    {
      method: 'GET',
      headers: {
        'x-workspace-mode': 'account',
        'x-workspace-id': id,
        authorization: 'Bearer ' + 'a'.repeat(64),
      },
    },
    out,
  );
  assert.equal(out.statusCode, 401);
});
test('team API rejects owner role injection before membership RPC', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return json(session.user);
  }) as typeof fetch;
  const out = response();
  await createTeamHandler({
    app: 'fieldpilot',
    seed: () => ({ synthetic: true }),
  })(
    {
      method: 'POST',
      headers,
      body: {
        action: 'invite',
        workspaceId: id,
        email: 'other@example.test',
        role: 'owner',
      },
    },
    out,
  );
  assert.equal(out.statusCode, 400);
  assert.equal(requests, 1);
});
test('team create binds synthetic seed and backend key; ignores caller role', async () => {
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/user')) return json(session.user);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_role, null);
    assert.equal(body.p_backend_key, backend);
    assert.deepEqual(body.p_seed, { synthetic: true });
    return json({
      workspaces: [{ id, name: 'Sample', role: 'owner' }],
      workspaceId: id,
    });
  }) as typeof fetch;
  const out = response();
  await createTeamHandler({
    app: 'fieldpilot',
    seed: () => ({ synthetic: true }),
  })(
    {
      method: 'POST',
      headers,
      body: { action: 'create', name: 'Sample', role: 'owner' },
    },
    out,
  );
  assert.equal(out.statusCode, 200);
});
test('integration read requires both separate capabilities and never uses user JWT', async () => {
  globalThis.fetch = (async (url, init) => {
    assert.match(String(url), /portfolio_account_ingest_read$/);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_backend_key, backend);
    assert.equal(body.p_integration_key, integration);
    assert.equal(body.p_workspace_id, id);
    return json({ state: { secret: 'server only', events: [] }, revision: 0 });
  }) as typeof fetch;
  assert.equal(
    (await loadIntegrationWorkspace<{ events: unknown[] }>(id, integration)).revision,
    0,
  );
});
test('integration rejects ordinary demo token and missing backend key locally', async () => {
  globalThis.fetch = (async () => {
    assert.fail('must not make provider request');
  }) as typeof fetch;
  await assert.rejects(
    loadIntegrationWorkspace(id, 'a'.repeat(64)),
    (e) => e instanceof ApiError && e.status === 401,
  );
  delete process.env.PORTFOLIO_BACKEND_KEY;
  await assert.rejects(
    loadIntegrationWorkspace(id, integration),
    (e) => e instanceof ApiError && e.status === 503,
  );
});
test('integration CAS forwards backend key on every read and write and returns domain receipt', async () => {
  let writes = 0;
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_backend_key, backend);
    assert.equal(body.p_integration_key, integration);
    if (String(url).includes('_cas')) {
      writes++;
      return json({ ok: true, state: body.p_state, revision: 1 });
    }
    return json({ state: { events: [] }, revision: 0 });
  }) as typeof fetch;
  const saved = await mutateIntegrationWorkspace<{ events: string[] }>(
    id,
    integration,
    (state) => ({
      state: { events: [...state.events, 'evt1'] },
      result: { eventId: 'evt1' },
    }),
  );
  assert.equal(writes, 1);
  assert.deepEqual(saved.result, { eventId: 'evt1' });
});
