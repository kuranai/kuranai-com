import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SearchResult } from '../../../shared/search';
import { CommandPalette } from './CommandPalette';

const firstPageId = '11111111-1111-4111-8111-111111111111';
const secondPageId = '22222222-2222-4222-8222-222222222222';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function searchResult(id: string, title: string, query: string): SearchResult {
  return {
    breadcrumb: [],
    id,
    isFavorite: false,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    snippet: `Before <mark>${query}</mark> after`,
    tags: [],
    title,
    url: `/app/pages/${id}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function renderPalette(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  return render(
    <CommandPalette
      canCreatePage
      isCreating={false}
      onClose={vi.fn()}
      onCreatePage={vi.fn()}
      onOpenPage={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CommandPalette', () => {
  it('debounces search, renders marked snippets safely, and opens the active result', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ results: [searchResult(firstPageId, 'Alpha page', 'alpha')] }));
    const onClose = vi.fn();
    const onOpenPage = vi.fn();

    renderPalette({ onClose, onOpenPage });
    const input = screen.getByRole('searchbox');

    fireEvent.change(input, { target: { value: 'alpha' } });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByRole('option', { name: /Alpha page/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/private/search?q=alpha',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText('alpha', { selector: 'mark' })).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpenPage).toHaveBeenCalledWith(`/app/pages/${firstPageId}`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale response after a newer query has started', async () => {
    vi.useFakeTimers();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      return String(input).includes('first') ? first.promise : second.promise;
    });

    renderPalette();
    const input = screen.getByRole('searchbox');

    fireEvent.change(input, { target: { value: 'first' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: 'second' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(response({ results: [searchResult(secondPageId, 'Second page', 'second')] }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('option', { name: /Second page/ })).toBeTruthy();

    await act(async () => {
      first.resolve(response({ results: [searchResult(firstPageId, 'First page', 'first')] }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('option', { name: /First page/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Second page/ })).toBeTruthy();
  });

  it('exposes template and daily-note actions from the keyboard palette', () => {
    const onClose = vi.fn();
    const onOpenPage = vi.fn();
    const onOpenDailyNote = vi.fn();
    renderPalette({ onClose, onOpenDailyNote, onOpenPage });

    fireEvent.click(screen.getByRole('option', { name: /Create from template/ }));
    expect(onOpenPage).toHaveBeenCalledWith('/app/settings/templates');

    fireEvent.click(screen.getByRole('option', { name: /Open today’s note/ }));
    expect(onOpenDailyNote).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
