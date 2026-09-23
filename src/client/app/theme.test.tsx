import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeControl } from './ThemeControl';
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from './theme';

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function ThemeProbe() {
  const { preference, resolvedTheme } = useTheme();
  return (
    <output data-preference={preference} data-resolved-theme={resolvedTheme}>
      {resolvedTheme}
    </output>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, 'matchMedia', originalMatchMediaDescriptor);
  } else {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    });
  }
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('theme preferences', () => {
  it('follows system changes while the system preference is selected', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      matches: true,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByText('dark').getAttribute('data-preference')).toBe('system');

    act(() => {
      for (const listener of listeners) {
        listener({ matches: false } as MediaQueryListEvent);
      }
    });

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByText('light').getAttribute('data-preference')).toBe('system');
  });

  it('persists an explicit selection and restores it in a new provider', () => {
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), {
      target: { value: 'dark' },
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    cleanup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByText('dark').getAttribute('data-preference')).toBe('dark');
  });
});
