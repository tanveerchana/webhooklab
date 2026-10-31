import { mutateWorkspace, ContentionError } from './_lib/store.js';
import { mutateIntegrationWorkspace } from './_lib/account-integration.js';
import { ApiError, sendApiError, workspaceId } from './_lib/account-http.js';
import { bearer, json, readRaw, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { verifySignature } from './_lib/signature.js';
import {
  seedWorkspace,
  captureEvent,
  parsePayload,
  type Workspace,
  type Scenario,
} from '../src/domain.js';
export const config = { api: { bodyParser: false } };
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'Use POST to capture a signed JSON webhook.' });
    return;
  }
  const integrationKey = /^Bearer (whk_ingest_[a-f0-9]{64})$/.exec(
    req.headers.authorization || '',
  )?.[1];
  let token: string | undefined;
  let accountWorkspaceId: string | undefined;
  try {
    if (integrationKey) accountWorkspaceId = workspaceId(req);
    else token = bearer(req);
  } catch (error) {
    if (error instanceof ApiError) sendApiError(res, error);
    else json(res, 401, { error: 'A valid demo token or scoped integration key is required.' });
    return;
  }
  if (
    !String(req.headers['content-type'] || '')
      .toLowerCase()
      .startsWith('application/json')
  ) {
    json(res, 415, { error: 'Content-Type must be application/json.' });
    return;
  }
  let raw: string;
  let rawBytes: Buffer;
  let scenario: Scenario;
  try {
    rawBytes = await readRaw(req);
    raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    parsePayload(raw);
    scenario = String(req.headers['x-delivery-scenario'] || 'success') as Scenario;
    if (!['success', 'recover', 'always-fail'].includes(scenario))
      throw new Error('Unknown delivery scenario.');
  } catch (e) {
    json(res, 400, { error: (e as Error).message });
    return;
  }
  try {
    const signature = String(req.headers['x-webhook-signature'] || '');
    const apply = (state: Workspace) => {
      const valid = verifySignature(rawBytes, state.secret, signature);
      const next = captureEvent(state, raw, valid, scenario, 'HTTP');
      return {
        state: next,
        result: {
          eventId: next.events[0].id,
          status: next.events[0].status,
          signatureVerified: valid,
          downstream: 'simulated',
        },
      };
    };
    const result = integrationKey
      ? await mutateIntegrationWorkspace<Workspace>(accountWorkspaceId!, integrationKey, apply)
      : await mutateWorkspace<Workspace>('webhooklab', token!, seedWorkspace, apply);
    const accepted = result.result as { signatureVerified: boolean };
    json(res, accepted.signatureVerified ? 202 : 401, result.result);
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(res, error);
      return;
    }
    if (error instanceof ContentionError) {
      json(res, 409, { error: error.message });
      return;
    }
    json(res, 503, {
      error:
        'Cloud persistence is unavailable. The webhook was not acknowledged. Retry after reconnecting.',
    });
  }
}
