import type { WorkspaceRequest, WorkspaceResponse } from './workspace.js';
import { requireAccountSession } from './auth.js';
import { accountRpc, backendKey, jsonClone, type WorkspaceRole } from './account.js';
import {
  ApiError,
  enforceMutationOrigin,
  header,
  readJson,
  sendApiError,
  sendJson,
  UUID,
} from './account-http.js';
export type TeamResponse = {
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
  workspaceId?: string;
  members?: { userId: string; email: string; role: WorkspaceRole }[];
  pendingInvitations?: { id: string; email: string; role: WorkspaceRole }[];
};
export function createTeamHandler<T>(options: { app: string; seed: () => T }) {
  return async function teamHandler(req: WorkspaceRequest, res: WorkspaceResponse): Promise<void> {
    try {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new ApiError(405, 'Method not allowed.');
      }
      if (req.method === 'POST') enforceMutationOrigin(req);
      const session = await requireAccountSession(options.app, req, res);
      if (req.method === 'GET') {
        const selected = header(req, 'x-workspace-id');
        if (selected && !UUID.test(selected)) throw new ApiError(400, 'Choose a valid workspace.');
        sendJson(
          res,
          200,
          await accountRpc<TeamResponse>(
            'portfolio_account_team',
            { p_app: options.app, p_workspace_id: selected ?? null },
            session,
          ),
        );
        return;
      }
      const body = await readJson(req);
      let rpcBody: Record<string, unknown>;
      if (body.action === 'create') {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80)
          throw new ApiError(400, 'Workspace name must contain 1–80 characters.');
        rpcBody = {
          p_app: options.app,
          p_action: 'create',
          p_workspace_id: null,
          p_name: body.name.trim(),
          p_email: null,
          p_user_id: null,
          p_role: null,
          p_seed: jsonClone(options.seed()),
          p_backend_key: backendKey(),
        };
      } else {
        if (
          !['invite', 'role', 'remove'].includes(String(body.action)) ||
          typeof body.workspaceId !== 'string' ||
          !UUID.test(body.workspaceId)
        )
          throw new ApiError(400, 'Choose a valid team action and workspace.');
        if (
          body.action === 'invite' &&
          (typeof body.email !== 'string' ||
            body.email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))
        )
          throw new ApiError(400, 'Enter a valid invitation email.');
        if (
          ['role', 'remove'].includes(String(body.action)) &&
          (typeof body.userId !== 'string' || !UUID.test(body.userId))
        )
          throw new ApiError(400, 'Choose a valid team member.');
        const allowedRoles =
          options.app === 'fieldpilot' ? ['editor', 'staff', 'viewer'] : ['editor', 'viewer'];
        if (body.action !== 'remove' && !allowedRoles.includes(String(body.role)))
          throw new ApiError(400, 'Choose editor, viewer, or FieldPilot staff.');
        rpcBody = {
          p_app: options.app,
          p_action: body.action,
          p_workspace_id: body.workspaceId,
          p_name: null,
          p_email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : null,
          p_user_id: body.userId ?? null,
          p_role: body.action === 'remove' ? null : body.role,
          p_seed: null,
          p_backend_key: null,
        };
      }
      sendJson(res, 200, await accountRpc('portfolio_account_manage_team', rpcBody, session));
    } catch (error) {
      sendApiError(res, error);
    }
  };
}
