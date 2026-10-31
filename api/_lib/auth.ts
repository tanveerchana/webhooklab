import type { WorkspaceRequest, WorkspaceResponse } from './workspace.js';
import {
  ApiError,
  enforceMutationOrigin,
  header,
  readJson,
  sendApiError,
  sendJson,
  UUID,
} from './account-http.js';
export type AccountUser = { id: string; email: string };
export type AccountSession = { user: AccountUser; accessToken: string };
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};
const APPS = new Set(['webhooklab', 'fieldpilot', 'payroute']);
const COOKIE_VALUE = /^[A-Za-z0-9._~-]{1,3800}$/;
export function supabaseConfig(): { url: string; key: string } {
  let url: URL;
  try {
    url = new URL(process.env.SUPABASE_URL ?? '');
  } catch {
    throw new ApiError(503, 'Account services are not configured.');
  }
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !key ||
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) ||
    key.length > 512
  )
    throw new ApiError(503, 'Account services are not configured.');
  return { url: url.origin, key };
}
/** Only static server-selected paths may be passed. Provider bodies never enter public errors. */
export async function supabaseRequest(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<{ status: number; data: any }> {
  const { url, key } = supabaseConfig();
  try {
    const response = await fetch(url + path, {
      method: options.method ?? 'GET',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    let data: unknown = null;
    if (response.status !== 204) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1048576) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder().decode(joined);
      data = text ? JSON.parse(text) : null;
    }
    return { status: response.status, data };
  } catch {
    throw new ApiError(503, 'Account services are temporarily unavailable. Please try again.');
  }
}
function cookieNames(app: string) {
  if (!APPS.has(app)) throw new ApiError(503, 'Account services are not configured.');
  return {
    access: `__Host-portfolio_${app}_access`,
    refresh: `__Host-portfolio_${app}_refresh`,
  };
}
function cookieValue(req: WorkspaceRequest, name: string): string | undefined {
  const raw = header(req, 'cookie');
  if (!raw || raw.length > 16384) return undefined;
  const found = raw
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(name + '='));
  if (found.length !== 1) return undefined;
  const value = found[0].slice(name.length + 1);
  return COOKIE_VALUE.test(value) ? value : undefined;
}
function setCookies(res: WorkspaceResponse, app: string, tokens?: Tokens): void {
  const names = cookieNames(app);
  const suffix = '; Path=/; HttpOnly; Secure; SameSite=Lax';
  res.setHeader(
    'Set-Cookie',
    tokens
      ? [
          `${names.access}=${tokens.access_token}; Max-Age=${Math.min(86400, Math.max(60, Math.floor(tokens.expires_in ?? 3600)))}${suffix}`,
          `${names.refresh}=${tokens.refresh_token}; Max-Age=604800${suffix}`,
        ]
      : [`${names.access}=; Max-Age=0${suffix}`, `${names.refresh}=; Max-Age=0${suffix}`],
  );
}
function tokenResponse(value: any): Tokens | undefined {
  return value &&
    typeof value.access_token === 'string' &&
    typeof value.refresh_token === 'string' &&
    COOKIE_VALUE.test(value.access_token) &&
    COOKIE_VALUE.test(value.refresh_token) &&
    (value.expires_in === undefined ||
      (typeof value.expires_in === 'number' &&
        Number.isFinite(value.expires_in) &&
        value.expires_in > 0))
    ? value
    : undefined;
}
function upstreamFailure(
  status: number,
  kind: 'login' | 'signup' | 'session' = 'session',
  data?: any,
): never {
  if (status === 429)
    throw new ApiError(429, 'Too many attempts. Wait a few minutes before trying again.');
  if (status >= 500)
    throw new ApiError(503, 'Account services are temporarily unavailable. Please try again.');
  if (kind === 'login' && data?.code === 'email_not_confirmed')
    throw new ApiError(403, 'Confirm your email before signing in.');
  if (kind === 'login') throw new ApiError(401, 'Email or password was not accepted.');
  if (kind === 'signup')
    throw new ApiError(
      400,
      'Unable to create an account. Check your email and password, or try signing in.',
    );
  throw new ApiError(401, 'Sign in again to continue.');
}
async function verifiedUser(accessToken: string): Promise<AccountUser | undefined> {
  const reply = await supabaseRequest('/auth/v1/user', { accessToken });
  if (reply.status === 401 || reply.status === 403) return undefined;
  if (reply.status !== 200) upstreamFailure(reply.status);
  const value = reply.data;
  if (!value || !UUID.test(value.id) || typeof value.email !== 'string' || value.email.length > 254)
    throw new ApiError(503, 'Account services returned an invalid session.');
  return { id: value.id, email: value.email };
}
export async function getAccountSession(
  app: string,
  req: WorkspaceRequest,
  res: WorkspaceResponse,
): Promise<AccountSession | null> {
  const names = cookieNames(app);
  const access = cookieValue(req, names.access),
    refresh = cookieValue(req, names.refresh);
  if (access) {
    const user = await verifiedUser(access);
    if (user) return { user, accessToken: access };
  }
  if (refresh) {
    const reply = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: refresh },
    });
    if (reply.status === 200) {
      const tokens = tokenResponse(reply.data);
      if (!tokens) throw new ApiError(503, 'Account services returned an invalid session.');
      const user = await verifiedUser(tokens.access_token);
      if (user) {
        setCookies(res, app, tokens);
        return { user, accessToken: tokens.access_token };
      }
    } else if (reply.status !== 400 && reply.status !== 401 && reply.status !== 403)
      upstreamFailure(reply.status);
  }
  if (access || refresh) setCookies(res, app);
  return null;
}
export async function requireAccountSession(
  app: string,
  req: WorkspaceRequest,
  res: WorkspaceResponse,
): Promise<AccountSession> {
  const session = await getAccountSession(app, req, res);
  if (!session) throw new ApiError(401, 'Sign in to open this workspace.');
  return session;
}
export function createAuthHandler(app: string) {
  return async function authHandler(req: WorkspaceRequest, res: WorkspaceResponse): Promise<void> {
    try {
      if (req.method === 'GET') {
        const session = await getAccountSession(app, req, res);
        sendJson(res, 200, { user: session?.user ?? null });
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new ApiError(405, 'Method not allowed.');
      }
      enforceMutationOrigin(req);
      const body = await readJson(req, 8192);
      if (body.action === 'logout') {
        try {
          const session = await getAccountSession(app, req, res);
          if (session) {
            const reply = await supabaseRequest('/auth/v1/logout?scope=local', {
              method: 'POST',
              accessToken: session.accessToken,
            });
            if (reply.status !== 204 && reply.status !== 200 && reply.status !== 401)
              upstreamFailure(reply.status);
          }
        } finally {
          setCookies(res, app);
        }
        sendJson(res, 200, { user: null });
        return;
      }
      if (body.action !== 'login' && body.action !== 'signup')
        throw new ApiError(400, 'Choose sign in, sign up, or sign out.');
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = body.password;
      if (
        !email ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' ||
        password.length < (body.action === 'signup' ? 12 : 1) ||
        password.length > 128
      )
        throw new ApiError(
          400,
          body.action === 'signup'
            ? 'Enter a valid email and a password of 12–128 characters.'
            : 'Enter a valid email and password.',
        );
      const reply = await supabaseRequest(
        body.action === 'login' ? '/auth/v1/token?grant_type=password' : '/auth/v1/signup',
        { method: 'POST', body: { email, password } },
      );
      if (reply.status < 200 || reply.status >= 300)
        upstreamFailure(reply.status, body.action, reply.data);
      const tokens = tokenResponse(reply.data);
      if (body.action === 'signup' && !tokens) {
        sendJson(res, 200, { user: null, confirmationRequired: true });
        return;
      }
      if (!tokens) throw new ApiError(503, 'Account services returned an invalid session.');
      const user = await verifiedUser(tokens.access_token);
      if (!user) throw new ApiError(401, 'Sign in again to continue.');
      setCookies(res, app, tokens);
      sendJson(res, 200, {
        user,
        ...(body.action === 'signup' ? { confirmationRequired: false } : {}),
      });
    } catch (error) {
      sendApiError(res, error);
    }
  };
}
