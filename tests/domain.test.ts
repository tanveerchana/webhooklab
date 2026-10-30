import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace, reduceWorkspace, filterEvents, parsePayload } from '../src/domain.js';
import { signPayload, verifySignature } from '../api/_lib/signature.js';

test('JSON capture rejects invalid JSON before producing an event', () => {
  assert.throws(() => parsePayload('{broken'), /valid JSON/);
});
test('signature verification rejects altered bytes and malformed signatures', () => {
  const signature = signPayload('{"ok":true}', 'demo-secret');
  assert.equal(verifySignature('{"ok":true}', 'demo-secret', signature), true);
  assert.equal(verifySignature('{"ok":false}', 'demo-secret', signature), false);
  assert.equal(verifySignature('{"ok":true}', 'demo-secret', 'sha256=zz'), false);
});
test('retry uses explicit clock and cannot bypass its exponential backoff', () => {
  const state = seedWorkspace();
  const failed = state.events.find((e) => e.scenario === 'always-fail')!;
  const next = reduceWorkspace(state, { type: 'replay', id: failed.id });
  assert.equal(
    next.events.find((e) => e.id === failed.id)!.attempts.length,
    failed.attempts.length + 1,
  );
  assert.throws(() => reduceWorkspace(next, { type: 'replay', id: failed.id }), /backoff/);
  const advanced = reduceWorkspace(next, { type: 'advance-clock', seconds: 60 });
  assert.doesNotThrow(() => reduceWorkspace(advanced, { type: 'replay', id: failed.id }));
});
test('replay is bounded at twenty attempts even with clock advances', () => {
  let state = seedWorkspace();
  const event = state.events.find((e) => e.scenario === 'always-fail')!;
  while (state.events.find((e) => e.id === event.id)!.attempts.length < 20) {
    state = reduceWorkspace(state, { type: 'advance-clock', seconds: 3600 });
    state = reduceWorkspace(state, { type: 'replay', id: event.id });
  }
  assert.throws(() => reduceWorkspace(state, { type: 'replay', id: event.id }), /20 attempts/);
});
test('invalid signatures cannot be replayed and capture validates scenario', () => {
  const state = seedWorkspace();
  assert.throws(
    () =>
      reduceWorkspace(state, {
        type: 'replay',
        id: state.events.find((e) => e.status === 'rejected')!.id,
      }),
    /signature/,
  );
  assert.throws(() => reduceWorkspace(state, { type: 'sample', scenario: 'real-url' }), /scenario/);
});
test('filter combines status with case-insensitive payload and type search', () => {
  const state = seedWorkspace();
  const rows = filterEvents(state.events, 'failed', 'INVOICE');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((e) => e.status === 'failed' && e.type.includes('invoice')));
});

test('large captures evict old events before reaching the database state limit', async () => {
  const { captureEvent } = await import('../src/domain.js');
  let state = seedWorkspace();
  for (let i = 0; i < 8; i++)
    state = captureEvent(
      state,
      JSON.stringify({ type: 'large.created', data: 'x'.repeat(60000) }),
      true,
    );
  assert.ok(Buffer.byteLength(JSON.stringify(state)) <= 450000);
  assert.ok(state.events.length < 150);
  assert.equal(state.events[0].type, 'large.created');
});
