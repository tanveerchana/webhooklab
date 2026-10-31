import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowsPermission,
  currentAccess,
  setAccess,
  withWorkspaceAccess,
  type Access,
  type AppName,
} from './access';

const account = (role: string): Access => ({
  mode: 'account',
  user: { id: 'user-id', email: 'test@example.test' },
  workspaceId: 'workspace-id',
  role,
});

test('permission matrix denies missing account context, unknown actions and restricted role commands', () => {
  for (const app of ['fieldpilot', 'webhooklab', 'payroute'] as AppName[]) {
    assert.equal(allowsPermission(app, { mode: 'account' }, 'read'), false);
    assert.equal(allowsPermission(app, account('viewer'), 'read'), true);
    assert.equal(allowsPermission(app, account('viewer'), 'reset'), false);
    assert.equal(allowsPermission(app, account('editor'), 'invite'), false);
    assert.equal(allowsPermission(app, account('owner'), 'unknown-action'), false);
    assert.equal(allowsPermission(app, account('owner'), 'team.manage'), true);
  }
  assert.equal(allowsPermission('fieldpilot', account('staff'), 'move_job'), true);
  assert.equal(allowsPermission('fieldpilot', account('staff'), 'pay_invoice'), false);
  assert.equal(allowsPermission('fieldpilot', account('editor'), 'pay_invoice'), true);
  assert.equal(allowsPermission('webhooklab', account('editor'), 'secret'), true);
  assert.equal(allowsPermission('webhooklab', account('viewer'), 'secret'), false);
  assert.equal(allowsPermission('webhooklab', account('editor'), 'reset'), false);
  assert.equal(allowsPermission('webhooklab', account('editor'), 'rotate-secret'), false);
  assert.equal(allowsPermission('webhooklab', account('staff'), 'sample'), false);
  assert.equal(allowsPermission('payroute', account('editor'), 'simulate'), true);
  assert.equal(allowsPermission('payroute', account('editor'), 'reconcile'), true);
  assert.equal(allowsPermission('payroute', account('editor'), 'provider'), false);
  assert.equal(allowsPermission('payroute', account('editor'), 'route'), false);
  assert.equal(allowsPermission('payroute', account('staff'), 'simulate'), false);
});

test('account requests strip demo credentials and require a selected workspace', () => {
  setAccess({ mode: 'account' });
  assert.throws(() => withWorkspaceAccess(), /Choose a workspace/);
  setAccess(account('editor'));
  const init = withWorkspaceAccess({
    headers: {
      Authorization: 'Bearer demo-only',
      'X-Workspace-Id': 'stale-id',
      'Content-Type': 'application/json',
    },
    credentials: 'omit',
    method: 'POST',
    body: '{}',
  });
  const headers = new Headers(init.headers);
  assert.equal(headers.get('Authorization'), null);
  assert.equal(headers.get('X-Workspace-Id'), 'workspace-id');
  assert.equal(headers.get('X-Workspace-Mode'), 'account');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.body, '{}');
});

test('explicit demo mode preserves demo token and removes stale account scope', () => {
  setAccess({ mode: 'demo' });
  const headers = new Headers(
    withWorkspaceAccess({
      headers: { Authorization: 'Bearer demo-only', 'X-Workspace-Id': 'stale-id' },
    }).headers,
  );
  assert.equal(headers.get('Authorization'), 'Bearer demo-only');
  assert.equal(headers.get('X-Workspace-Id'), null);
  assert.equal(headers.get('X-Workspace-Mode'), 'demo');
  assert.deepEqual(currentAccess(), { mode: 'demo' });
});
