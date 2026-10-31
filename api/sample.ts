import { mutateWorkspace, ContentionError, StorageError } from './_lib/store.js';
import { bearer, json, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { signPayload, verifySignature } from './_lib/signature.js';
import { requireAccountSession } from './_lib/auth.js';
import { mutateAccountWorkspace } from './_lib/account.js';
import {
  ApiError,
  enforceMutationOrigin,
  readJson,
  sendApiError,
  workspaceId,
} from './_lib/account-http.js';
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
  try {
    const mode = req.headers['x-workspace-mode'];
    if (mode !== undefined && mode !== 'account' && mode !== 'demo')
      throw new ApiError(400, 'Choose demo or account mode.');
    if (mode === 'account') enforceMutationOrigin(req);
    const session =
      mode === 'account' ? await requireAccountSession('webhooklab', req, res) : undefined;
    let token: string | undefined;
    if (!session) {
      try {
        token = bearer(req);
      } catch {
        throw new ApiError(401, 'A valid demo bearer token is required.');
      }
    }
    const body = await readJson(req);
    if (typeof body.raw !== 'string') throw new ApiError(400, 'A JSON payload string is required.');
    parsePayload(body.raw);
    if (!['success', 'recover', 'always-fail'].includes(String(body.scenario)))
      throw new ApiError(400, 'Unknown delivery scenario.');
    if (typeof body.invalidSignature !== 'boolean')
      throw new ApiError(400, 'Signature test option must be a boolean.');
    const raw = body.raw;
    const apply = (state: Workspace) => {
      const signature = signPayload(
        raw,
        body.invalidSignature ? 'intentionally-wrong-secret' : state.secret,
      );
      return captureEvent(
        state,
        raw,
        verifySignature(raw, state.secret, signature),
        body.scenario as Scenario,
        'Sample',
      );
    };
    const result = session
      ? await mutateAccountWorkspace<Workspace>(
          'webhooklab',
          workspaceId(req),
          session,
          'sample',
          apply,
        )
      : await mutateWorkspace<Workspace>('webhooklab', token!, seedWorkspace, apply);
    json(res, 200, result);
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(res, error);
      return;
    }
    if (error instanceof ContentionError) {
      json(res, 409, { error: error.message });
      return;
    }
    if (error instanceof StorageError) {
      json(res, 503, { error: 'Cloud persistence is unavailable. Sample event was not saved.' });
      return;
    }
    json(res, 400, {
      error:
        error instanceof Error && error.message.length < 250
          ? error.message
          : 'Sample event could not be created.',
    });
  }
}
