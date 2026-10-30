import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readRaw, bearer, type ApiRequest } from '../api/_lib/http.js';
test('raw ingress preserves exact bytes across stream chunks', async () => {
  const bytes = Buffer.from('{"message":"hello 🌿"}');
  const req = Readable.from([bytes.subarray(0, 21), bytes.subarray(21)]) as ApiRequest;
  const actual = await readRaw(req);
  assert.equal(Buffer.isBuffer(actual), true);
  assert.deepEqual(actual, bytes);
});
test('raw ingress stops at the 64 KB limit', async () => {
  const req = Readable.from([Buffer.alloc(65536), Buffer.from('x')]) as ApiRequest;
  await assert.rejects(() => readRaw(req), /64 KB/);
});
test('bearer authentication accepts only a 64 lowercase hex token', () => {
  assert.throws(() => bearer({ headers: { authorization: 'Bearer ABC' } } as ApiRequest), /token/);
  assert.throws(() => bearer({ headers: {} } as ApiRequest), /token/);
  assert.equal(
    bearer({ headers: { authorization: 'Bearer ' + 'a'.repeat(64) } } as ApiRequest),
    'a'.repeat(64),
  );
});
