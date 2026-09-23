import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

import type { WorkspaceOutletContext } from '../../app/App';
import { ThemeProvider } from '../../app/theme';
import { SettingsPage } from './SettingsPage';

function renderSettings() {
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/app/settings']}>
        <Routes>
          <Route
            element={<Outlet context={{ pages: [] } as unknown as WorkspaceOutletContext} />}
            path="/app"
          >
            <Route element={<SettingsPage />} path="settings" />
          </Route>
          <Route element={<h1>Signed out</h1>} path="/login" />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage owner access', () => {
  it('ends the session and navigates to login', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Signed out' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      headers: { Accept: 'application/json' },
      method: 'POST',
    });
  });

  it('keeps a retryable error visible when logout fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'AUTH_FAILED', message: 'Unavailable' } }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }),
    );
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toContain('could not sign you out');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
