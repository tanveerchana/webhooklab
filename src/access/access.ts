export type AppName = 'fieldpilot' | 'webhooklab' | 'payroute';
export type Role = 'owner' | 'editor' | 'staff' | 'viewer';
export type User = { id: string; email: string };
export type Access = { mode: 'account' | 'demo'; role?: string; workspaceId?: string; user?: User };

let activeApp: AppName = 'webhooklab';
let active: Access = { mode: 'account' };

export function configureAccess(app: AppName) {
  activeApp = app;
}
export function currentAccess(): Access {
  return { ...active };
}
export function setAccess(next: Access, notify = true) {
  active = { ...next };
  if (notify && typeof window !== 'undefined')
    window.dispatchEvent(new Event('portfolio-access-changed'));
}

/** UI affordances only: the API independently authorizes every command. */
export function allowsPermission(app: AppName, access: Access, action: string): boolean {
  if (access.mode === 'demo') return true;
  if (!access.user || !access.workspaceId || !access.role) return false;
  if (action === 'read') return true;
  if (['team.manage', 'invite', 'role', 'remove'].includes(action)) return access.role === 'owner';
  const commands: Record<AppName, string[]> = {
    fieldpilot: [
      'create_customer',
      'create_estimate',
      'approve_estimate',
      'move_job',
      'create_invoice',
      'pay_invoice',
    ],
    webhooklab: [
      'sample',
      'capture',
      'replay',
      'advance-clock',
      'reset',
      'secret',
      'rotate-secret',
      'settings',
      'integration.manage',
      'integration-key',
    ],
    payroute: ['simulate', 'provider', 'route', 'reconcile', 'reset'],
  };
  if (!commands[app].includes(action)) return false;
  if (access.role === 'owner') return true;
  if (access.role === 'editor') {
    if (app === 'fieldpilot') return true;
    if (app === 'webhooklab')
      return ['sample', 'capture', 'replay', 'advance-clock', 'secret'].includes(action);
    return ['simulate', 'reconcile'].includes(action);
  }
  const staff: Record<AppName, string[]> = {
    fieldpilot: ['move_job'],
    webhooklab: [],
    payroute: [],
  };
  return access.role === 'staff' && staff[app].includes(action);
}

export function can(action: string): boolean {
  return allowsPermission(activeApp, active, action);
}

/** No account credential is exposed to JavaScript or browser storage. */
export function withWorkspaceAccess(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.delete('X-Workspace-Id');
  headers.set('X-Workspace-Mode', active.mode);
  if (active.mode === 'account') {
    headers.delete('Authorization');
    if (!active.user || !active.workspaceId)
      throw new Error('Choose a workspace before continuing.');
    headers.set('X-Workspace-Id', active.workspaceId);
  }
  return { ...init, headers, credentials: 'same-origin' };
}

export function handleAccessResponse<T extends Response>(response: T): T {
  if (response.status === 401 && active.mode === 'account' && typeof window !== 'undefined') {
    setAccess({ mode: 'account' });
    window.dispatchEvent(new Event('portfolio-session-expired'));
  }
  return response;
}

export function roleLabel(role?: string, app: AppName = activeApp): string {
  if (role === 'editor') return app === 'fieldpilot' ? 'Manager' : 'Editor';
  return role ? role[0].toUpperCase() + role.slice(1) : 'No workspace';
}
