import test from 'node:test';
import assert from 'node:assert/strict';
import { getWorkspaceToken, type TokenStorage } from '../src/token.js';
function storage(): TokenStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}
test('an already open tab rotates its token when the next request passes six days', () => {
  const store = storage();
  const now = 1000000000;
  const first = getWorkspaceToken(store, now);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(getWorkspaceToken(store, now + 5 * 86400000), first);
  const current = getWorkspaceToken(store, now + 6 * 86400000);
  assert.notEqual(current, first);
  assert.equal(store.getItem('webhooklab-token-created'), String(now + 6 * 86400000));
  assert.equal(getWorkspaceToken(store, now + 6 * 86400000 + 1000), current);
});
test('invalid and future-dated capabilities are replaced', () => {
  const store = storage();
  store.setItem('webhooklab-token', 'invalid');
  store.setItem('webhooklab-token-created', '1000');
  assert.match(getWorkspaceToken(store, 1001), /^[0-9a-f]{64}$/);
  const first = store.getItem('webhooklab-token');
  store.setItem('webhooklab-token-created', '9000');
  assert.notEqual(getWorkspaceToken(store, 2000), first);
});
