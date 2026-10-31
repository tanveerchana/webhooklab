import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Braces,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Github,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Webhook,
  X,
  XCircle,
} from 'lucide-react';
import { filterEvents, type Workspace, type Scenario, type WebhookEvent } from './domain';
import { getWorkspaceToken } from './token';
import { AccessRoot } from './access/AccessRoot';
import { currentAccess, can, withWorkspaceAccess, handleAccessResponse } from './access/access';
import './styles.css';

type Page = 'Event stream' | 'Overview' | 'Endpoints' | 'Replay history' | 'Settings';
const names = { delivered: 'Delivered', failed: 'Failed', rejected: 'Rejected' };
function time(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC' });
}
function Status({ value }: { value: keyof typeof names }) {
  return (
    <span className={`status ${value}`}>
      <span />
      {names[value]}
    </span>
  );
}
function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="json-view">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}
/** Account sessions use HttpOnly cookies; only explicit demo mode creates a browser capability. */
async function workspaceFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (currentAccess().mode === 'demo')
    headers.set('Authorization', `Bearer ${getWorkspaceToken(localStorage)}`);
  return handleAccessResponse(await fetch(path, withWorkspaceAccess({ ...init, headers })));
}
function App() {
  const access = currentAccess();
  const isDemo = access.mode === 'demo';
  const [state, setState] = useState<Workspace | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<Page>('Event stream');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('Payload');
  const [modal, setModal] = useState<'sample' | 'setup' | 'reset' | null>(null);
  const [raw, setRaw] = useState(
    JSON.stringify(
      {
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_sandbox_1204', amount: 4900, currency: 'usd' } },
      },
      null,
      2,
    ),
  );
  const [scenario, setScenario] = useState<Scenario>('recover');
  const [invalid, setInvalid] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [demoToken, setDemoToken] = useState('');
  const [integrationKey, setIntegrationKey] = useState('');
  const [integrationConfigured, setIntegrationConfigured] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const endpoint = `${location.origin}/api/ingest`;
  const mayCapture = can('sample');
  const mayReadSecret = isDemo || can('secret');
  const modalAllowed =
    modal === 'setup' ? mayReadSecret : modal === 'sample' ? mayCapture : can('reset');
  async function read() {
    setBusy(true);
    setError('');
    try {
      const response = await workspaceFetch('/api/workspace');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Workspace could not be loaded.');
      setState(data.state);
      setRevision(data.revision);
      setIntegrationConfigured(data.workspace?.ingestionConfigured === true);
      if (isDemo) setDemoToken(getWorkspaceToken(localStorage));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workspace could not be loaded.');
      return false;
    } finally {
      setLoaded(true);
      setBusy(false);
    }
  }
  useEffect(() => {
    void read();
  }, []);
  useEffect(() => {
    if (!isDemo) return;
    const check = () => {
      if (demoToken && getWorkspaceToken(localStorage) !== demoToken) void read();
    };
    const interval = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, [demoToken, isDemo]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null);
      const tag = (event.target as HTMLElement)?.tagName;
      if (event.key === '/' && !modal && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Tab' && modal) {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button:not([disabled]), [role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select',
          ),
        );
        if (event.shiftKey && document.activeElement === nodes[0]) {
          event.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
          event.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    if (modal) document.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    return () => document.removeEventListener('keydown', keydown);
  }, [modal]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function command(command: Record<string, unknown>) {
    if (!can(String(command.type))) {
      setError('Your role does not allow this action.');
      return false;
    }
    if (isDemo && getWorkspaceToken(localStorage) !== demoToken) {
      if (await read())
        setNotice('Demo session renewed. Select an event from the refreshed workspace.');
      return false;
    }
    setBusy(true);
    setError('');
    try {
      const response = await workspaceFetch('/api/workspace', {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The change could not be saved.');
      setState(data.state);
      setRevision(data.revision);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function sendSample() {
    if (!mayCapture) return;
    setBusy(true);
    setError('');
    try {
      const response = await workspaceFetch('/api/sample', {
        method: 'POST',
        body: JSON.stringify({ raw, scenario, invalidSignature: invalid }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sample event was not saved.');
      setState(data.state);
      setRevision(data.revision);
      setSelected('');
      setStatus('all');
      setQuery('');
      setModal(null);
      setNotice('Sample event captured.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sample event was not saved.');
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, message = 'Copied to clipboard.') {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setError('Clipboard unavailable. Select and copy the displayed value.');
    }
  }
  function exportEvents() {
    if (!state) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state.events, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'webhooklab-events.json';
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Events exported as JSON.');
  }
  async function integrationAction(action: 'rotate' | 'revoke') {
    if (!can('integration-key')) return;
    setBusy(true);
    setError('');
    try {
      const response = await workspaceFetch('/api/integrations', {
        method: 'POST',
        body: JSON.stringify({ action, workspaceId: access.workspaceId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Integration key could not be changed.');
      setIntegrationConfigured(data.configured === true);
      setIntegrationKey(data.integrationKey || '');
      setNotice(
        action === 'rotate'
          ? 'New integration key created. The previous key is no longer valid.'
          : 'Integration key revoked.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Integration key could not be changed.');
    } finally {
      setBusy(false);
    }
  }
  function keyControls() {
    if (isDemo) return null;
    return (
      <div className="integration-controls">
        <h3>External integration key</h3>
        <p>
          {integrationConfigured
            ? 'An integration key is configured.'
            : 'No integration key is configured.'}{' '}
          It can capture events only; it cannot read the dashboard.
        </p>
        {can('integration-key') ? (
          <>
            <div className="integration-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void integrationAction('rotate')}
              >
                {integrationConfigured ? 'Rotate integration key' : 'Create integration key'}
              </button>
              {integrationConfigured && (
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => void integrationAction('revoke')}
                >
                  Revoke key
                </button>
              )}
            </div>
            <p className="field-help">
              Rotation immediately revokes the previous key. A new key is shown only in this page’s
              memory; copy it before leaving.
            </p>
          </>
        ) : (
          <p className="field-help">
            Only a workspace owner can create, rotate, or revoke the integration key.
          </p>
        )}
        {integrationKey && can('integration-key') && (
          <div className="copy-field">
            <code>{integrationKey}</code>
            <button
              className="icon-button"
              aria-label="Copy integration key"
              onClick={() => void copy(integrationKey)}
            >
              <Copy size={18} />
            </button>
          </div>
        )}
      </div>
    );
  }
  async function copyExample() {
    if (!mayReadSecret || !state) return;
    let secret = state.secret;
    let token = integrationKey;
    if (isDemo) {
      const current = getWorkspaceToken(localStorage);
      token = current;
      if (current !== demoToken) {
        const response = await workspaceFetch('/api/workspace');
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || 'Workspace could not be refreshed.');
          return;
        }
        secret = data.state.secret;
        setState(data.state);
        setRevision(data.revision);
        setDemoToken(current);
      }
    }
    if (!token || (!isDemo && !/^whk_ingest_[a-f0-9]{64}$/.test(token))) {
      setError('Enter a valid integration key before copying the request example.');
      return;
    }
    await copy(
      `import { createHmac } from 'node:crypto';\nconst body = JSON.stringify({ type: 'order.created' });\nconst signature = createHmac('sha256', '${secret}').update(body).digest('hex');\nconst response = await fetch('${endpoint}', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ${token}', ${!isDemo ? `'X-Workspace-Id': '${access.workspaceId}', ` : ''}'X-Webhook-Signature': 'sha256=' + signature }, body });\nconsole.log(await response.json());`,
      'Runnable Node.js example copied.',
    );
  }
  const events = useMemo(
    () => filterEvents(state?.events || [], status, query),
    [state, status, query],
  );
  const event = state?.events.find((row) => row.id === selected) || events[0] || state?.events[0];
  const total = state?.events.length || 0;
  const delivered = state?.events.filter((row) => row.status === 'delivered').length || 0;
  const failed = state?.events.filter((row) => row.status === 'failed').length || 0;
  const rejected = state?.events.filter((row) => row.status === 'rejected').length || 0;
  const attempts = state?.events.flatMap((row) => row.attempts) || [];
  const latency = attempts.length
    ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.duration, 0) / attempts.length)
    : 0;
  const replayRows =
    state?.events
      .flatMap((row) =>
        row.attempts
          .filter((attempt) => attempt.kind === 'replay')
          .map((attempt) => ({ row, attempt })),
      )
      .sort((a, b) => Date.parse(b.attempt.at) - Date.parse(a.attempt.at)) || [];
  const wait =
    event?.nextRetryAt && state
      ? Math.max(0, Math.ceil((Date.parse(event.nextRetryAt) - Date.parse(state.clock)) / 1000))
      : 0;
  function choose(row: WebhookEvent) {
    setSelected(row.id);
    setTab('Payload');
  }
  const descriptions: Record<Page, string> = {
    'Event stream': 'Inspect captured requests and investigate delivery results.',
    Overview: 'Delivery results across your retained events.',
    Endpoints: 'Configure signed inbound requests for this workspace.',
    'Replay history': 'Review manual delivery attempts and their results.',
    Settings: 'Manage signing, simulation time, exports, and workspace data.',
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setPage('Event stream');
          }}
        >
          <Webhook size={26} />
          <span>WebhookLab</span>
        </a>
        <p className="workspace-description">{isDemo ? 'Demo workspace' : 'Account workspace'}</p>
        <nav aria-label="Workspace navigation">
          {(
            [
              { name: 'Overview', icon: LayoutDashboard },
              { name: 'Event stream', icon: Activity },
              { name: 'Endpoints', icon: Webhook },
              { name: 'Replay history', icon: RotateCcw },
              { name: 'Settings', icon: Settings2 },
            ] as const
          ).map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${page === name ? 'active' : ''}`}
              onClick={() => setPage(name)}
            >
              <Icon size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Inbound capture is real.
            <br />
            Downstream delivery is simulated.
          </p>
          <a href="https://github.com/tanveerchana/webhooklab" target="_blank" rel="noreferrer">
            <Github size={18} />
            View source
          </a>
          <a href="https://singhtanveer.com" target="_blank" rel="noreferrer">
            Tanveer Singh
          </a>
        </div>
      </aside>
      <main>
        <header className="page-heading">
          <div>
            <h1>{page}</h1>
            <p>{descriptions[page]}</p>
          </div>
          <div className="heading-actions">
            {mayReadSecret && (
              <button
                className="button secondary"
                onClick={() => {
                  setError('');
                  setModal('setup');
                }}
              >
                <BookOpen size={18} />
                Connect endpoint
              </button>
            )}
            {mayCapture && (
              <button
                className="button primary"
                disabled={!state || busy}
                onClick={() => {
                  setError('');
                  setModal('sample');
                }}
              >
                <Plus size={18} />
                Send sample
              </button>
            )}
          </div>
        </header>
        {error && (
          <div className="notice error" role="alert">
            <XCircle size={20} />
            <div>
              <strong>Request could not be completed</strong>
              <p>{error}</p>
            </div>
            <button className="button secondary" onClick={() => void read()} disabled={busy}>
              Retry
            </button>
          </div>
        )}
        <div className="scope-note">
          <ShieldCheck size={18} />
          <span>
            {isDemo
              ? 'Demo data is separate from account workspaces.'
              : `${access.role ? access.role[0].toUpperCase() + access.role.slice(1) : 'Workspace'} access.`}{' '}
            Seed events are synthetic; downstream responses and timing are simulated.
          </span>
        </div>
        {!loaded ? (
          <div className="empty-state">
            <LoaderCircle className="spin" size={28} />
            <h2>Loading workspace</h2>
          </div>
        ) : !state ? (
          <div className="empty-state">
            <h2>Workspace unavailable</h2>
            <p>The server did not return saved data. Use Retry to reconnect.</p>
          </div>
        ) : (
          <>
            <section className="stats-grid" aria-label="Retained event statistics">
              {[
                { label: 'Captured events', value: total, detail: 'Current retained requests' },
                {
                  label: 'Delivery rate',
                  value: `${total ? Math.round((delivered / total) * 100) : 0}%`,
                  detail: `${delivered} delivered events`,
                },
                {
                  label: 'Failed deliveries',
                  value: failed,
                  detail: `${rejected} rejected signatures`,
                },
                {
                  label: 'Average response',
                  value: `${latency} ms`,
                  detail: 'Simulated attempt latency',
                },
              ].map((card) => (
                <div className="stat-card" key={card.label}>
                  <p>{card.label}</p>
                  <strong>{card.value}</strong>
                  <span>{card.detail}</span>
                </div>
              ))}
            </section>
            {page === 'Overview' && (
              <section className="content-card overview">
                <h2>Delivery breakdown</h2>
                <p>
                  Current status of retained requests. Manual replay can change an event’s status.
                </p>
                <div
                  className="breakdown"
                  aria-label={`${delivered} delivered, ${failed} failed, ${rejected} rejected`}
                >
                  {total > 0 && (
                    <>
                      <span
                        className="delivered"
                        style={{ width: `${(delivered / total) * 100}%` }}
                      />
                      <span className="failed" style={{ width: `${(failed / total) * 100}%` }} />
                      <span
                        className="rejected"
                        style={{ width: `${(rejected / total) * 100}%` }}
                      />
                    </>
                  )}
                </div>
                <div className="breakdown-legend">
                  <Status value="delivered" />
                  <span>{delivered}</span>
                  <Status value="failed" />
                  <span>{failed}</span>
                  <Status value="rejected" />
                  <span>{rejected}</span>
                </div>
              </section>
            )}
            {(page === 'Event stream' || page === 'Overview') && (
              <div className="workbench">
                <section className="event-panel">
                  <div className="panel-heading">
                    <h2>
                      Incoming events <span className="count">{total}</span>
                    </h2>
                    <div className="table-actions">
                      <button
                        className="icon-button"
                        onClick={() => void read()}
                        disabled={busy}
                        aria-label="Refresh events"
                      >
                        <RefreshCw size={18} className={busy ? 'spin' : ''} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={exportEvents}
                        aria-label="Export events as JSON"
                      >
                        <ArrowDownToLine size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="table-tools">
                    <label className="search-box">
                      <Search size={20} />
                      <input
                        ref={searchRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search events or payloads"
                        aria-label="Search events"
                      />
                    </label>
                    <label className="status-select">
                      <span>Status</span>
                      <select value={status} onChange={(event) => setStatus(event.target.value)}>
                        <option value="all">All events</option>
                        <option value="delivered">Delivered</option>
                        <option value="failed">Failed</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </label>
                  </div>
                  <div className="event-table-wrap">
                    <table className="event-table">
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Status</th>
                          <th>Received · UTC</th>
                          <th>Response</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((row) => (
                          <tr key={row.id} className={event?.id === row.id ? 'selected-row' : ''}>
                            <td>
                              <button className="event-select" onClick={() => choose(row)}>
                                <strong>{row.type}</strong>
                                <span>{row.id}</span>
                              </button>
                              <span className="source-label">{row.source}</span>
                            </td>
                            <td>
                              <Status value={row.status} />
                            </td>
                            <td className="mono">{time(row.receivedAt)}</td>
                            <td className="mono">{row.attempts.at(-1)?.code || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!events.length && (
                      <div className="empty-state">
                        <Search size={28} />
                        <h3>No matching events</h3>
                        <p>Change your search or status filter.</p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setQuery('');
                            setStatus('all');
                          }}
                        >
                          Clear filters
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    Showing {events.length} of {total} retained events · latest first
                  </div>
                </section>
                {event && (
                  <aside className="inspector" aria-label="Selected event inspector">
                    <div className="panel-heading">
                      <h2>
                        <Braces size={20} />
                        Event inspector
                      </h2>
                      <button
                        className="icon-button"
                        aria-label="Copy event ID"
                        onClick={() => void copy(event.id)}
                      >
                        <Copy size={18} />
                      </button>
                    </div>
                    <div className="event-summary">
                      <Status value={event.status} />
                      <h2>{event.type}</h2>
                      <p className="event-id">{event.id}</p>
                      <dl className="event-meta">
                        <div>
                          <dt>Received</dt>
                          <dd>{time(event.receivedAt)} UTC</dd>
                        </div>
                        <div>
                          <dt>Response</dt>
                          <dd>{event.attempts.at(-1)?.code || 'No delivery'}</dd>
                        </div>
                        <div>
                          <dt>Signature</dt>
                          <dd>{event.signatureValid ? 'Verified' : 'Invalid'}</dd>
                        </div>
                        <div>
                          <dt>Scenario</dt>
                          <dd>{event.scenario}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="inspector-tabs" role="tablist" aria-label="Event details">
                      {['Payload', 'Headers', 'Attempts'].map((value) => (
                        <button
                          role="tab"
                          aria-selected={tab === value}
                          key={value}
                          className={tab === value ? 'selected' : ''}
                          onClick={() => setTab(value)}
                        >
                          {value}
                          {value === 'Attempts' && ` (${event.attempts.length})`}
                        </button>
                      ))}
                    </div>
                    <div className="inspector-content" role="tabpanel">
                      {tab === 'Payload' ? (
                        <>
                          <div className="code-toolbar">
                            <span>application/json</span>
                            <button
                              className="icon-button"
                              onClick={() => void copy(JSON.stringify(event.payload, null, 2))}
                              aria-label="Copy payload"
                            >
                              <Copy size={16} />
                            </button>
                          </div>
                          <JsonView value={event.payload} />
                        </>
                      ) : tab === 'Headers' ? (
                        <div className="headers-view">
                          <p>Capture metadata. Authorization credentials are never displayed.</p>
                          <dl>
                            {[
                              ['Content-Type', 'application/json'],
                              ['Signature scheme', 'HMAC-SHA256'],
                              [
                                'Verification',
                                event.signatureValid ? 'Valid signature' : 'Invalid signature',
                              ],
                              ['Downstream', 'Simulated · no outbound HTTP'],
                            ].map(([label, value]) => (
                              <div key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ) : (
                        <div className="attempts-view">
                          {event.attempts.length ? (
                            event.attempts
                              .slice()
                              .reverse()
                              .map((attempt) => (
                                <div className="attempt" key={attempt.number}>
                                  <div>
                                    <strong>Attempt {attempt.number}</strong>
                                    <Status value={attempt.code === 200 ? 'delivered' : 'failed'} />
                                  </div>
                                  <p>{attempt.reason}</p>
                                  <span>
                                    {time(attempt.at)} UTC · {attempt.duration} ms · {attempt.kind}
                                  </span>
                                </div>
                              ))
                          ) : (
                            <p>Rejected before delivery because signature verification failed.</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="inspector-bottom">
                      <p>Downstream delivery is simulated.</p>
                      {event.status === 'failed' && wait > 0 && (
                        <p>Backoff: {wait}s remaining on the simulation clock.</p>
                      )}
                      {can('replay') && (
                        <button
                          className="button primary"
                          disabled={
                            busy || event.status !== 'failed' || event.attempts.length >= 20
                          }
                          onClick={async () => {
                            if (wait > 0) {
                              if (
                                await command({
                                  type: 'advance-clock',
                                  seconds: Math.min(3600, wait),
                                })
                              )
                                setNotice('Simulation clock advanced. Replay is ready.');
                            } else if (await command({ type: 'replay', id: event.id })) {
                              setTab('Attempts');
                              setNotice('Replay completed.');
                            }
                          }}
                        >
                          <RotateCcw size={18} />
                          {event.status === 'delivered'
                            ? 'Already delivered'
                            : event.status === 'rejected'
                              ? 'Cannot replay rejected event'
                              : event.attempts.length >= 20
                                ? 'Attempt limit reached'
                                : wait > 0
                                  ? `Advance clock ${wait}s`
                                  : 'Replay event'}
                        </button>
                      )}
                      {!can('replay') && (
                        <p className="read-only">
                          Your role has read-only access to delivery attempts.
                        </p>
                      )}
                    </div>
                  </aside>
                )}
              </div>
            )}
            {page === 'Endpoints' && (
              <section className="content-card endpoint-page">
                <h2>Inbound endpoint</h2>
                <p>
                  Requests are captured over HTTP. The delivery result comes from a deterministic
                  simulator.
                </p>
                <div className="endpoint-url">
                  <span>POST</span>
                  <code>{endpoint}</code>
                  <button
                    className="icon-button"
                    onClick={() => void copy(endpoint)}
                    aria-label="Copy endpoint URL"
                  >
                    <Copy size={18} />
                  </button>
                </div>
                <dl className="endpoint-details">
                  <div>
                    <dt>Verification</dt>
                    <dd>HMAC-SHA256 of exact request bytes</dd>
                  </div>
                  <div>
                    <dt>Payload limit</dt>
                    <dd>64 KB · valid JSON</dd>
                  </div>
                  <div>
                    <dt>Retention</dt>
                    <dd>Up to 150 events within a 450 KB state budget</dd>
                  </div>
                  <div>
                    <dt>Downstream</dt>
                    <dd>Simulated only · no external forwarding</dd>
                  </div>
                </dl>
                {keyControls()}
                {mayReadSecret ? (
                  <button
                    className="button primary"
                    onClick={() => {
                      setError('');
                      setModal('setup');
                    }}
                  >
                    <BookOpen size={18} />
                    Integration instructions
                  </button>
                ) : (
                  <p className="read-only">
                    An owner or editor can configure inbound integration credentials.
                  </p>
                )}
              </section>
            )}
            {page === 'Replay history' && (
              <section className="content-card">
                <div className="panel-heading">
                  <h2>Manual replay attempts</h2>
                  <span>{replayRows.length} attempts</span>
                </div>
                {replayRows.length ? (
                  <div className="history-list">
                    {replayRows.map(({ row, attempt }) => (
                      <button
                        key={`${row.id}-${attempt.number}`}
                        className="history-row"
                        onClick={() => {
                          choose(row);
                          setTab('Attempts');
                          setPage('Event stream');
                        }}
                      >
                        <div>
                          <strong>{row.type}</strong>
                          <span>
                            Attempt {attempt.number} · {time(attempt.at)} UTC · {attempt.duration}{' '}
                            ms
                          </span>
                        </div>
                        <Status value={attempt.code === 200 ? 'delivered' : 'failed'} />
                        <ChevronRight size={20} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <RotateCcw size={28} />
                    <h3>No manual replays yet</h3>
                    <p>Replay a failed event to record an attempt here.</p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setPage('Event stream');
                        setStatus('failed');
                      }}
                    >
                      View failed events
                    </button>
                  </div>
                )}
              </section>
            )}
            {page === 'Settings' && (
              <section className="content-card settings-page">
                <h2>Workspace settings</h2>
                <div className="settings-row">
                  <div>
                    <h3>Storage</h3>
                    <p>
                      {isDemo ? 'Isolated demo capability' : 'Authenticated account workspace'} ·
                      saved revision {revision}
                    </p>
                  </div>
                  <button className="button secondary" onClick={() => void read()} disabled={busy}>
                    <RefreshCw size={18} />
                    Refresh
                  </button>
                </div>
                {mayReadSecret && (
                  <div className="settings-row">
                    <div>
                      <h3>Signing secret</h3>
                      <p>Used to verify inbound request bytes.</p>
                      {showSecret && <code className="secret-value">{state.secret}</code>}
                    </div>
                    <button className="button secondary" onClick={() => setShowSecret(!showSecret)}>
                      {showSecret ? 'Hide secret' : 'Reveal secret'}
                    </button>
                  </div>
                )}
                <div className="settings-row">
                  <div>
                    <h3>Simulation clock</h3>
                    <p>{new Date(state.clock).toISOString()}</p>
                  </div>
                  {can('advance-clock') && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void command({ type: 'advance-clock', seconds: 60 })}
                    >
                      <Clock3 size={18} />
                      Advance 60s
                    </button>
                  )}
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Export events</h3>
                    <p>Download retained payloads and attempt history.</p>
                  </div>
                  <button className="button secondary" onClick={exportEvents}>
                    <ArrowDownToLine size={18} />
                    Export JSON
                  </button>
                </div>
                {can('reset') && (
                  <div className="settings-row">
                    <div>
                      <h3>Reset workspace data</h3>
                      <p>
                        Replace captured data with synthetic events and rotate the signing secret.
                      </p>
                    </div>
                    <button
                      className="button danger"
                      onClick={() => {
                        setError('');
                        setModal('reset');
                      }}
                    >
                      <RotateCcw size={18} />
                      Reset data
                    </button>
                  </div>
                )}
              </section>
            )}
            <footer className="page-footer">
              <span>Saved workspace · {total} retained events</span>
              <span>All displayed times are UTC</span>
            </footer>
          </>
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={20} />
          {notice}
        </div>
      )}
      {modal && modalAllowed && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className={`modal ${modal === 'setup' ? 'wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setModal(null)}
              aria-label="Close dialog"
            >
              <X size={22} />
            </button>
            <h2 id="modal-title">
              {modal === 'sample'
                ? 'Send a sample event'
                : modal === 'setup'
                  ? 'Connect an endpoint'
                  : 'Reset workspace data?'}
            </h2>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {modal === 'sample' ? (
              <>
                <p>
                  The API signs the payload and captures it with the selected simulated delivery
                  scenario.
                </p>
                <label className="field-label">
                  Delivery scenario
                  <select
                    value={scenario}
                    onChange={(event) => setScenario(event.target.value as Scenario)}
                  >
                    <option value="recover">Fails once, recovers on replay</option>
                    <option value="success">Always succeeds · 200</option>
                    <option value="always-fail">Always fails · 503</option>
                  </select>
                </label>
                <label className="field-label">
                  JSON payload
                  <textarea
                    spellCheck={false}
                    value={raw}
                    onChange={(event) => setRaw(event.target.value)}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={invalid}
                    onChange={(event) => setInvalid(event.target.checked)}
                  />
                  Send an invalid signature to test rejection
                </label>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void sendSample()}
                >
                  <Send size={18} />
                  {busy ? 'Sending…' : 'Send sample event'}
                </button>
              </>
            ) : modal === 'reset' ? (
              <>
                <p>
                  All captured events and attempt history will be replaced by a new synthetic
                  dataset. The signing secret will change.
                </p>
                <div className="modal-actions">
                  <button className="button secondary" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={async () => {
                      if (await command({ type: 'reset' })) {
                        setSelected('');
                        setModal(null);
                        setNotice('Workspace reset. Signing secret rotated.');
                      }
                    }}
                  >
                    Reset data
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Sign exact request bytes with the workspace signing secret. Capture acknowledges
                  storage; downstream delivery remains simulated.
                </p>
                <label className="field-label">
                  Endpoint
                  <div className="copy-field">
                    <code>{endpoint}</code>
                    <button
                      className="icon-button"
                      onClick={() => void copy(endpoint)}
                      aria-label="Copy endpoint"
                    >
                      <Copy size={18} />
                    </button>
                  </div>
                </label>
                {keyControls()}
                {isDemo ? (
                  <label className="field-label">
                    Demo bearer token
                    <div className="copy-field">
                      <code>{demoToken.slice(0, 12)}…</code>
                      <button
                        className="icon-button"
                        onClick={() => void copy(getWorkspaceToken(localStorage))}
                        aria-label="Copy demo token"
                      >
                        <Copy size={18} />
                      </button>
                    </div>
                    <span className="field-help">
                      This capability accesses only the public demo, never your account.
                    </span>
                  </label>
                ) : (
                  <label className="field-label">
                    Account integration key
                    <input
                      type="password"
                      value={integrationKey}
                      onChange={(event) => setIntegrationKey(event.target.value)}
                      placeholder="Paste a newly issued whk_ integration key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="field-help">
                      Account session cookies are never copied into integration examples.
                      Integration keys are kept only in this page’s memory.
                    </span>
                  </label>
                )}
                <label className="field-label">
                  Signing secret
                  <div className="copy-field">
                    <code>{showSecret ? state?.secret : 'Hidden'}</code>
                    <button className="button secondary" onClick={() => setShowSecret(!showSecret)}>
                      {showSecret ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                </label>
                <pre className="setup-code">
                  <code>{`import { createHmac } from 'node:crypto';\n\nconst body = JSON.stringify({ type: 'order.created' });\nconst signature = createHmac('sha256', 'YOUR_SIGNING_SECRET')\n  .update(body).digest('hex');\n\nconst response = await fetch('${endpoint}', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    Authorization: 'Bearer YOUR_INTEGRATION_KEY',\n${!isDemo ? `    'X-Workspace-Id': '${access.workspaceId}',\n` : ''}    'X-Webhook-Signature': 'sha256=' + signature\n  },\n  body\n});\nconsole.log(await response.json());`}</code>
                </pre>
                <button
                  className="button primary"
                  disabled={!isDemo && !integrationKey.trim()}
                  onClick={() => void copyExample()}
                >
                  <Copy size={18} />
                  Copy runnable Node.js example
                </button>
                <p className="field-help">
                  Optional header X-Delivery-Scenario: success, recover, or always-fail. Refresh
                  events after an external capture.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AccessRoot app="webhooklab">
      <App />
    </AccessRoot>
  </React.StrictMode>,
);
