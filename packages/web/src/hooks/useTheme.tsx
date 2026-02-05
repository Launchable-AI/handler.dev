import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

export type Theme = 'terminal' | 'midnight' | 'handler' | 'ember' | 'void' | 'blueprint' | 'paper' | 'daylight' | 'sand' | 'frost';

export interface ThemeConfig {
  id: Theme;
  name: string;
  mode: 'dark' | 'light';
  description: string;
}

export const THEMES: ThemeConfig[] = [
  { id: 'handler',   name: 'Handler',    mode: 'dark',  description: 'Covert ops, gold/amber accents' },
  { id: 'terminal',  name: 'Terminal',   mode: 'dark',  description: 'Industrial control panel, cyan accents' },
  { id: 'midnight',  name: 'Midnight',   mode: 'dark',  description: 'Deep navy with blue accents' },
  { id: 'ember',     name: 'Ember',      mode: 'dark',  description: 'Warm dark, red/orange accents' },
  { id: 'void',      name: 'Void',       mode: 'dark',  description: 'Ultra-minimal, desaturated' },
  { id: 'blueprint', name: 'Blueprint',  mode: 'light', description: 'Engineering blueprint, warm paper' },
  { id: 'paper',     name: 'Paper',      mode: 'light', description: 'Clean white/gray, professional' },
  { id: 'daylight',  name: 'Daylight',   mode: 'light', description: 'Bright with sky-blue tones' },
  { id: 'sand',      name: 'Sand',       mode: 'light', description: 'Warm desert/sandstone palette' },
  { id: 'frost',     name: 'Frost',      mode: 'light', description: 'Cool icy light, slate/ice-blue' },
];

export const DARK_THEMES = THEMES.filter(t => t.mode === 'dark');
export const LIGHT_THEMES = THEMES.filter(t => t.mode === 'light');

const STORAGE_KEY = 'handler-theme';
const PREFERRED_DARK_KEY = 'handler-preferred-dark';
const PREFERRED_LIGHT_KEY = 'handler-preferred-light';

const DEFAULT_DARK: Theme = 'handler';
const DEFAULT_LIGHT: Theme = 'blueprint';

function isValidTheme(id: string | null): id is Theme {
  return id !== null && THEMES.some(t => t.id === id);
}

function getThemeMode(id: Theme): 'dark' | 'light' {
  return THEMES.find(t => t.id === id)!.mode;
}

function getStoredPreferred(key: string, fallback: Theme): Theme {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return isValidTheme(stored) ? stored : fallback;
}

function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidTheme(stored)) {
      return stored;
    }

    // Check system preference
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return getStoredPreferred(PREFERRED_LIGHT_KEY, DEFAULT_LIGHT);
    }
  }

  return getStoredPreferred(PREFERRED_DARK_KEY, DEFAULT_DARK);
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  themes: ThemeConfig[];
  currentThemeConfig: ThemeConfig;
  isDark: boolean;
  preferredDark: Theme;
  preferredLight: Theme;
  setPreferredDark: (id: Theme) => void;
  setPreferredLight: (id: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [preferredDark, setPreferredDarkState] = useState<Theme>(
    () => getStoredPreferred(PREFERRED_DARK_KEY, DEFAULT_DARK)
  );
  const [preferredLight, setPreferredLightState] = useState<Theme>(
    () => getStoredPreferred(PREFERRED_LIGHT_KEY, DEFAULT_LIGHT)
  );

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

    const handleChange = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setThemeState(e.matches ? preferredLight : preferredDark);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [preferredDark, preferredLight]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const currentThemeConfig = THEMES.find(t => t.id === theme) || THEMES[0];
  const isDark = currentThemeConfig.mode === 'dark';

  const toggleTheme = useCallback(() => {
    setThemeState(current => {
      const currentMode = getThemeMode(current);
      if (currentMode === 'dark') {
        return getStoredPreferred(PREFERRED_LIGHT_KEY, DEFAULT_LIGHT);
      } else {
        return getStoredPreferred(PREFERRED_DARK_KEY, DEFAULT_DARK);
      }
    });
  }, []);

  const setPreferredDark = useCallback((id: Theme) => {
    setPreferredDarkState(id);
    localStorage.setItem(PREFERRED_DARK_KEY, id);
    setThemeState(id);
  }, []);

  const setPreferredLight = useCallback((id: Theme) => {
    setPreferredLightState(id);
    localStorage.setItem(PREFERRED_LIGHT_KEY, id);
    setThemeState(id);
  }, []);

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme,
    themes: THEMES,
    currentThemeConfig,
    isDark,
    preferredDark,
    preferredLight,
    setPreferredDark,
    setPreferredLight,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
