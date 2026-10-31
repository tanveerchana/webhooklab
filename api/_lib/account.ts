import type { AccountSession } from './auth.js';
import { supabaseRequest } from './auth.js';
import { ApiError, UUID } from './account-http.js';
import { ContentionError, type Reduction, type Workspace } from './store.js';
export type WorkspaceRole = 'owner' | 'editor' | 'staff' | 'viewer';
export type AccountWorkspace<T> = Workspace<T> & {
  role: WorkspaceRole;
  workspace: { id: string; name: string; ingestionConfigured?: boolean };
};
const APPS = new Set(['webhooklab', 'fieldpilot', 'payroute']);
const ROLES = new Set(['owner', 'editor', 'staff', 'viewer']);
export function accountCommandAllowed(app: string, role: WorkspaceRole, type: string): boolean {
  const commands: Record<string, string[]> = {
    fieldpilot: [
      'create_customer',
      'create_estimate',
      'approve_estimate',
      'move_job',
      'create_invoice',
      'pay_invoice',
    ],
    payroute: ['simulate', 'provider', 'route', 'reconcile', 'reset'],
    webhooklab: [
      'sample',
      'capture',
      'replay',
      'advance-clock',
      'reset',
      'rotate-secret',
      'settings',
    ],
  };
  if (!commands[app]?.includes(type)) return false;
  if (role === 'owner') return true;
  if (role === 'viewer') return false;
  if (role === 'staff') return app === 'fieldpilot' && type === 'move_job';
  if (role !== 'editor') return false;
  if (app === 'payroute') return ['simulate', 'reconcile'].includes(type);
  if (app === 'webhooklab') return ['sample', 'capture', 'replay', 'advance-clock'].includes(type);
  return app === 'fieldpilot';
}
export function backendKey(): string {
  const key = process.env.PORTFOLIO_BACKEND_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key))
    throw new ApiError(503, 'Account workspace services are not configured.');
  return key;
}
export async function accountRpc<T>(
  name: string,
  body: unknown,
  session?: AccountSession,
): Promise<T> {
  if (!/^portfolio_account_[a-z_]+$/.test(name))
    throw new ApiError(503, 'Account services are not configured.');
  const response = await supabaseRequest('/rest/v1/rpc/' + name, {
    method: 'POST',
    body,
    accessToken: session?.accessToken,
  });
  if (response.status === 401) throw new ApiError(401, 'Sign in again to continue.');
  if (response.status === 403 || response.data?.code === '42501')
    throw new ApiError(403, 'Your role does not allow that action.');
  if (response.data?.code === 'P0002')
    throw new ApiError(404, 'Workspace or team member not found.');
  if (response.data?.code === '22023' || response.data?.code === '23514')
    throw new ApiError(400, 'Check the workspace details and try again.');
  if (response.status === 429)
    throw new ApiError(429, 'Too many requests. Please try again shortly.');
  if (response.status < 200 || response.status >= 300)
    throw new ApiError(503, 'Workspace storage is temporarily unavailable. Please try again.');
  return response.data as T;
}
export function jsonClone<T>(state: T): T {
  let text: string | undefined;
  try {
    text = JSON.stringify(state);
  } catch {
    throw new ApiError(400, 'Workspace must contain JSON data.');
  }
  if (text === undefined || new TextEncoder().encode(text).byteLength > 524288)
    throw new ApiError(400, 'Workspace state is too large.');
  return JSON.parse(text) as T;
}
export function unpackReduction<T>(value: Reduction<T>): {
  state: T;
  result?: unknown;
} {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'state') &&
    Object.keys(value).every((key) => key === 'state' || key === 'result')
  )
    return value as { state: T; result?: unknown };
  return { state: value as T };
}
export function parseAccountWorkspace<T>(value: any, id: string): AccountWorkspace<T> {
  if (
    !value ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Object.prototype.hasOwnProperty.call(value, 'state') ||
    !ROLES.has(value.role) ||
    value.workspace?.id !== id ||
    typeof value.workspace?.name !== 'string'
  )
    throw new ApiError(503, 'Workspace storage returned an invalid response.');
  const state = jsonClone(value.state) as T;
  // Defense in depth. Database read RPC already redacts this field for viewer memberships.
  if (value.role === 'viewer' && state && typeof state === 'object')
    delete (state as Record<string, unknown>).secret;
  return {
    state,
    revision: value.revision,
    role: value.role,
    workspace: {
      id,
      name: value.workspace.name,
      ...(typeof value.workspace.ingestionConfigured === 'boolean'
        ? { ingestionConfigured: value.workspace.ingestionConfigured }
        : {}),
    },
  };
}
function validate(app: string, id: string): void {
  if (!APPS.has(app) || !UUID.test(id)) throw new ApiError(400, 'Choose a valid workspace.');
}
export async function loadAccountWorkspace<T>(
  app: string,
  id: string,
  session: AccountSession,
): Promise<AccountWorkspace<T>> {
  validate(app, id);
  return parseAccountWorkspace<T>(
    await accountRpc('portfolio_account_read', { p_app: app, p_workspace_id: id }, session),
    id,
  );
}
export async function mutateAccountWorkspace<T>(
  app: string,
  id: string,
  session: AccountSession,
  commandType: string,
  apply: (state: T) => Reduction<T>,
): Promise<AccountWorkspace<T>> {
  validate(app, id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await loadAccountWorkspace<T>(app, id, session);
    if (!accountCommandAllowed(app, before.role, commandType))
      throw new ApiError(403, 'Your role does not allow that action.');
    const next = unpackReduction(apply(jsonClone(before.state)));
    const saved = await accountRpc<any>(
      'portfolio_account_cas',
      {
        p_app: app,
        p_workspace_id: id,
        p_expected_revision: before.revision,
        p_command: commandType,
        p_state: jsonClone(next.state),
        p_backend_key: backendKey(),
      },
      session,
    );
    if (saved?.ok === false) continue;
    if (saved?.ok !== true || saved.revision !== before.revision + 1)
      throw new ApiError(503, 'Workspace storage returned an invalid response.');
    const result = parseAccountWorkspace<T>(saved, id);
    return Object.prototype.hasOwnProperty.call(next, 'result')
      ? { ...result, result: next.result }
      : result;
  }
  throw new ContentionError();
}
