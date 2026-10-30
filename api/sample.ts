import { mutateWorkspace } from './_lib/store.js';
import { bearer, json, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { signPayload, verifySignature } from './_lib/signature.js';
import {
  seedWorkspace,
  captureEvent,
  parsePayload,
  type Workspace,
  type Scenario,
} from '../src/domain.js';
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'Use POST to send a sample.' });
    return;
  }
  let token: string;
  try {
    token = bearer(req);
  } catch (e) {
    json(res, 401, { error: (e as Error).message });
    return;
  }
  let body: { raw: string; scenario: Scenario; invalidSignature: boolean };
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as typeof body;
    if (!body || typeof body.raw !== 'string')
      throw new Error('A JSON payload string is required.');
    parsePayload(body.raw);
    if (!['success', 'recover', 'always-fail'].includes(body.scenario))
      throw new Error('Unknown delivery scenario.');
    if (typeof body.invalidSignature !== 'boolean')
      throw new Error('Signature test option must be a boolean.');
  } catch (e) {
    json(res, 400, { error: (e as Error).message });
    return;
  }
  try {
    const result = await mutateWorkspace<Workspace>('webhooklab', token, seedWorkspace, (state) => {
      const signature = signPayload(
        body.raw,
        body.invalidSignature ? 'intentionally-wrong-secret' : state.secret,
      );
      return captureEvent(
        state,
        body.raw,
        verifySignature(body.raw, state.secret, signature),
        body.scenario,
        'Sample',
      );
    });
    json(res, 200, result);
  } catch {
    json(res, 503, { error: 'Cloud persistence is unavailable. Sample event was not saved.' });
  }
}
