import type { Theme } from '@gestion/contracts';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { call } from './api';

interface ThemeState {
  theme: Theme;
  error: string | null;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset['theme'] = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setCurrent] = useState<Theme>('system');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('settings.getTheme', undefined)
      .then((saved) => {
        setCurrent(saved);
        applyTheme(saved);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setError(null);
    call('settings.setTheme', { theme: next })
      .then((saved) => {
        setCurrent(saved);
        applyTheme(saved);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  return <ThemeContext.Provider value={{ theme, error, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error('ThemeProvider manquant');
  return state;
}
