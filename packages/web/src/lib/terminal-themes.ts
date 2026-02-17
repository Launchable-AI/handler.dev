import type { ITheme } from '@xterm/xterm';

export const DARK_TERMINAL_THEME: ITheme = {
  background: 'hsl(220 20% 6%)',
  foreground: 'hsl(220 10% 85%)',
  cursor: 'hsl(190 90% 60%)',
  cursorAccent: 'hsl(220 20% 6%)',
  selectionBackground: 'hsl(190 90% 60% / 0.3)',
  selectionForeground: '#ffffff',
  black: 'hsl(220 20% 10%)',
  red: 'hsl(0 70% 65%)',
  green: 'hsl(140 60% 55%)',
  yellow: 'hsl(40 80% 55%)',
  blue: 'hsl(210 80% 65%)',
  magenta: 'hsl(280 60% 70%)',
  cyan: 'hsl(180 60% 55%)',
  white: 'hsl(220 10% 85%)',
  brightBlack: 'hsl(220 15% 35%)',
  brightRed: 'hsl(0 80% 70%)',
  brightGreen: 'hsl(140 70% 65%)',
  brightYellow: 'hsl(40 90% 65%)',
  brightBlue: 'hsl(210 90% 75%)',
  brightMagenta: 'hsl(280 70% 80%)',
  brightCyan: 'hsl(180 70% 65%)',
  brightWhite: 'hsl(220 5% 95%)',
};

export const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  cursor: '#0070c0',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(0, 112, 192, 0.2)',
  selectionForeground: '#1e1e1e',
  black: '#1e1e1e',
  red: '#c72e2e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0550ae',
  magenta: '#8250df',
  cyan: '#0e7490',
  white: '#6e7681',
  brightBlack: '#57606a',
  brightRed: '#cf222e',
  brightGreen: '#1a7f37',
  brightYellow: '#9a6700',
  brightBlue: '#0969da',
  brightMagenta: '#8250df',
  brightCyan: '#0891b2',
  brightWhite: '#1e1e1e',
};

export type TerminalThemeMode = 'dark' | 'light' | 'system';

const TERMINAL_THEME_KEY = 'handler-terminal-theme-mode';

export function getStoredTerminalThemeMode(): TerminalThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(TERMINAL_THEME_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  return 'system';
}

export function setStoredTerminalThemeMode(mode: TerminalThemeMode): void {
  localStorage.setItem(TERMINAL_THEME_KEY, mode);
}

export function getTerminalTheme(isDark: boolean): ITheme {
  return isDark ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
}

export function getTerminalBgColor(isDark: boolean): string {
  return isDark ? 'hsl(220 20% 6%)' : '#ffffff';
}
