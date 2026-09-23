import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '../../../shared/backup';
import { createZipStream, textZipEntry } from '../../../worker/export/zip';
import type { WorkspaceOutletContext } from '../../app/App';
import { BackupRestorePage } from './BackupRestorePage';

async function emptyBackupFile() {
  const manifest = {
    assets: [],
    exportedAt: '2026-09-13T00:00:00.000Z',
    format: 'dovari-backup',
    pages: [],
    revisions: [],
    version: 1,
  } as const;
  const stream = createZipStream([textZipEntry('backup.json', `${canonicalJson(manifest)}\n`)]);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new File([bytes.buffer as ArrayBuffer], 'dovari-backup-v1.zip');
}

function renderBackupPage(refreshPages = vi.fn()) {
  const context = { refreshPages } as unknown as WorkspaceOutletContext;
  return render(
    <MemoryRouter initialEntries={['/app/settings/backup']}>
      <Routes>
        <Route element={<Outlet context={context} />} path="/app">
          <Route element={<BackupRestorePage />} path="settings/backup" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem('dovari-restore-session');
});

describe('BackupRestorePage', () => {
  it('validates a selected archive and shows its lossless contents', async () => {
    renderBackupPage();
    const file = await emptyBackupFile();
    fireEvent.change(screen.getByLabelText('Select a Dovari backup ZIP (v1 or v2)'), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('heading', { name: 'Validated backup' })).toBeTruthy();
    expect(screen.getByText('Asset data')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Start restore' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('uploads and finalizes an empty validated backup with a visible result', async () => {
    const refreshPages = vi.fn().mockResolvedValue(undefined);
    const sessionId = '44444444-4444-4444-8444-444444444444';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/private/restore/sessions' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            session: {
              assetIds: [],
              backupVersion: 1,
              createdAt: '2026-09-13T00:00:00.000Z',
              expectedAssets: 0,
              expectedBytes: 0,
              expectedPages: 0,
              expectedRevisions: 0,
              expiresAt: '2026-09-14T00:00:00.000Z',
              id: sessionId,
              pageIds: [],
              receivedAssets: 0,
              receivedBytes: 0,
              receivedPages: 0,
              receivedRevisions: 0,
              revisionIds: [],
              status: 'uploading',
              updatedAt: '2026-09-13T00:00:00.000Z',
            },
          }),
          { status: 201 },
        );
      }
      if (url === `/api/private/restore/sessions/${sessionId}/finalize`) {
        return new Response(
          JSON.stringify({ assetCount: 0, pageCount: 0, restored: true, revisionCount: 0 }),
        );
      }
      throw new Error(`Unexpected request: ${String(init?.method)} ${url}`);
    });

    renderBackupPage(refreshPages);
    fireEvent.change(screen.getByLabelText('Select a Dovari backup ZIP (v1 or v2)'), {
      target: { files: [await emptyBackupFile()] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Start restore' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Restored 0 pages'),
    );
    expect(refreshPages).toHaveBeenCalledTimes(1);
  });
});
