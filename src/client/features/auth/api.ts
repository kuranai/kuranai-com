export interface AuthSession {
  authenticated: boolean;
  expiresAt?: string;
}

interface ErrorResponse {
  error?: { code?: string; message?: string };
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

async function parseResponse(response: Response) {
  const value = (await response.json().catch(() => null)) as (AuthSession & ErrorResponse) | null;
  if (!response.ok) {
    throw new AuthApiError(
      value?.error?.message ?? 'Authentication is temporarily unavailable.',
      value?.error?.code ?? 'AUTH_FAILED',
      response.status,
    );
  }
  return value as AuthSession;
}

export async function fetchAuthSession() {
  return parseResponse(
    await fetch('/api/auth/session', { headers: { Accept: 'application/json' } }),
  );
}

export async function login(password: string) {
  return parseResponse(
    await fetch('/api/auth/login', {
      body: JSON.stringify({ password }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  );
}

export async function logout() {
  const response = await fetch('/api/auth/logout', {
    headers: { Accept: 'application/json' },
    method: 'POST',
  });
  if (!response.ok) await parseResponse(response);
}
