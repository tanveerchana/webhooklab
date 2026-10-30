export type Status = 'delivered' | 'failed' | 'rejected';
export type Scenario = 'success' | 'recover' | 'always-fail';
export interface Attempt {
  number: number;
  at: string;
  code: number;
  duration: number;
  reason: string;
  kind: 'initial' | 'replay';
}
export interface WebhookEvent {
  id: string;
  type: string;
  source: string;
  receivedAt: string;
  payload: unknown;
  raw: string;
  status: Status;
  signatureValid: boolean;
  scenario: Scenario;
  attempts: Attempt[];
  nextRetryAt: string | null;
}
export interface Workspace {
  version: 1;
  secret: string;
  clock: string;
  events: WebhookEvent[];
}
function bounded(state: Workspace): Workspace {
  const events = state.events.slice(0, 150);
  while (
    events.length > 1 &&
    new TextEncoder().encode(JSON.stringify({ ...state, events })).length > 450000
  )
    events.pop();
  return { ...state, events };
}
const scenarios: Scenario[] = ['success', 'recover', 'always-fail'];
export function parsePayload(raw: string): unknown {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 65536)
    throw new Error('Payload must be at most 64 KB.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Payload must contain valid JSON.');
  }
}
function makeAttempt(
  scenario: Scenario,
  number: number,
  at: string,
  kind: Attempt['kind'],
): Attempt {
  const success = scenario === 'success' || (scenario === 'recover' && number >= 2);
  return {
    number,
    at,
    kind,
    code: success ? 200 : 503,
    duration: success ? 72 + number * 11 : 302 + number * 17,
    reason: success
      ? 'Accepted by simulated downstream'
      : 'Simulated downstream temporarily unavailable',
  };
}
function retryAt(attempt: Attempt): string | null {
  return attempt.code === 200
    ? null
    : new Date(
        Date.parse(attempt.at) + Math.min(3600, 30 * 2 ** (attempt.number - 1)) * 1000,
      ).toISOString();
}
export function captureEvent(
  state: Workspace,
  raw: string,
  signatureValid: boolean,
  scenario: Scenario = 'success',
  source = 'API',
  receivedAt = new Date().toISOString(),
): Workspace {
  if (!scenarios.includes(scenario)) throw new Error('Unknown delivery scenario.');
  const payload = parsePayload(raw);
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const type = typeof data.type === 'string' ? data.type.slice(0, 80) : 'webhook.received';
  const attempt = signatureValid ? makeAttempt(scenario, 1, state.clock, 'initial') : null;
  const event: WebhookEvent = {
    id: 'evt_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16),
    type,
    source,
    receivedAt,
    payload,
    raw,
    status: !signatureValid ? 'rejected' : attempt?.code === 200 ? 'delivered' : 'failed',
    signatureValid,
    scenario,
    attempts: attempt ? [attempt] : [],
    nextRetryAt: attempt ? retryAt(attempt) : null,
  };
  return bounded({ ...state, events: [event, ...state.events] });
}
export function seedWorkspace(): Workspace {
  const clock = new Date().toISOString();
  const secret =
    'whsec_' +
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  let state: Workspace = { version: 1, secret, clock, events: [] };
  const types = [
    'payment.succeeded',
    'customer.created',
    'invoice.payment_failed',
    'subscription.updated',
    'checkout.completed',
    'invoice.created',
  ];
  for (let i = 27; i >= 0; i--) {
    const time = new Date(Date.parse(clock) - (i * 71 + 120) * 1000).toISOString();
    const type = types[i % types.length];
    const scenario: Scenario = i % 9 === 2 ? 'always-fail' : i % 7 === 0 ? 'recover' : 'success';
    state = captureEvent(
      { ...state, clock: time },
      JSON.stringify({
        id: 'demo_' + String(1038 - i),
        type,
        created: Math.floor(Date.parse(time) / 1000),
        data: {
          object: {
            id: 'obj_' + String(8024 - i),
            amount: [4900, 12900, 2400, 9900][i % 4],
            currency: 'usd',
            customer: 'cus_demo_' + String(203 - i),
            metadata: { environment: 'sandbox', plan: i % 2 ? 'pro' : 'starter' },
          },
        },
      }),
      i !== 8,
      scenario,
      i % 3 === 0 ? 'Linear' : 'Stripe',
      time,
    );
  }
  return { ...state, clock };
}
export function reduceWorkspace(state: Workspace, command: unknown): Workspace {
  if (!command || typeof command !== 'object' || !('type' in command))
    throw new Error('A valid command is required.');
  const c = command as Record<string, unknown>;
  switch (c.type) {
    case 'reset':
      return seedWorkspace();
    case 'advance-clock': {
      if (
        typeof c.seconds !== 'number' ||
        !Number.isInteger(c.seconds) ||
        c.seconds < 1 ||
        c.seconds > 3600
      )
        throw new Error('Clock advance must be between 1 and 3600 seconds.');
      return {
        ...state,
        clock: new Date(Date.parse(state.clock) + c.seconds * 1000).toISOString(),
      };
    }
    case 'sample': {
      if (!scenarios.includes(c.scenario as Scenario))
        throw new Error('Unknown delivery scenario.');
      const raw =
        typeof c.raw === 'string'
          ? c.raw
          : JSON.stringify({
              type: 'invoice.payment_failed',
              data: {
                object: {
                  id: 'in_demo_' + Date.parse(state.clock),
                  amount: 4900,
                  currency: 'usd',
                  customer: 'cus_sandbox',
                  metadata: { environment: 'sandbox' },
                },
              },
            });
      return captureEvent(state, raw, true, c.scenario as Scenario, 'Sample');
    }
    case 'replay': {
      const event = state.events.find((e) => e.id === c.id);
      if (!event) throw new Error('Event not found.');
      if (!event.signatureValid)
        throw new Error('Invalid signature: rejected events cannot be replayed.');
      if (event.attempts.length >= 20)
        throw new Error('Replay limit reached: maximum 20 attempts.');
      if (event.status === 'delivered') throw new Error('Event has already been delivered.');
      if (event.nextRetryAt && Date.parse(state.clock) < Date.parse(event.nextRetryAt))
        throw new Error('Retry backoff is active. Advance the simulation clock first.');
      const attempt = makeAttempt(event.scenario, event.attempts.length + 1, state.clock, 'replay');
      const updated: WebhookEvent = {
        ...event,
        attempts: [...event.attempts, attempt],
        status: attempt.code === 200 ? 'delivered' : 'failed',
        nextRetryAt: retryAt(attempt),
      };
      return bounded({
        ...state,
        events: state.events.map((e) => (e.id === event.id ? updated : e)),
      });
    }
    default:
      throw new Error('Unknown workspace command.');
  }
}
export function filterEvents(
  events: WebhookEvent[],
  status: string,
  query: string,
): WebhookEvent[] {
  const q = query.trim().toLowerCase();
  return events.filter(
    (e) =>
      (status === 'all' || e.status === status) &&
      (!q || `${e.id} ${e.type} ${e.source} ${e.raw}`.toLowerCase().includes(q)),
  );
}
