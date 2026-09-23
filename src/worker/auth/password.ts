const SESSION_COOKIE = '__Host-dovari_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const MAX_PASSWORD_BYTES = 256;

export type AuthIdentity = { kind: 'password'; subject: 'owner' };

export type AuthAuthorizationFailure =
  | { code: 'SETUP_REQUIRED'; message: 'Authentication is not configured.'; status: 503 }
  | { code: 'AUTH_REQUIRED'; message: 'Authentication is required.'; status: 401 }
  | { code: 'AUTH_INVALID'; message: 'Authentication session is invalid.'; status: 401 };

export type AuthAuthorizationResult =
  | { ok: true; identity: AuthIdentity; expiresAt: number }
  | ({ ok: false } & AuthAuthorizationFailure);

interface AuthEnvironment {
  DB: D1Database;
  DOVARI_PASSWORD?: string;
  CF_VERSION_METADATA?: { id?: string };
}

interface AuthConfiguration {
  password: string;
  workerVersion: string;
}

interface LoginAttemptRow {
  failure_count: number;
  window_started_at: number;
}

const encoder = new TextEncoder();

function configuredAuth(env: AuthEnvironment): AuthConfiguration | null {
  const password = env.DOVARI_PASSWORD;
  const workerVersion = env.CF_VERSION_METADATA?.id;
  if (
    typeof password !== 'string' ||
    encoder.encode(password).byteLength > MAX_PASSWORD_BYTES ||
    typeof workerVersion !== 'string' ||
    workerVersion.length === 0
  ) {
    return null;
  }

  return { password, workerVersion };
}

function base64Url(bytes: Uint8Array) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function sha256Hex(value: string) {
  return [...(await sha256(value))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function equalPassword(candidate: string, expected: string) {
  const [candidateHash, expectedHash] = await Promise.all([sha256(candidate), sha256(expected)]);
  let difference = candidateHash.byteLength ^ expectedHash.byteLength;
  for (let index = 0; index < expectedHash.byteLength; index += 1) {
    difference |= candidateHash[index] ^ expectedHash[index];
  }
  return difference === 0;
}

function cookieValue(request: Request) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_TTL_MS / 1000) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export function expiredSessionCookie() {
  return sessionCookie('', 0);
}

export async function authorizePasswordRequest(
  request: Request,
  env: AuthEnvironment,
): Promise<AuthAuthorizationResult> {
  const configuration = configuredAuth(env);
  if (!configuration) {
    return {
      code: 'SETUP_REQUIRED',
      message: 'Authentication is not configured.',
      ok: false,
      status: 503,
    };
  }

  const token = cookieValue(request);
  if (!token) {
    return {
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required.',
      ok: false,
      status: 401,
    };
  }

  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const session = await env.DB.prepare(
    `SELECT expires_at
     FROM auth_sessions
     WHERE token_hash = ? AND worker_version = ? AND expires_at > ?`,
  )
    .bind(tokenHash, configuration.workerVersion, now)
    .first<{ expires_at: number }>();

  if (!session) {
    return {
      code: 'AUTH_INVALID',
      message: 'Authentication session is invalid.',
      ok: false,
      status: 401,
    };
  }

  return {
    expiresAt: session.expires_at,
    identity: { kind: 'password', subject: 'owner' },
    ok: true,
  };
}

async function sourceHash(request: Request) {
  return sha256Hex(request.headers.get('CF-Connecting-IP') ?? 'unknown-source');
}

export async function loginWithPassword(
  request: Request,
  env: AuthEnvironment,
  candidate: string,
): Promise<
  | { ok: true; token: string; expiresAt: number }
  | {
      ok: false;
      code: 'SETUP_REQUIRED' | 'AUTH_INVALID' | 'AUTH_RATE_LIMITED';
      retryAfter?: number;
    }
> {
  const configuration = configuredAuth(env);
  if (!configuration) return { code: 'SETUP_REQUIRED', ok: false };

  const now = Date.now();
  const key = await sourceHash(request);
  const attempt = await env.DB.prepare(
    'SELECT window_started_at, failure_count FROM auth_login_attempts WHERE source_hash = ?',
  )
    .bind(key)
    .first<LoginAttemptRow>();

  if (
    attempt &&
    attempt.window_started_at + LOGIN_WINDOW_MS > now &&
    attempt.failure_count >= MAX_LOGIN_FAILURES
  ) {
    return {
      code: 'AUTH_RATE_LIMITED',
      ok: false,
      retryAfter: Math.max(
        1,
        Math.ceil((attempt.window_started_at + LOGIN_WINDOW_MS - now) / 1000),
      ),
    };
  }

  const validInput =
    [...candidate].length <= MAX_PASSWORD_BYTES &&
    encoder.encode(candidate).byteLength <= MAX_PASSWORD_BYTES;
  const passwordMatches = await equalPassword(candidate, configuration.password);
  const matches = validInput && passwordMatches;
  if (!matches) {
    const resetBefore = now - LOGIN_WINDOW_MS;
    await env.DB.prepare(
      `INSERT INTO auth_login_attempts (source_hash, window_started_at, failure_count)
       VALUES (?, ?, 1)
       ON CONFLICT(source_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN auth_login_attempts.window_started_at <= ? THEN excluded.window_started_at
           ELSE auth_login_attempts.window_started_at
         END,
         failure_count = CASE
           WHEN auth_login_attempts.window_started_at <= ? THEN 1
           ELSE auth_login_attempts.failure_count + 1
         END`,
    )
      .bind(key, now, resetBefore, resetBefore)
      .run();
    return { code: 'AUTH_INVALID', ok: false };
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(bytes);
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + SESSION_TTL_MS;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_login_attempts WHERE source_hash = ?').bind(key),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR worker_version <> ?').bind(
      now,
      configuration.workerVersion,
    ),
    env.DB.prepare(
      `INSERT INTO auth_sessions (token_hash, worker_version, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
    ).bind(tokenHash, configuration.workerVersion, now, expiresAt),
  ]);

  return { expiresAt, ok: true, token };
}

export async function logoutPasswordSession(request: Request, env: AuthEnvironment) {
  const token = cookieValue(request);
  if (!token) return;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .run();
}
