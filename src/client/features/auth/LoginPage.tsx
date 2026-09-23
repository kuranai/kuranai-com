import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { AuthApiError, fetchAuthSession, login } from './api';

function safeNext(value: string | null) {
  if (!value) return '/app';
  try {
    const parsed = new URL(value, window.location.origin);
    if (
      parsed.origin === window.location.origin &&
      (parsed.pathname === '/app' || parsed.pathname.startsWith('/app/'))
    ) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Fall through to the private app root.
  }
  return '/app';
}

function errorMessage(error: unknown) {
  if (error instanceof AuthApiError) {
    if (error.code === 'SETUP_REQUIRED') {
      return 'Dovari is not configured yet. Set DOVARI_PASSWORD in the Worker secrets and deploy again.';
    }
    if (error.code === 'AUTH_RATE_LIMITED') {
      return 'Too many attempts. Wait 15 minutes before trying again.';
    }
    if (error.code === 'AUTH_INVALID') return 'That password is not correct.';
    return error.message;
  }
  return 'Dovari could not sign you in. Check your connection and try again.';
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const destination = safeNext(searchParams.get('next'));
  const passwordRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAuthSession()
      .then((session) => {
        if (active && session.authenticated) navigate(destination, { replace: true });
      })
      .catch((cause: unknown) => {
        if (active && cause instanceof AuthApiError && cause.code === 'SETUP_REQUIRED') {
          setError(errorMessage(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [destination, navigate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await login(password);
      navigate(destination, { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
      setPassword('');
      requestAnimationFrame(() => passwordRef.current?.focus());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="login-panel">
        <div aria-hidden="true" className="login-brand-mark">
          D
        </div>
        <span className="state-kicker">Your knowledge. Your cloud.</span>
        <h1 id="login-title">Sign in to Dovari</h1>
        <p>Enter the private password chosen when this Dovari instance was deployed.</p>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="dovari-password">Password</label>
          <input
            autoComplete="current-password"
            autoFocus
            disabled={isSubmitting}
            id="dovari-password"
            onChange={(event) => setPassword(event.target.value)}
            ref={passwordRef}
            required
            type="password"
            value={password}
          />
          {error ? (
            <p aria-live="assertive" className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="button button-primary" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
