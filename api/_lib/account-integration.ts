import { createHash, randomBytes } from 'node:crypto';
import type { WorkspaceRequest, WorkspaceResponse } from './workspace.js';
import type { Workspace, Reduction } from './store.js';
import { ContentionError } from './store.js';
import { accountRpc, jsonClone, loadAccountWorkspace, unpackReduction } from './account.js';
import { requireAccountSession } from './auth.js';
import {
  ApiError,
  enforceMutationOrigin,
  readJson,
  sendApiError,
  sendJson,
  workspaceId,
  UUID,
} from './account-http.js';
const KEY = /^whk_ingest_[a-f0-9]{64}$/;
function credentials(
  id: string,
  integrationKey: string,
): {
  p_workspace_id: string;
  p_integration_key: string;
  p_backend_key: string;
} {
  const backendKey = process.env.PORTFOLIO_BACKEND_KEY;
  if (!UUID.test(id) || !KEY.test(integrationKey))
    throw new ApiError(401, 'A valid integration key and workspace are required.');
  if (!backendKey || !/^[a-f0-9]{64}$/.test(backendKey))
    throw new ApiError(503, 'Account webhook ingestion is not configured.');
  return {
    p_workspace_id: id,
    p_integration_key: integrationKey,
    p_backend_key: backendKey,
  };
}
function integrationRow<T>(value: any): Workspace<T> {
  if (
    !value ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Object.prototype.hasOwnProperty.call(value, 'state')
  )
    throw new ApiError(503, 'Workspace storage returned an invalid response.');
  return { state: jsonClone(value.state), revision: value.revision };
}
export async function loadIntegrationWorkspace<T>(
  id: string,
  integrationKey: string,
): Promise<Workspace<T>> {
  return integrationRow(
    await accountRpc('portfolio_account_ingest_read', credentials(id, integrationKey)),
  );
}
/** Server only: both the one-purpose integration capability and a separate backend credential are required. */
export async function mutateIntegrationWorkspace<T>(
  id: string,
  integrationKey: string,
  apply: (state: T) => Reduction<T>,
): Promise<Workspace<T>> {
  const creds = credentials(id, integrationKey);
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await loadIntegrationWorkspace<T>(id, integrationKey);
    const next = unpackReduction(apply(jsonClone(before.state)));
    const saved = await accountRpc<any>('portfolio_account_ingest_cas', {
      ...creds,
      p_expected_revision: before.revision,
      p_state: jsonClone(next.state),
    });
    if (saved?.ok === false) continue;
    if (saved?.ok !== true || saved.revision !== before.revision + 1)
      throw new ApiError(503, 'Workspace storage returned an invalid response.');
    const row = integrationRow<T>(saved);
    return Object.prototype.hasOwnProperty.call(next, 'result')
      ? { ...row, result: next.result }
      : row;
  }
  throw new ContentionError();
}
export function createIntegrationHandler() {
  return async function integrations(req: WorkspaceRequest, res: WorkspaceResponse): Promise<void> {
    try {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new ApiError(405, 'Method not allowed.');
      }
      if (req.method === 'POST') enforceMutationOrigin(req);
      const session = await requireAccountSession('webhooklab', req, res);
      if (req.method === 'GET') {
        const id = workspaceId(req);
        const loaded = await loadAccountWorkspace('webhooklab', id, session);
        sendJson(res, 200, {
          workspaceId: id,
          configured: loaded.workspace.ingestionConfigured === true,
        });
        return;
      }
      const body = await readJson(req, 8192);
      if (
        !['rotate', 'revoke'].includes(String(body.action)) ||
        typeof body.workspaceId !== 'string' ||
        !UUID.test(body.workspaceId)
      )
        throw new ApiError(400, 'Choose a valid integration action and workspace.');
      // The database checks current ownership. Caller-supplied roles are never accepted.
      const key =
        body.action === 'rotate' ? 'whk_ingest_' + randomBytes(32).toString('hex') : undefined;
      await accountRpc(
        'portfolio_account_integration_key',
        {
          p_app: 'webhooklab',
          p_workspace_id: body.workspaceId,
          p_key_hash: key ? createHash('sha256').update(key).digest('hex') : null,
        },
        session,
      );
      sendJson(res, 200, {
        workspaceId: body.workspaceId,
        configured: Boolean(key),
        ...(key ? { integrationKey: key } : {}),
      });
    } catch (error) {
      sendApiError(res, error);
    }
  };
}
