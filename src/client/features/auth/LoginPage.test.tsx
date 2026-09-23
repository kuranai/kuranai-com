import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from './LoginPage';

function Location() {
  return <output aria-label="Current location">{useLocation().pathname}</output>;
}

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<LoginPage />} path="/login" />
        <Route element={<Location />} path="*" />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('signs in and returns to a validated private destination', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: false }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: true, expiresAt: '2026-10-14T00:00:00Z' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderLogin('/login?next=%2Fapp%2Fpages%2Fpage-1%3Fhistory%3D1');

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'private password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByLabelText('Current location')).textContent).toBe(
      '/app/pages/page-1',
    );
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/login', {
      body: JSON.stringify({ password: 'private password' }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });
  });

  it('rejects external next targets and reports an incorrect password accessibly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authenticated: false }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Authentication failed.' } }),
          { headers: { 'Content-Type': 'application/json' }, status: 401 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderLogin('/login?next=https%3A%2F%2Fevil.example%2Fsteal');

    const password = screen.getByLabelText('Password');
    fireEvent.change(password, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'That password is not correct.',
    );
    await waitFor(() => expect(document.activeElement).toBe(password));
    expect((password as HTMLInputElement).value).toBe('');
  });

  it('shows a concrete setup error when the required secret is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'SETUP_REQUIRED', message: 'Authentication is not configured.' },
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 },
        ),
      ),
    );
    renderLogin();

    expect((await screen.findByRole('alert')).textContent).toContain('Set DOVARI_PASSWORD');
  });
});
