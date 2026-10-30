import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Braces,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  FlaskConical,
  Github,
  LayoutDashboard,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Webhook,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  seedWorkspace,
  reduceWorkspace,
  filterEvents,
  captureEvent,
  type Workspace,
  type WebhookEvent,
  type Scenario,
} from './domain';
import './styles.css';
import { getWorkspaceToken } from './token';
import { recentEventSeries } from './metrics';
const getToken = () => getWorkspaceToken(localStorage);
const statusLabel: Record<string, string> = {
  delivered: 'Delivered',
  failed: 'Failed',
  rejected: 'Rejected',
};
function Status({ value }: { value: string }) {
  return (
    <span className={'status ' + value}>
      <span />
      {statusLabel[value] || value}
    </span>
  );
}
function formatTime(time: string) {
  return new Date(time).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
}
function Spark({
  values,
  label,
  color = 'var(--mint)',
}: {
  values: number[];
  label: string;
  color?: string;
}) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const points = values.map(
    (value, i) =>
      `${values.length === 1 ? 60 : (i * 120) / (values.length - 1)},${36 - (value / max) * 30}`,
  );
  const title = `${label} · recent retained events, oldest to newest: ${values.map((v) => Math.round(v * 10) / 10).join(', ')}`;
  return (
    <svg viewBox="0 0 120 40" className="spark" role="img" aria-label={title}>
      <title>{title}</title>
      <path d={`M 0 40 L ${points.join(' L ')} L 120 40 Z`} fill={color} opacity=".07" />
      {values.length === 1 ? (
        <circle cx="60" cy={36 - (values[0] / max) * 30} r="2" fill={color} />
      ) : (
        <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="1.8" />
      )}
    </svg>
  );
}
function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="code-lines">
      {text.split('\n').map((line, i) => (
        <div className="code-line" key={i}>
          <span className="line-no">{i + 1}</span>
          <code>
            {line
              .split(/("(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g)
              .map((token, j) => (
                <span
                  key={j}
                  className={
                    token.startsWith('"')
                      ? line
                          .slice(line.indexOf(token) + token.length)
                          .trimStart()
                          .startsWith(':')
                        ? 'json-key'
                        : 'json-string'
                      : /^\d/.test(token)
                        ? 'json-number'
                        : ''
                  }
                >
                  {token}
                </span>
              ))}
          </code>
        </div>
      ))}
    </div>
  );
}
function App() {
  const [token, setToken] = useState(getToken);
  const [workspaceToken, setWorkspaceToken] = useState('');
  const [state, setState] = useState<Workspace | null>(null);
  const [mode, setMode] = useState<'cloud' | 'local'>('cloud');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nav, setNav] = useState('Event stream');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('Payload');
  const [modal, setModal] = useState<'sample' | 'setup' | 'reset' | null>(null);
  const [scenario, setScenario] = useState<Scenario>('recover');
  const [raw, setRaw] = useState(
    JSON.stringify(
      {
        type: 'invoice.payment_failed',
        data: {
          object: { id: 'in_sandbox_1204', amount: 4900, currency: 'usd', customer: 'cus_sandbox' },
        },
      },
      null,
      2,
    ),
  );
  const [invalid, setInvalid] = useState(false);
  const [toast, setToast] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  function requestHeaders() {
    const current = getToken();
    setToken(current);
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${current}` };
  }
  async function read() {
    setBusy(true);
    setError('');
    try {
      const currentHeaders = requestHeaders();
      const r = await fetch('/api/workspace', { headers: currentHeaders });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Cloud workspace unavailable.');
      setWorkspaceToken(currentHeaders.Authorization.slice(7));
      setState(data.state);
      setRevision(data.revision);
      setMode('cloud');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cloud workspace unavailable.');
      return false;
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }
  useEffect(() => {
    void read();
  }, []);
  useEffect(() => {
    const refreshExpired = () => {
      if (mode === 'cloud' && getToken() !== token) void read();
    };
    const timer = setInterval(refreshExpired, 60000);
    window.addEventListener('focus', refreshExpired);
    document.addEventListener('visibilitychange', refreshExpired);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshExpired);
      document.removeEventListener('visibilitychange', refreshExpired);
    };
  }, [token, mode]);
  async function currentCredentials() {
    const current = getToken();
    if (current === workspaceToken || mode === 'local')
      return { token: current, secret: state?.secret };
    setToken(current);
    const r = await fetch('/api/workspace', { headers: requestHeaders() });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Workspace refresh failed.');
    setState(data.state);
    setRevision(data.revision);
    setMode('cloud');
    setWorkspaceToken(current);
    return { token: current, secret: (data.state as Workspace).secret };
  }
  async function copyToken() {
    try {
      const credentials = await currentCredentials();
      await copy(credentials.token, 'Workspace token copied');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workspace refresh failed.');
    }
  }
  async function copyExample() {
    try {
      const credentials = await currentCredentials();
      await copy(
        `import { createHmac } from 'node:crypto';\nconst body = JSON.stringify({ type: 'order.created' });\nconst signature = createHmac('sha256', '${credentials.secret}').update(body).digest('hex');\nconst response = await fetch('${location.origin}/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ${credentials.token}', 'X-Webhook-Signature': 'sha256=' + signature }, body });\nconsole.log(await response.json());`,
        'Complete runnable example copied',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workspace refresh failed.');
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === 'Escape') setModal(null);
      if (e.key === '/' && !modal && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label="Search events"]')?.focus();
      }
      if (e.key === 'Tab' && modal) {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button:not([disabled]), [role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea',
          ),
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    if (modal) document.querySelector<HTMLButtonElement>('.modal-close')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function accept(next: Workspace) {
    setState(next);
    if (!selected) setSelected(next.events[0]?.id || '');
  }
  async function command(command: Record<string, unknown>) {
    if (!state) return;
    if (mode === 'cloud' && getToken() !== workspaceToken) {
      if (await read())
        setError('Workspace capability rotated. Select an event in the refreshed workspace.');
      return false;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'local') {
        accept(reduceWorkspace(state, command));
      } else {
        const r = await fetch('/api/workspace', {
          method: 'POST',
          headers: requestHeaders(),
          body: JSON.stringify({ command }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Workspace update failed.');
        accept(data.state);
        setRevision(data.revision);
        setWorkspaceToken(getToken());
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function sample() {
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'local') {
        accept(captureEvent(state, raw, !invalid, scenario, 'Sample'));
      } else {
        const r = await fetch('/api/sample', {
          method: 'POST',
          headers: requestHeaders(),
          body: JSON.stringify({ raw, scenario, invalidSignature: invalid }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Sample delivery failed.');
        accept(data.state);
        setRevision(data.revision);
        setWorkspaceToken(getToken());
      }
      setSelected('');
      setFilter('all');
      setQuery('');
      setModal(null);
      setToast('Sample captured. Inspect its payload and delivery result.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sample failed.');
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, label = 'Copied to clipboard') {
    try {
      await navigator.clipboard.writeText(value);
      setToast(label);
    } catch {
      setError('Clipboard unavailable. Select and copy the displayed value.');
    }
  }
  function download() {
    if (!state) return;
    const blob = new Blob([JSON.stringify(state.events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webhooklab-events.json';
    a.click();
    URL.revokeObjectURL(url);
    setToast('Event export downloaded.');
  }
  const events = useMemo(
    () => (state ? filterEvents(state.events, filter, query) : []),
    [state, filter, query],
  );
  const event = state?.events.find((e) => e.id === selected) || events[0] || state?.events[0];
  const counts = {
    delivered: state?.events.filter((e) => e.status === 'delivered').length || 0,
    failed: state?.events.filter((e) => e.status === 'failed').length || 0,
    rejected: state?.events.filter((e) => e.status === 'rejected').length || 0,
  };
  const endpoint = `${location.origin}/api/ingest`;
  const latest = event?.attempts.at(-1);
  const wait =
    event?.nextRetryAt && state
      ? Math.max(0, Math.ceil((Date.parse(event.nextRetryAt) - Date.parse(state.clock)) / 1000))
      : 0;
  const total = state?.events.length || 0;
  const trends = useMemo(() => recentEventSeries(state?.events || []), [state]);
  const successRate = total ? Math.round((counts.delivered / total) * 100) : 0;
  const avgLatency = state
    ? Math.round(
        state.events.flatMap((e) => e.attempts).reduce((s, a) => s + a.duration, 0) /
          Math.max(1, state.events.flatMap((e) => e.attempts).length),
      )
    : 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setNav('Event stream');
          }}
        >
          <span className="brand-mark">
            <Webhook size={23} />
          </span>
          <span>
            Webhook<span className="brand-light">Lab</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-icon">T</span>
          <span>
            <strong>Tanveer’s workspace</strong>
            <small>Personal sandbox</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {[
            { name: 'Overview', icon: LayoutDashboard },
            { name: 'Event stream', icon: Activity },
            { name: 'Endpoints', icon: Webhook },
            { name: 'Replay history', icon: RotateCcw },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={'nav-item ' + (nav === name ? 'active' : '')}
              onClick={() => setNav(name)}
            >
              <Icon size={17} />
              <span>{name}</span>
              {name === 'Event stream' && <span className="nav-count">{total}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-caption second">DEVELOPER</div>
        <button
          className={'nav-item ' + (nav === 'Settings' ? 'active' : '')}
          onClick={() => setNav('Settings')}
        >
          <Settings2 size={17} />
          Settings
        </button>
        <button className="nav-item" onClick={() => setModal('setup')}>
          <BookOpen size={17} />
          Quickstart
          <ArrowUpRight size={13} className="muted" />
        </button>
        <div className="sidebar-bottom">
          <div className="sandbox-note">
            <FlaskConical size={18} />
            <strong>A safe place to break things.</strong>
            <p>
              Real capture. Simulated delivery.
              <br />
              Zero production surprises.
            </p>
            <span>
              <span className="tiny-dot" /> SANDBOX ENVIRONMENT
            </span>
          </div>
          <a className="author" href="https://singhtanveer.com" target="_blank" rel="noreferrer">
            <span className="avatar">TS</span>
            <span>
              <strong>Tanveer Singh</strong>
              <small>Designed & engineered</small>
            </span>
            <ArrowUpRight size={14} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>{nav}</span>
          </div>
          <div className="top-actions">
            <span className="sandbox-chip">
              <span />
              Sandbox
            </span>
            <a
              href="https://github.com/tanveerchana/webhooklab"
              target="_blank"
              rel="noreferrer"
              className="github-link"
            >
              <Github size={16} />
              <span>Source code</span>
              <ArrowUpRight size={12} />
            </a>
            <span className="small-avatar">TS</span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-dot" /> YOUR WEBHOOKS, IN FOCUS
              </div>
              <h1>{nav}</h1>
              <p>
                {nav === 'Event stream'
                  ? 'Every event, from first request to final delivery.'
                  : nav === 'Overview'
                    ? 'A clear picture of your webhook delivery health.'
                    : nav === 'Endpoints'
                      ? 'One endpoint. Every event accounted for.'
                      : nav === 'Replay history'
                        ? 'A complete trail of every recovery attempt.'
                        : 'Your sandbox, configured your way.'}
              </p>
            </div>
            <div className="heading-actions">
              <button className="button secondary" onClick={() => setModal('setup')}>
                <Code2 size={15} />
                Connect endpoint
              </button>
              <button
                className="button primary"
                onClick={() => setModal('sample')}
                disabled={!state || busy}
              >
                <Plus size={16} />
                Send sample event
              </button>
            </div>
          </section>
          {error && (
            <div className="error-banner" role="alert">
              <XCircle size={17} />
              <div>
                <strong>{state ? 'Request failed' : 'Cloud workspace unavailable'}</strong>
                <span>{error}</span>
                {!state && loaded && (
                  <button
                    onClick={() => {
                      setState(seedWorkspace());
                      setMode('local');
                      setError('');
                    }}
                  >
                    Explore an explicit local demo →
                  </button>
                )}
              </div>
              <button aria-label="Retry cloud connection" onClick={() => void read()}>
                <RefreshCw size={16} />
              </button>
            </div>
          )}
          {mode === 'local' && (
            <div className="local-banner">
              <FlaskConical size={16} />
              <span>
                <strong>Local demo</strong> · Changes last for this session. External capture
                requires the cloud API.
              </span>
              <button onClick={() => void read()}>
                Reconnect cloud <ArrowRight size={13} />
              </button>
            </div>
          )}
          {!state && !loaded ? (
            <div className="loading">
              <LoaderCircle className="spin" size={24} />
              <h2>Opening your workbench</h2>
              <p>Connecting to your private workspace…</p>
            </div>
          ) : state ? (
            <>
              <div className="stats-grid">
                {[
                  {
                    label: 'Total events',
                    value: total,
                    detail: 'All captured requests',
                    icon: Webhook,
                    color: 'var(--mint)',
                    series: trends.total,
                    scope: 'Cumulative captured count',
                  },
                  {
                    label: 'Delivery rate',
                    value: `${successRate}%`,
                    detail: `${counts.delivered} events delivered`,
                    icon: CheckCheck,
                    color: 'var(--mint)',
                    series: trends.deliveryRate,
                    scope: 'Running delivery percentage',
                  },
                  {
                    label: 'Failed deliveries',
                    value: counts.failed,
                    detail: 'Ready for investigation',
                    icon: CircleDot,
                    color: 'var(--amber)',
                    series: trends.failures,
                    scope: 'Cumulative failed count',
                  },
                  {
                    label: 'Avg. response',
                    value: avgLatency,
                    unit: 'ms',
                    detail: 'Simulated downstream',
                    icon: Zap,
                    color: 'var(--blue)',
                    series: trends.latency,
                    scope:
                      'Latest simulated attempt latency in milliseconds (rejected events excluded)',
                  },
                ].map((card) => (
                  <div className="stat-card" key={card.label}>
                    <div className="stat-label">
                      {card.label}
                      <card.icon size={15} />
                    </div>
                    <div className="stat-value">
                      {card.value}
                      <span>{card.unit}</span>
                    </div>
                    <div className="stat-detail">
                      <span className="stat-dot" style={{ background: card.color }} />
                      {card.detail}
                    </div>
                    <Spark color={card.color} values={card.series} label={card.scope} />
                  </div>
                ))}
              </div>
              {nav === 'Event stream' || nav === 'Overview' ? (
                <>
                  {nav === 'Overview' && (
                    <section className="overview-panel">
                      <div>
                        <span className="section-kicker">DELIVERY BREAKDOWN</span>
                        <h2>Your event pipeline, at a glance.</h2>
                        <p>
                          Seed events are synthetic. New inbound HTTP requests are captured live.
                        </p>
                      </div>
                      <div className="breakdown">
                        <div style={{ width: `${successRate}%` }} />
                        <div style={{ width: `${total ? (counts.failed / total) * 100 : 0}%` }} />
                        <div style={{ width: `${total ? (counts.rejected / total) * 100 : 0}%` }} />
                      </div>
                      <div className="breakdown-labels">
                        <span>
                          <i className="green" />
                          {counts.delivered} delivered
                        </span>
                        <span>
                          <i className="orange" />
                          {counts.failed} failed
                        </span>
                        <span>
                          <i className="red" />
                          {counts.rejected} rejected
                        </span>
                      </div>
                    </section>
                  )}
                  <div className="workbench">
                    <section className="event-panel">
                      <div className="panel-heading">
                        <div>
                          <Radio size={16} />
                          <h2>Incoming events</h2>
                          <span className="number-badge">{total}</span>
                        </div>
                        <span className="live-label">
                          <span className="tiny-dot" />
                          {mode === 'cloud' ? 'Cloud workspace' : 'Local session'}
                        </span>
                      </div>
                      <div className="table-tools">
                        <label className="search-box">
                          <Search size={15} />
                          <input
                            aria-label="Search events"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search events, IDs, or payloads…"
                          />
                          <kbd>/</kbd>
                        </label>
                        <button
                          className="icon-button"
                          aria-label="Refresh events"
                          onClick={() =>
                            mode === 'cloud'
                              ? void read()
                              : setToast('Local session is up to date.')
                          }
                          disabled={busy}
                        >
                          <RefreshCw size={15} className={busy ? 'spin' : ''} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Export events as JSON"
                          onClick={download}
                        >
                          <ArrowDownToLine size={15} />
                        </button>
                      </div>
                      <div className="filter-tabs">
                        {[
                          ['all', 'All events', total],
                          ['delivered', 'Delivered', counts.delivered],
                          ['failed', 'Failed', counts.failed],
                          ['rejected', 'Rejected', counts.rejected],
                        ].map(([key, label, n]) => (
                          <button
                            key={key}
                            className={filter === key ? 'selected' : ''}
                            onClick={() => setFilter(String(key))}
                          >
                            {label}
                            <span>{n}</span>
                          </button>
                        ))}
                      </div>
                      <div className="event-table-wrap">
                        <table className="event-table">
                          <thead>
                            <tr>
                              <th>EVENT</th>
                              <th>STATUS</th>
                              <th>RECEIVED</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {events.map((e) => (
                              <tr
                                key={e.id}
                                className={event?.id === e.id ? 'selected-row' : ''}
                                onClick={() => {
                                  setSelected(e.id);
                                  setTab('Payload');
                                }}
                              >
                                <td>
                                  <button
                                    className="event-select"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      setSelected(e.id);
                                      setTab('Payload');
                                    }}
                                  >
                                    <span className={'event-icon ' + e.status}>
                                      {e.status === 'delivered' ? (
                                        <ArrowDownToLine size={15} />
                                      ) : e.status === 'failed' ? (
                                        <RotateCcw size={15} />
                                      ) : (
                                        <ShieldCheck size={15} />
                                      )}
                                    </span>
                                    <span>
                                      <strong>{e.type}</strong>
                                      <small>
                                        {e.id.slice(0, 16)} <span>· {e.source}</span>
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <Status value={e.status} />
                                </td>
                                <td className="time-cell">
                                  {formatTime(e.receivedAt)}
                                  <small>
                                    {e.attempts.at(-1)?.code || '—'}{' '}
                                    <span>· {e.attempts.at(-1)?.duration || 0} ms</span>
                                  </small>
                                </td>
                                <td>
                                  <ChevronRight size={13} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {events.length === 0 && (
                          <div className="empty-state">
                            <Search size={25} />
                            <h3>No matching events</h3>
                            <p>Try a different search or status filter.</p>
                            <button
                              onClick={() => {
                                setFilter('all');
                                setQuery('');
                              }}
                            >
                              Clear filters
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="table-footer">
                        <span>
                          Showing {events.length} of {total} events
                        </span>
                        <span>
                          Latest first <ArrowDownToLine size={12} />
                        </span>
                      </div>
                    </section>
                    {event && (
                      <aside className="inspector">
                        <div className="inspector-heading">
                          <span>
                            <Braces size={16} />
                            Event inspector
                          </span>
                          <button
                            className="icon-button"
                            onClick={() => copy(event.id, 'Event ID copied')}
                            aria-label="Copy event ID"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <div className="event-summary">
                          <div className="summary-top">
                            <span className="section-kicker">
                              {event.source.toUpperCase()} EVENT
                            </span>
                            <Status value={event.status} />
                          </div>
                          <h2>{event.type}</h2>
                          <div className="event-id">
                            {event.id}
                            <button aria-label="Copy full event ID" onClick={() => copy(event.id)}>
                              <Copy size={12} />
                            </button>
                          </div>
                          <div className="event-meta">
                            <div>
                              <span>Response</span>
                              <strong className={latest?.code === 200 ? 'mint-text' : 'amber-text'}>
                                {latest
                                  ? `${latest.code} ${latest.code === 200 ? 'OK' : 'Service Unavailable'}`
                                  : 'Signature rejected'}
                              </strong>
                            </div>
                            <div>
                              <span>Received at</span>
                              <strong>{formatTime(event.receivedAt)} UTC</strong>
                            </div>
                            <div>
                              <span>Delivery time</span>
                              <strong>{latest?.duration || 0} ms</strong>
                            </div>
                            <div>
                              <span>Signature</span>
                              <strong className={event.signatureValid ? 'mint-text' : 'red-text'}>
                                {event.signatureValid ? (
                                  <ShieldCheck size={12} />
                                ) : (
                                  <XCircle size={12} />
                                )}{' '}
                                {event.signatureValid ? 'Verified' : 'Invalid'}
                              </strong>
                            </div>
                          </div>
                        </div>
                        <div className="inspector-tabs">
                          {['Payload', 'Headers', 'Attempts'].map((t) => (
                            <button
                              key={t}
                              className={tab === t ? 'selected' : ''}
                              onClick={() => setTab(t)}
                            >
                              {t}
                              {t === 'Attempts' && <span>{event.attempts.length}</span>}
                            </button>
                          ))}
                        </div>
                        <div className="inspector-content">
                          {tab === 'Payload' ? (
                            <>
                              <div className="code-toolbar">
                                <span>
                                  <span className="json-dot" /> application/json
                                </span>
                                <button
                                  onClick={() =>
                                    copy(JSON.stringify(event.payload, null, 2), 'Payload copied')
                                  }
                                  aria-label="Copy payload"
                                >
                                  <Copy size={13} />
                                </button>
                              </div>
                              <JsonView value={event.payload} />
                            </>
                          ) : tab === 'Headers' ? (
                            <div className="headers-view">
                              <p>
                                Capture metadata. Sensitive authorization values are never
                                displayed.
                              </p>
                              {[
                                ['Content-Type', 'application/json'],
                                ['X-Webhook-Event', event.type],
                                ['Signature scheme', 'HMAC-SHA256'],
                                [
                                  'Verification',
                                  event.signatureValid ? 'Valid signature' : 'Invalid signature',
                                ],
                                ['Downstream', 'Simulated · no outbound HTTP'],
                                ['Scenario', event.scenario],
                              ].map(([k, v]) => (
                                <div key={k}>
                                  <span>{k}</span>
                                  <code>{v}</code>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="attempts-view">
                              <p>Delivery runs against a deterministic local simulator.</p>
                              {event.attempts.length ? (
                                event.attempts
                                  .slice()
                                  .reverse()
                                  .map((a) => (
                                    <div className="attempt" key={a.number}>
                                      <span
                                        className={
                                          a.code === 200 ? 'attempt-dot success' : 'attempt-dot'
                                        }
                                      />
                                      <div>
                                        <strong>
                                          Attempt {a.number}
                                          <span>
                                            {a.kind === 'replay'
                                              ? 'Manual replay'
                                              : 'Initial delivery'}
                                          </span>
                                        </strong>
                                        <p>{a.reason}</p>
                                        <small>
                                          {formatTime(a.at)} · {a.duration} ms
                                        </small>
                                      </div>
                                      <code className={a.code === 200 ? 'mint-text' : 'amber-text'}>
                                        {a.code}
                                      </code>
                                    </div>
                                  ))
                              ) : (
                                <div className="no-attempts">
                                  <ShieldCheck size={24} />
                                  <h3>Rejected before delivery</h3>
                                  <p>
                                    Signature verification failed. The downstream was never called.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="inspector-bottom">
                          <div className="simulation-label">
                            <FlaskConical size={13} />
                            Simulated downstream ·{' '}
                            {event.scenario === 'recover'
                              ? 'recovers on retry'
                              : event.scenario === 'always-fail'
                                ? 'always returns 503'
                                : 'returns 200'}
                          </div>
                          {wait > 0 && event.status === 'failed' && (
                            <p className="backoff-note">
                              Backoff: {wait}s remaining on the simulation clock.
                            </p>
                          )}
                          <button
                            className="button primary replay-button"
                            disabled={
                              busy || event.status !== 'failed' || event.attempts.length >= 20
                            }
                            onClick={async () => {
                              if (wait > 0) {
                                const ok = await command({
                                  type: 'advance-clock',
                                  seconds: Math.min(3600, wait),
                                });
                                if (ok)
                                  setToast('Simulation clock advanced. Replay is now available.');
                              } else {
                                const ok = await command({ type: 'replay', id: event.id });
                                if (ok) {
                                  setTab('Attempts');
                                  setToast('Replay completed. Delivery history updated.');
                                }
                              }
                            }}
                          >
                            <RotateCcw size={15} />
                            {event.status === 'delivered'
                              ? 'Successfully delivered'
                              : event.status === 'rejected'
                                ? 'Signature verification failed'
                                : event.attempts.length >= 20
                                  ? 'Replay limit reached'
                                  : wait > 0
                                    ? `Advance clock ${wait}s`
                                    : 'Replay event'}
                            {event.status === 'failed' && <ArrowRight size={15} />}
                          </button>
                        </div>
                      </aside>
                    )}
                  </div>
                </>
              ) : nav === 'Endpoints' ? (
                <section className="content-card endpoint-page">
                  <div className="endpoint-card-icon">
                    <Webhook size={26} />
                  </div>
                  <div className="section-kicker">INBOUND ENDPOINT</div>
                  <h2>Your front door for webhooks.</h2>
                  <p>
                    Send a signed JSON request to capture it in this workspace. Inbound HTTP is
                    real; downstream delivery is simulated.
                  </p>
                  <div className="endpoint-url">
                    <span>POST</span>
                    <code>{endpoint}</code>
                    <button onClick={() => copy(endpoint)} aria-label="Copy endpoint">
                      <Copy size={16} />
                    </button>
                  </div>
                  <div className="endpoint-details">
                    <div>
                      <span>Authentication</span>
                      <strong>Bearer workspace token</strong>
                    </div>
                    <div>
                      <span>Verification</span>
                      <strong>HMAC-SHA256 · exact request bytes</strong>
                    </div>
                    <div>
                      <span>Payload limit</span>
                      <strong>64 KB · valid JSON</strong>
                    </div>
                    <div>
                      <span>Retention</span>
                      <strong>Latest 150 events / workspace</strong>
                    </div>
                  </div>
                  <button className="button primary" onClick={() => setModal('setup')}>
                    <Terminal size={15} />
                    View integration quickstart
                    <ArrowRight size={15} />
                  </button>
                </section>
              ) : nav === 'Replay history' ? (
                <section className="content-card">
                  <div className="panel-heading">
                    <div>
                      <RotateCcw size={16} />
                      <h2>Replay history</h2>
                    </div>
                    <span className="subtle">Manual attempts · simulation clock</span>
                  </div>
                  {state.events
                    .flatMap((e) =>
                      e.attempts.filter((a) => a.kind === 'replay').map((a) => ({ e, a })),
                    )
                    .sort((a, b) => Date.parse(b.a.at) - Date.parse(a.a.at))
                    .map(({ e, a }) => (
                      <button
                        className="history-row"
                        key={e.id + a.number}
                        onClick={() => {
                          setSelected(e.id);
                          setTab('Attempts');
                          setNav('Event stream');
                        }}
                      >
                        <RotateCcw size={17} />
                        <span>
                          <strong>{e.type}</strong>
                          <small>
                            {e.id} · attempt {a.number}
                          </small>
                        </span>
                        <Status value={a.code === 200 ? 'delivered' : 'failed'} />
                        <time>{formatTime(a.at)}</time>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  {!state.events.some((e) => e.attempts.some((a) => a.kind === 'replay')) && (
                    <div className="empty-state tall">
                      <RotateCcw size={29} />
                      <h3>The next attempt starts here.</h3>
                      <p>Replay a failed event to see its complete recovery trail.</p>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setNav('Event stream');
                          setFilter('failed');
                        }}
                      >
                        Find a failed event <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </section>
              ) : (
                <section className="content-card settings-page">
                  <h2>Workspace settings</h2>
                  <p>
                    Your browser holds a private workspace token. Keep it safe; it grants access to
                    this sandbox.
                  </p>
                  <div className="settings-row">
                    <div>
                      <strong>Persistence</strong>
                      <span>
                        {mode === 'cloud'
                          ? `Cloud database · revision ${revision}`
                          : 'Explicit local session · not persisted'}
                      </span>
                    </div>
                    <button className="button secondary" onClick={() => void read()}>
                      <RefreshCw size={14} />
                      Reconnect
                    </button>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>Signing secret</strong>
                      <span>Used to verify the exact bytes of inbound requests.</span>
                      <code>{showSecret ? state.secret : 'whsec_••••••••••••••••••••••••'}</code>
                    </div>
                    <button className="button secondary" onClick={() => setShowSecret(!showSecret)}>
                      {showSecret ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>Simulation clock</strong>
                      <span>{new Date(state.clock).toISOString()} · explicit backoff control</span>
                    </div>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void command({ type: 'advance-clock', seconds: 60 })}
                    >
                      <Clock3 size={14} />
                      Advance 60s
                    </button>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>Export event data</strong>
                      <span>Download all retained event payloads and delivery attempts.</span>
                    </div>
                    <button className="button secondary" onClick={download}>
                      <ArrowDownToLine size={14} />
                      Export JSON
                    </button>
                  </div>
                  <div className="settings-row danger-row">
                    <div>
                      <strong>Reset workspace</strong>
                      <span>
                        Replace events with fresh synthetic data and rotate the signing secret.
                      </span>
                    </div>
                    <button className="button danger" onClick={() => setModal('reset')}>
                      <RotateCcw size={14} />
                      Reset sandbox
                    </button>
                  </div>
                </section>
              )}
              <footer className="page-footer">
                <span>
                  <span className="tiny-dot" />
                  {mode === 'cloud' ? 'Cloud connected' : 'Local demo'}
                  <span className="footer-divider">/</span>All systems simulated downstream
                </span>
                <span>
                  Built with intention <span className="footer-divider">·</span>
                  <a href="https://singhtanveer.com" target="_blank" rel="noreferrer">
                    Tanveer Singh <ArrowUpRight size={11} />
                  </a>
                </span>
              </footer>
            </>
          ) : null}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className={'modal ' + (modal === 'setup' ? 'wide' : '')}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setModal(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
            <div className="modal-icon">
              {modal === 'sample' ? (
                <Send size={23} />
              ) : modal === 'setup' ? (
                <Terminal size={23} />
              ) : (
                <RotateCcw size={23} />
              )}
            </div>
            <h2 id="modal-title">
              {modal === 'sample'
                ? 'Send a sample event'
                : modal === 'setup'
                  ? 'Connect your first webhook'
                  : 'Reset this workspace?'}
            </h2>
            {error && (
              <div className="modal-error" role="alert">
                {error}
              </div>
            )}
            {modal === 'sample' ? (
              <>
                <p>
                  Capture a synthetic request through the API and test a deterministic delivery
                  scenario.
                </p>
                <label className="field-label">
                  DELIVERY SCENARIO
                  <select
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value as Scenario)}
                  >
                    <option value="recover">Fails once, recovers on replay</option>
                    <option value="success">Always succeeds · 200 OK</option>
                    <option value="always-fail">Always fails · 503 unavailable</option>
                  </select>
                </label>
                <label className="field-label">
                  JSON PAYLOAD
                  <textarea
                    spellCheck={false}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={invalid}
                    onChange={(e) => setInvalid(e.target.checked)}
                  />
                  Send an invalid signature to test rejection
                </label>
                <button
                  className="button primary modal-submit"
                  onClick={() => void sample()}
                  disabled={busy || !state}
                >
                  {busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}Send
                  sample event
                </button>
              </>
            ) : modal === 'setup' ? (
              <>
                <p>
                  Inbound capture is real. Use your private token and sign the exact JSON body with
                  your workspace secret.
                </p>
                {mode === 'local' && (
                  <div className="inline-warning">
                    Local demo has no HTTP capture. Connect the cloud workspace first.
                  </div>
                )}
                <div className="setup-step">
                  <span>01</span>
                  <div>
                    <strong>Your endpoint</strong>
                    <div className="copy-field">
                      <code>{endpoint}</code>
                      <button onClick={() => copy(endpoint)} aria-label="Copy endpoint URL">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="setup-step">
                  <span>02</span>
                  <div>
                    <strong>Workspace bearer token</strong>
                    <div className="copy-field">
                      <code>{token.slice(0, 10)}••••••••••••••••</code>
                      <button onClick={() => void copyToken()} aria-label="Copy workspace token">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="setup-step">
                  <span>03</span>
                  <div>
                    <strong>Sign and send · Node.js 18+</strong>
                    <p>
                      The example uses a success scenario. Add{' '}
                      <code>X-Delivery-Scenario: recover</code> to simulate recovery.
                    </p>
                    <pre className="setup-code">{`import { createHmac } from 'node:crypto';\n\nconst body = JSON.stringify({ type: 'order.created' });\nconst secret = '${state?.secret || 'YOUR_SIGNING_SECRET'}';\nconst signature = createHmac('sha256', secret)\n  .update(body).digest('hex');\n\nconst response = await fetch('${endpoint}', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'Authorization': 'Bearer YOUR_WORKSPACE_TOKEN',\n    'X-Webhook-Signature': 'sha256=' + signature\n  },\n  body\n});\nconsole.log(await response.json());`}</pre>
                    <button className="button secondary" onClick={() => void copyExample()}>
                      <Copy size={14} />
                      Copy runnable example
                    </button>
                  </div>
                </div>
                <div className="inline-note">
                  <ShieldCheck size={16} />
                  Your token and secret belong to this browser’s isolated sandbox.
                </div>
              </>
            ) : (
              <>
                <p>
                  This replaces all captured events and delivery history with a fresh synthetic
                  dataset. Your signing secret will change.
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
                        setToast('Workspace reset. Signing secret rotated.');
                      }
                    }}
                  >
                    Reset workspace
                  </button>
                </div>
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
    <App />
  </React.StrictMode>,
);
