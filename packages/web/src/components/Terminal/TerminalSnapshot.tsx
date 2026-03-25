/**
 * TerminalSnapshot — Read-only terminal preview using captured ANSI output.
 * Renders tmux capture-pane output in a disconnected xterm instance.
 * No WebSocket, no resize messages, no tmux client attachment.
 */

import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { getTerminalTheme, getTerminalBgColor, getStoredTerminalThemeMode } from '../../lib/terminal-themes';
import { useTheme } from '../../hooks/useTheme';

interface TerminalSnapshotProps {
  /** ANSI-escaped terminal content to render */
  content: string | null;
  fontSize?: number;
  className?: string;
}

export function TerminalSnapshot({ content, fontSize = 6, className = '' }: TerminalSnapshotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const isDisposedRef = useRef(false);
  const { isDark: systemIsDark } = useTheme();
  const themeMode = getStoredTerminalThemeMode();
  const isDark = themeMode === 'system' ? systemIsDark : themeMode === 'dark';

  // Create xterm — delayed by a tick to survive React strict mode's
  // immediate unmount (prevents "Cannot read properties of undefined
  // (reading 'dimensions')" from xterm's internal Viewport setTimeout)
  useEffect(() => {
    if (!containerRef.current) return;
    isDisposedRef.current = false;

    const initTimeout = setTimeout(() => {
      if (isDisposedRef.current || !containerRef.current) return;

      const term = new XTerm({
        cursorBlink: false,
        cursorStyle: 'underline',
        disableStdin: true,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize,
        lineHeight: 1.2,
        theme: getTerminalTheme(isDark),
        scrollback: 0,
        convertEol: true,
      });

      term.open(containerRef.current!);
      termRef.current = term;
    }, 0);

    return () => {
      isDisposedRef.current = true;
      clearTimeout(initTimeout);
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
    };
  }, [fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write content when it changes
  useEffect(() => {
    const term = termRef.current;
    if (!term || !content) return;

    term.reset();
    term.write(content);
  }, [content]);

  // Update theme
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getTerminalTheme(isDark);
    }
  }, [isDark]);

  return (
    <div
      ref={containerRef}
      className={`${className} [&_.xterm-viewport]:!overflow-hidden`}
      style={{ backgroundColor: getTerminalBgColor(isDark) }}
    />
  );
}
