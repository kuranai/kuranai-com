import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dovari-theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }

  try {
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedPreference) ? storedPreference : 'system';
  } catch {
    return 'system';
  }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return 'light';
}

function applyTheme(theme: ResolvedTheme) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#101411' : '#f5f7f3');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const resolvedTheme = preference === 'system' ? systemTheme : preference;

  useLayoutEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else {
      mediaQuery.addListener?.(handleSystemThemeChange);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) {
        return;
      }

      setPreferenceState(isThemePreference(event.newValue) ? event.newValue : 'system');
    }

    window.addEventListener('storage', handleStorage);

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleSystemThemeChange);
      } else {
        mediaQuery.removeListener?.(handleSystemThemeChange);
      }
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // Private browsing and restricted storage should not disable theme controls.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setPreference]);

  const contextValue = useMemo(
    () => ({ preference, resolvedTheme, setPreference, toggleTheme }),
    [preference, resolvedTheme, setPreference, toggleTheme],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider.');
  }

  return context;
}
