import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  configureAccess,
  roleLabel,
  setAccess,
  type AppName,
  type Role,
  type User,
} from './access';
import './access.css';

type Workspace = { id: string; name: string; role: Role };
type Member = { userId: string; email: string; role: Role };
type Invitation = { id?: string; email: string; role: Role };
type Team = {
  workspaces: Workspace[];
  members?: Member[];
  invitations?: Invitation[];
  pendingInvitations?: Invitation[];
};
const names = { fieldpilot: 'FieldPilot', webhooklab: 'WebhookLab', payroute: 'PayRoute Sandbox' };

async function request(path: string, body?: Record<string, unknown>, workspaceId?: string) {
  const headers = new Headers({ 'X-Workspace-Mode': 'account' });
  if (body) headers.set('Content-Type', 'application/json');
  if (workspaceId) headers.set('X-Workspace-Id', workspaceId);
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers,
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth'))
      window.dispatchEvent(new Event('portfolio-session-expired'));
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : data.error?.message ||
          data.message ||
          'The request could not be completed. Please try again.',
    );
  }
  return data;
}

function remember(key: string, value?: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
}
function recalled(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ) || [],
      ).filter((item) => item.getClientRects().length > 0);
    (focusables()[0] || ref.current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const items = focusables();
        const first = items[0],
          last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          ref.current?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || !ref.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !ref.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="access-backdrop">
      <div
        className="access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-dialog-title"
        tabIndex={-1}
        ref={ref}
      >
        <div className="access-dialog-heading">
          <h2 id="access-dialog-title">{title}</h2>
          <button
            type="button"
            className="access-secondary"
            onClick={onClose}
            aria-label="Close workspace settings"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AccessRoot({ app, children }: { app: AppName; children: ReactNode }) {
  configureAccess(app);
  const preferenceKey = `portfolio:${app}:demo`;
  const workspaceKey = `portfolio:${app}:workspace`;
  const [phase, setPhase] = useState<'loading' | 'gate' | 'ready' | 'failure'>('loading');
  const [mode, setMode] = useState<'account' | 'demo'>('account');
  const [user, setUser] = useState<User | null>(null);
  const [team, setTeam] = useState<Team>({ workspaces: [] });
  const [workspaceId, setWorkspaceId] = useState('');
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [manage, setManage] = useState(false);
  const workspace = team.workspaces.find((item) => item.id === workspaceId);
  const owner = workspace?.role === 'owner';
  const assignableRoles: Role[] =
    app === 'fieldpilot' ? ['editor', 'staff', 'viewer'] : ['editor', 'viewer'];
  const closeManage = useCallback(() => setManage(false), []);

  const loadTeam = useCallback(
    async (preferred?: string) => {
      const data: Team = await request('/api/team');
      const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
      const selected =
        workspaces.find((item) => item.id === preferred)?.id || workspaces[0]?.id || '';
      let details = data;
      if (selected) details = await request('/api/team', undefined, selected);
      setTeam({
        ...details,
        invitations: details.invitations || details.pendingInvitations,
        workspaces,
      });
      setWorkspaceId(selected);
      remember(workspaceKey, selected);
      return selected;
    },
    [workspaceKey],
  );

  const loadSession = useCallback(async () => {
    setPhase('loading');
    setError('');
    try {
      const data = await request('/api/auth?action=session');
      setUser(data.user || null);
      if (recalled(preferenceKey) === 'true') {
        setMode('demo');
        setPhase('ready');
        return;
      }
      setMode('account');
      if (data.user) {
        await loadTeam(recalled(workspaceKey) || undefined);
        setPhase('ready');
      } else setPhase('gate');
    } catch (err) {
      setError(message(err));
      setPhase('failure');
    }
  }, [loadTeam, preferenceKey, workspaceKey]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    setAccess(
      phase === 'ready' && mode === 'demo'
        ? { mode: 'demo' }
        : {
            mode: 'account',
            user: phase === 'ready' ? user || undefined : undefined,
            workspaceId: workspace?.id,
            role: workspace?.role,
          },
    );
  }, [phase, mode, user, workspace?.id, workspace?.role]);
  useEffect(() => {
    const expire = () => {
      setAccess({ mode: 'account' });
      remember(preferenceKey);
      setUser(null);
      setTeam({ workspaces: [] });
      setWorkspaceId('');
      setMode('account');
      setPhase('gate');
      setManage(false);
      setNotice('Your session expired. Sign in again to continue.');
      setError('');
    };
    window.addEventListener('portfolio-session-expired', expire);
    return () => window.removeEventListener('portfolio-session-expired', expire);
  }, [preferenceKey]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await request('/api/auth', { action: tab, email: email.trim(), password });
      setPassword('');
      if (!data.user) {
        setNotice(
          data.message || 'Check your email to confirm your account, then return here to sign in.',
        );
        setTab('login');
        return;
      }
      remember(preferenceKey);
      setUser(data.user);
      setMode('account');
      await loadTeam(recalled(workspaceKey) || undefined);
      setPhase('ready');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  function demo() {
    remember(preferenceKey, 'true');
    setAccess({ mode: 'demo' });
    setMode('demo');
    setPhase('ready');
    setManage(false);
    setError('');
    setPassword('');
  }
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await request('/api/auth', { action: 'logout' });
      remember(preferenceKey);
      setAccess({ mode: 'account' });
      setUser(null);
      setTeam({ workspaces: [] });
      setWorkspaceId('');
      setMode('account');
      setPhase('gate');
      setManage(false);
      setNotice('You have signed out.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function selectWorkspace(id: string) {
    setBusy(true);
    setError('');
    try {
      await loadTeam(id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await request('/api/team', { action: 'create', name: name.trim() });
      setName('');
      await loadTeam(data.workspace?.id || data.workspaceId || data.id);
      setNotice('Workspace created.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function teamAction(body: Record<string, unknown>) {
    if (!owner || !workspaceId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/api/team', { ...body, workspaceId }, workspaceId);
      await loadTeam(workspaceId);
      if (body.action === 'invite') {
        setInviteEmail('');
        setNotice('Invitation saved. They can join after signing in with this verified email.');
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const feedback = (
    <>
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="access-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
  // Make authorization available before descendant render/effects, including first mount.
  // Notify subscribers in the effect above, after React has committed the transition.
  setAccess(
    phase === 'ready' && mode === 'demo'
      ? { mode: 'demo' }
      : {
          mode: 'account',
          user: phase === 'ready' ? user || undefined : undefined,
          workspaceId: workspace?.id,
          role: workspace?.role,
        },
    false,
  );
  const createForm = (
    <form className="access-create" onSubmit={createWorkspace}>
      <label htmlFor="access-workspace-name">New workspace name</label>
      <div className="access-inline">
        <input
          id="access-workspace-name"
          name="workspaceName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={80}
          placeholder="Your company or team"
          disabled={busy}
        />
        <button disabled={busy || name.trim().length < 2} type="submit">
          Create workspace
        </button>
      </div>
    </form>
  );

  if (phase === 'loading')
    return (
      <main className="access-screen">
        <div className="access-card" role="status">
          Loading your account…
        </div>
      </main>
    );
  if (phase === 'failure')
    return (
      <main className="access-screen">
        <div className="access-card">
          <p className="access-eyebrow">{names[app]}</p>
          <h1>Account service unavailable</h1>
          {feedback}
          <button type="button" onClick={() => void loadSession()}>
            Retry
          </button>
          <button type="button" className="access-secondary" onClick={demo}>
            Try demo
          </button>
        </div>
      </main>
    );
  if (phase === 'gate')
    return (
      <main className="access-screen">
        <section className="access-card" aria-labelledby="access-title">
          <p className="access-eyebrow">{names[app]}</p>
          <h1 id="access-title">Your team’s workspace</h1>
          <p>
            Sign in to access your company’s shared workspace. Your role determines what you can
            view and change.
          </p>
          <div className="access-tabs" aria-label="Account options">
            <button
              type="button"
              aria-pressed={tab === 'login'}
              className={tab === 'login' ? '' : 'access-secondary'}
              onClick={() => {
                setTab('login');
                setError('');
              }}
            >
              Log in
            </button>
            <button
              type="button"
              aria-pressed={tab === 'signup'}
              className={tab === 'signup' ? '' : 'access-secondary'}
              onClick={() => {
                setTab('signup');
                setError('');
              }}
            >
              Create account
            </button>
          </div>
          {feedback}
          <form className="access-form" onSubmit={authenticate}>
            <label htmlFor="access-email">Work email</label>
            <input
              id="access-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
            />
            <label htmlFor="access-password">Password</label>
            <input
              id="access-password"
              name="password"
              type="password"
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
              minLength={tab === 'signup' ? 12 : undefined}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
              aria-describedby={tab === 'signup' ? 'access-password-help' : undefined}
            />
            {tab === 'signup' && (
              <p id="access-password-help" className="access-help">
                Use at least 12 characters. Confirm your email before joining a workspace.
              </p>
            )}
            <button type="submit" disabled={busy}>
              {busy ? 'Please wait…' : tab === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
          <div className="access-demo-choice">
            <p>Explore the app with sample data.</p>
            <button type="button" className="access-secondary" onClick={demo} disabled={busy}>
              Try demo
            </button>
          </div>
        </section>
      </main>
    );

  return (
    <div className="access-root">
      <AccessToolbar
        app={app}
        mode={mode}
        user={user}
        workspaces={team.workspaces}
        workspaceId={workspaceId}
        busy={busy}
        onWorkspace={selectWorkspace}
        onManage={() => {
          setNotice('');
          setError('');
          setManage(true);
        }}
        onSignOut={signOut}
        onDemo={demo}
        onAccount={() => {
          remember(preferenceKey);
          setMode('account');
          setPhase('gate');
          setNotice('');
          setError('');
          setAccess({ mode: 'account' });
        }}
      />
      {(error || notice) && <div className="access-feedback">{feedback}</div>}
      {mode === 'account' && !workspace ? (
        <main className="access-screen access-workspace-screen">
          <section className="access-card">
            <h1>Create your workspace</h1>
            <p>
              Start a workspace for your company. If someone invited you, sign in with the verified
              email they invited.
            </p>
            {createForm}
          </section>
        </main>
      ) : (
        <Fragment key={`${mode}:${workspaceId}:${mode === 'account' ? user?.id : 'demo'}`}>
          {children}
        </Fragment>
      )}
      {manage && mode === 'account' && (
        <Dialog
          title={workspace ? `${workspace.name} settings` : 'Workspace settings'}
          onClose={closeManage}
        >
          {feedback}
          <p>
            Your role: <strong>{roleLabel(workspace?.role, app)}</strong>. Only owners can manage
            access.
          </p>
          {workspace && (
            <>
              <h3>Members</h3>
              <ul className="access-members">
                {(team.members || []).map((member) => (
                  <li key={member.userId}>
                    <div>
                      <strong>{member.email}</strong>
                      {member.userId === user?.id && <span className="access-help"> (you)</span>}
                    </div>
                    <div className="access-inline">
                      {owner && member.role !== 'owner' && member.userId !== user?.id ? (
                        <>
                          <label className="access-sr" htmlFor={`access-role-${member.userId}`}>
                            Role for {member.email}
                          </label>
                          <select
                            id={`access-role-${member.userId}`}
                            disabled={busy}
                            value={member.role}
                            onChange={(e) =>
                              void teamAction({
                                action: 'role',
                                userId: member.userId,
                                role: e.target.value,
                              })
                            }
                          >
                            {assignableRoles.map((role) => (
                              <option key={role} value={role}>
                                {roleLabel(role, app)}
                              </option>
                            ))}
                          </select>
                          <button
                            className="access-secondary access-danger"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void teamAction({ action: 'remove', userId: member.userId })
                            }
                          >
                            Remove<span className="access-sr"> {member.email}</span>
                          </button>
                        </>
                      ) : (
                        <span className="access-role">{roleLabel(member.role, app)}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {owner && (
                <>
                  <h3>Invite a teammate</h3>
                  <p className="access-help">
                    They can join after signing in with this verified email. No invitation email is
                    sent.
                  </p>
                  <form
                    className="access-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void teamAction({
                        action: 'invite',
                        email: inviteEmail.trim(),
                        role: inviteRole,
                      });
                    }}
                  >
                    <label htmlFor="access-invite-email">Teammate’s email</label>
                    <input
                      id="access-invite-email"
                      name="inviteEmail"
                      type="email"
                      autoComplete="off"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                      disabled={busy}
                    />
                    <label htmlFor="access-invite-role">Workspace role</label>
                    <select
                      id="access-invite-role"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Role)}
                      disabled={busy}
                    >
                      {assignableRoles.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role, app)}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={busy}>
                      Save invitation
                    </button>
                  </form>
                  {!!team.invitations?.length && (
                    <>
                      <h3>Pending invitations</h3>
                      <ul className="access-members">
                        {team.invitations.map((invitation, i) => (
                          <li key={invitation.id || `${invitation.email}-${i}`}>
                            <span>{invitation.email}</span>
                            <span className="access-role">{roleLabel(invitation.role, app)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </>
          )}
          <h3>Create another workspace</h3>
          {createForm}
        </Dialog>
      )}
    </div>
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function AccessToolbar({
  app,
  mode,
  user,
  workspaces,
  workspaceId,
  busy,
  onWorkspace,
  onManage,
  onSignOut,
  onDemo,
  onAccount,
}: {
  app: AppName;
  mode: 'account' | 'demo';
  user: User | null;
  workspaces: Workspace[];
  workspaceId: string;
  busy: boolean;
  onWorkspace: (id: string) => void;
  onManage: () => void;
  onSignOut: () => void;
  onDemo: () => void;
  onAccount: () => void;
}) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  return (
    <div className="access-toolbar" role="region" aria-label="Account and workspace">
      <div className="access-toolbar-identity">
        <strong>{mode === 'demo' ? 'Demo workspace' : user?.email}</strong>
        <span className="access-help">
          {mode === 'demo' ? 'Sample data · shared demo access' : roleLabel(workspace?.role, app)}
        </span>
      </div>
      {mode === 'account' ? (
        <>
          <div className="access-workspace-select">
            <label htmlFor="access-workspace-select">Workspace</label>
            <select
              id="access-workspace-select"
              value={workspaceId}
              disabled={busy || !workspaces.length}
              onChange={(e) => onWorkspace(e.target.value)}
            >
              {!workspaces.length && <option value="">No workspace yet</option>}
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="access-toolbar-actions">
            <button
              type="button"
              className="access-secondary"
              onClick={onManage}
              disabled={busy || !workspaceId}
            >
              Manage workspace
            </button>
            <button type="button" className="access-secondary" onClick={onDemo} disabled={busy}>
              Switch to demo
            </button>
            <button type="button" className="access-secondary" onClick={onSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <div className="access-toolbar-actions">
          <button type="button" className="access-secondary" onClick={onAccount}>
            Exit demo / Log in
          </button>
        </div>
      )}
    </div>
  );
}
