import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Loader2, Copy, Check, RefreshCw } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { ShellPromptTheme } from '../../lib/prompt-themes';
import { getTerminalTheme, getTerminalBgColor, getStoredTerminalThemeMode, type TerminalThemeMode } from '../../lib/terminal-themes';
import { useTheme } from '../../hooks/useTheme';

// Connection state type
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';

export interface TerminalTarget {
  type: 'vm' | 'container';
  id: string;
  ip?: string;
  /** Override the working directory for the shell session */
  workdir?: string;
}

export interface ShellState {
  cwd: string;
  branch: string;
  claudeStatus?: 'processing' | 'idle' | 'waiting' | 'off';
}

export interface TerminalInstanceProps {
  target: TerminalTarget;
  onStateChange?: (state: ConnectionState, errorMessage?: string) => void;
  onTmuxStateChange?: (tmuxState: 'connected' | 'detached' | 'unavailable') => void;
  onShellState?: (state: ShellState) => void;
  onUrlsDetected?: (urls: string[]) => void;
  showStatusBar?: boolean;
  className?: string;
  fontSize?: number;
}

// Session storage key prefix
const SESSION_STORAGE_KEY = 'handler-terminal-session-';

export function TerminalInstance({
  target,
  onStateChange,
  onTmuxStateChange,
  onShellState,
  onUrlsDetected,
  showStatusBar = true,
  className = '',
  fontSize = 13,
}: TerminalInstanceProps) {
  const { isDark: systemIsDark } = useTheme();
  const [terminalThemeMode, setTerminalThemeMode] = useState<TerminalThemeMode>(getStoredTerminalThemeMode);
  const terminalIsDark = terminalThemeMode === 'system' ? systemIsDark : terminalThemeMode === 'dark';

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isTmuxSession, setIsTmuxSession] = useState(false);
  const [detectedUrls, setDetectedUrls] = useState<Array<{ url: string }>>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const terminalIsDarkRef = useRef(terminalIsDark);
  terminalIsDarkRef.current = terminalIsDark;

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isDisposedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const getWsUrl = useCallback(() => {
    const apiPort = (window as unknown as { __API_PORT__?: number }).__API_PORT__ || 4001;
    const hostname = window.location.hostname || 'localhost';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${hostname}:${apiPort}/ws/terminal`;
  }, []);

  // Stable callback refs to avoid re-running effect
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onTmuxStateChangeRef = useRef(onTmuxStateChange);
  onTmuxStateChangeRef.current = onTmuxStateChange;
  const onShellStateRef = useRef(onShellState);
  onShellStateRef.current = onShellState;
  const onUrlsDetectedRef = useRef(onUrlsDetected);
  onUrlsDetectedRef.current = onUrlsDetected;

  const updateState = useCallback((state: ConnectionState, error?: string) => {
    setConnectionState(state);
    setErrorMessage(error);
    onStateChangeRef.current?.(state, error);
  }, []);

  // Session ID ref for reconnection
  const sessionIdRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 2000;

  // Get storage key for this target
  const getStorageKey = useCallback(() => {
    return `${SESSION_STORAGE_KEY}${target.type}-${target.id}`;
  }, [target.type, target.id]);

  // Save session to localStorage
  const saveSession = useCallback((sessionId: string) => {
    try {
      localStorage.setItem(getStorageKey(), sessionId);
      sessionIdRef.current = sessionId;
    } catch {
      // localStorage may be unavailable
    }
  }, [getStorageKey]);

  // Get saved session from localStorage
  const getSavedSession = useCallback((): string | null => {
    try {
      return localStorage.getItem(getStorageKey());
    } catch {
      return null;
    }
  }, [getStorageKey]);

  // Clear saved session
  const clearSavedSession = useCallback(() => {
    try {
      localStorage.removeItem(getStorageKey());
      sessionIdRef.current = null;
    } catch {
      // Ignore
    }
  }, [getStorageKey]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const containerEl = terminalRef.current;
    isDisposedRef.current = false;

    // Delay creation by a tick to survive React strict mode's immediate
    // unmount cycle. Without this, xterm's internal Viewport setTimeout
    // fires after disposal → "Cannot read properties of undefined (reading 'dimensions')".
    const initTimeout = setTimeout(() => init(), 0);

    function init() {
    if (isDisposedRef.current) return;

    // Create terminal instance with theme matching the terminal theme mode
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize,
      lineHeight: 1.2,
      theme: getTerminalTheme(terminalIsDarkRef.current),
      allowProposedApi: true,
    });

    // Add fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Web links addon - underline detection only, no click handler
    const webLinksAddon = new WebLinksAddon((_event, _uri) => {});
    term.loadAddon(webLinksAddon);

    // Open terminal
    term.open(containerEl);
    xtermRef.current = term;

    // Register OSC 7337 handler for real-time cwd/branch tracking from shell
    const oscDisposable = term.parser.registerOscHandler(7337, (data) => {
      try {
        const state = JSON.parse(data) as ShellState;
        onShellStateRef.current?.(state);
      } catch {
        // Ignore malformed OSC data
      }
      return true; // Suppress display
    });

    // Scan visible buffer for URLs. Lines are joined without separators so that
    // URLs broken across line boundaries (by the program, not terminal wrapping)
    // are reassembled. Since URLs can't contain spaces, this is safe.
    const URL_SCAN_RE = /https?:\/\/[^\s)\]}>,"'`\x1b]+/g;
    let scanTimeout: ReturnType<typeof setTimeout> | null = null;
    const scanUrlsDebounced = () => {
      if (scanTimeout) clearTimeout(scanTimeout);
      scanTimeout = setTimeout(() => {
        if (isDisposedRef.current) return;
        const buf = term.buffer.active;
        const viewportTop = buf.viewportY;
        // Join all visible lines with no separator — URL fragments on adjacent
        // lines will concatenate, and the \S+ in the regex handles the rest.
        let combined = '';
        for (let i = 0; i < term.rows; i++) {
          const line = buf.getLine(viewportTop + i);
          if (!line) continue;
          combined += line.translateToString(true);
        }
        const urls: Array<{ url: string }> = [];
        const seen = new Set<string>();
        let m;
        while ((m = URL_SCAN_RE.exec(combined)) !== null) {
          const url = m[0];
          if (!seen.has(url)) {
            seen.add(url);
            urls.push({ url });
          }
        }
        URL_SCAN_RE.lastIndex = 0;
        setDetectedUrls(urls);
        onUrlsDetectedRef.current?.(urls.map(u => u.url));
      }, 300);
    };

    // Also rescan on scroll
    const scrollDisposable = term.onScroll(() => scanUrlsDebounced());

    // Track current WebSocket for reconnection
    let currentWs: WebSocket | null = null;

    // Initial fit and resize helpers
    const fitAndResize = () => {
      if (isDisposedRef.current) return;
      try {
        fitAddon.fit();
        if (currentWs?.readyState === WebSocket.OPEN) {
          currentWs.send(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows,
          }));
        }
      } catch (e) {
        console.warn('[Terminal] Fit failed:', e);
      }
    };

    // Connect or reconnect to WebSocket
    const connect = (attemptResume: boolean = false) => {
      if (isDisposedRef.current) return;

      const ws = new WebSocket(getWsUrl());
      currentWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisposedRef.current) return;
        reconnectAttemptRef.current = 0; // Reset reconnect counter on successful connect

        try {
          fitAddon.fit();
        } catch {
          // Ignore fit errors on startup
        }

        // Check for existing session to resume
        const savedSessionId = getSavedSession();
        if (attemptResume && savedSessionId) {
          // Try to resume the session
          updateState('reconnecting');
          if (target.type === 'vm') {
            ws.send(JSON.stringify({
              type: 'resume-vm',
              sessionId: savedSessionId,
              cols: term.cols,
              rows: term.rows,
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'resume',
              sessionId: savedSessionId,
              cols: term.cols,
              rows: term.rows,
            }));
          }
        } else if (target.type === 'vm') {
          ws.send(JSON.stringify({
            type: 'start-vm',
            vmId: target.id,
            vmIp: target.ip,
            shell: '/bin/bash',
            cols: term.cols,
            rows: term.rows,
          }));
        } else {
          // Container terminal - start new session
          ws.send(JSON.stringify({
            type: 'start',
            containerId: target.id,
            shell: '/bin/bash',
            cols: term.cols,
            rows: term.rows,
            ...(target.workdir ? { workdir: target.workdir } : {}),
          }));
        }
      };

      ws.onmessage = (event) => {
        if (isDisposedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'connected':
              updateState('connected');
              setIsTmuxSession(!!msg.tmuxSession);
              if (msg.tmuxSession) {
                onTmuxStateChangeRef.current?.('connected');
              }
              term.focus();
              setTimeout(fitAndResize, 50);
              setTimeout(fitAndResize, 200);
              // Save session ID for future reconnection
              if (msg.sessionId) {
                saveSession(msg.sessionId);
              }
              if (msg.resumed) {
                term.write('\r\n\x1b[32m[Session resumed]\x1b[0m\r\n');
              }
              break;
            case 'scrollback':
              // Restore scrollback history on resume
              if (msg.data) {
                term.write(msg.data);
              }
              break;
            case 'session-not-found':
              // Session no longer exists, start fresh
              clearSavedSession();
              term.write('\r\n\x1b[33m[Previous session expired, starting new session...]\x1b[0m\r\n');
              // Start a new session based on target type
              if (target.type === 'vm') {
                ws.send(JSON.stringify({
                  type: 'start-vm',
                  vmId: target.id,
                  vmIp: target.ip,
                  shell: '/bin/bash',
                  cols: term.cols,
                  rows: term.rows,
                }));
              } else {
                ws.send(JSON.stringify({
                  type: 'start',
                  containerId: target.id,
                  shell: '/bin/bash',
                  cols: term.cols,
                  rows: term.rows,
                  ...(target.workdir ? { workdir: target.workdir } : {}),
                }));
              }
              break;
            case 'output':
              term.write(msg.data);
              scanUrlsDebounced();
              break;
            case 'exit':
              updateState('disconnected');
              term.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
              clearSavedSession(); // Session ended, clear saved state
              break;
            case 'session-update':
              // Server detected tmux state change via stdout marker
              if (msg.tmuxState) {
                const tmuxConnected = msg.tmuxState === 'connected';
                setIsTmuxSession(tmuxConnected);
                onTmuxStateChangeRef.current?.(msg.tmuxState);
              }
              break;
            case 'error':
              updateState('error', msg.message);
              term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
              break;
          }
        } catch {
          // Handle non-JSON messages
        }
      };

      ws.onclose = () => {
        if (isDisposedRef.current) return;

        // Attempt reconnection if we have a saved session
        const savedSessionId = getSavedSession();
        if (savedSessionId && reconnectAttemptRef.current < maxReconnectAttempts) {
          reconnectAttemptRef.current++;
          updateState('reconnecting');
          term.write(`\r\n\x1b[33m[Connection lost, reconnecting... (${reconnectAttemptRef.current}/${maxReconnectAttempts})]\x1b[0m\r\n`);

          reconnectTimerRef.current = setTimeout(() => {
            connect(true); // Attempt to resume
          }, reconnectDelay);
        } else {
          updateState('disconnected');
        }
      };

      ws.onerror = () => {
        if (isDisposedRef.current) return;
        // onclose will handle reconnection
      };
    };

    // Schedule multiple fit attempts
    const fitTimeout1 = setTimeout(fitAndResize, 100);
    const fitTimeout2 = setTimeout(fitAndResize, 300);
    const fitTimeout3 = setTimeout(fitAndResize, 600);

    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(fitAndResize);
    });

    // Check for saved session and attempt resume on initial connect
    const savedSession = getSavedSession();
    connect(!!savedSession);

    // Handle terminal input
    const dataDisposable = term.onData((data) => {
      if (currentWs?.readyState === WebSocket.OPEN) {
        currentWs.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize with debounce
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (isDisposedRef.current) return;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (isDisposedRef.current) return;
        try {
          fitAddon.fit();
          if (currentWs?.readyState === WebSocket.OPEN) {
            currentWs.send(JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            }));
          }
        } catch (e) {
          console.warn('[Terminal] Resize failed:', e);
        }
      }, 50);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(containerEl);

    // Store cleanup for resources created inside init()
    cleanupRef.current = () => {
      clearTimeout(fitTimeout1);
      clearTimeout(fitTimeout2);
      clearTimeout(fitTimeout3);
      cancelAnimationFrame(rafId);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      resizeObserver.disconnect();
      if (scanTimeout) clearTimeout(scanTimeout);
      scrollDisposable.dispose();
      dataDisposable.dispose();
      oscDisposable.dispose();
      if (currentWs?.readyState === WebSocket.OPEN || currentWs?.readyState === WebSocket.CONNECTING) {
        currentWs.close();
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };

    } // end init()

    return () => {
      isDisposedRef.current = true;
      clearTimeout(initTimeout);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [target.type, target.id, target.ip, target.workdir, getWsUrl, updateState, saveSession, getSavedSession, clearSavedSession]);

  // Update font size when prop changes
  useEffect(() => {
    if (xtermRef.current && fitAddonRef.current) {
      xtermRef.current.options.fontSize = fontSize;
      // Refit terminal after font size change
      try {
        fitAddonRef.current.fit();
        // Send resize to server
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          }));
        }
      } catch (e) {
        console.warn('[Terminal] Fit after font change failed:', e);
      }
    }
  }, [fontSize]);

  // Listen for prompt theme changes from settings
  useEffect(() => {
    const handler = (e: Event) => {
      const theme = (e as CustomEvent<{ theme: ShellPromptTheme }>).detail.theme;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'set-prompt-theme', theme }));
      }
    };
    window.addEventListener('handler-prompt-theme', handler);
    return () => window.removeEventListener('handler-prompt-theme', handler);
  }, []);

  // React to terminal theme changes
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getTerminalTheme(terminalIsDark);
    }
  }, [terminalIsDark]);

  // Listen for terminal theme mode changes from settings
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<{ mode: TerminalThemeMode }>).detail.mode;
      setTerminalThemeMode(mode);
    };
    window.addEventListener('handler-terminal-theme-mode', handler);
    return () => window.removeEventListener('handler-terminal-theme-mode', handler);
  }, []);

  // Focus the terminal when this component is clicked
  const handleClick = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  return (
    <div className={`h-full flex flex-col ${className}`} onClick={handleClick}>
      {/* Status bar */}
      {showStatusBar && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(var(--bg-surface))] border-b border-[hsl(var(--border))] text-[10px]">
          <span className={`flex items-center gap-1.5 ${
            connectionState === 'connected' ? 'text-[hsl(var(--green))]' :
            connectionState === 'connecting' || connectionState === 'reconnecting' ? 'text-[hsl(var(--amber))]' :
            'text-[hsl(var(--red))]'
          }`}>
            {(connectionState === 'connecting' || connectionState === 'reconnecting') && <Loader2 className="h-3 w-3 animate-spin" />}
            {connectionState === 'reconnecting' && <RefreshCw className="h-3 w-3" />}
            <span className="uppercase tracking-wider">{connectionState}</span>
          </span>
          {target.ip && (
            <>
              <span className="text-[hsl(var(--text-muted))]">|</span>
              <span className="text-[hsl(var(--text-secondary))]">agent@{target.ip}</span>
            </>
          )}
          {isTmuxSession && (
            <>
              <span className="text-[hsl(var(--text-muted))]">|</span>
              <span className="px-1 py-0.5 bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] rounded text-[9px] uppercase tracking-wider">tmux</span>
            </>
          )}
        </div>
      )}

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 p-1"
        style={{ backgroundColor: getTerminalBgColor(terminalIsDark) }}
      />

      {/* Detected URLs bar */}
      {detectedUrls.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-[hsl(var(--bg-surface))] border-t border-[hsl(var(--border))] overflow-x-auto shrink-0">
          <span className="text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider shrink-0">Links</span>
          {[...new Map(detectedUrls.map(u => [u.url, u])).values()].map(({ url }) => (
            <button
              key={url}
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(url).then(() => {
                  setCopiedUrl(url);
                  setTimeout(() => setCopiedUrl(null), 1500);
                });
              }}
              onMouseDown={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-[hsl(var(--bg-elevated))] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.15)] rounded truncate max-w-[300px] transition-colors"
              title={url}
            >
              {copiedUrl === url ? <Check className="h-2.5 w-2.5 text-[hsl(var(--green))] shrink-0" /> : <Copy className="h-2.5 w-2.5 shrink-0" />}
              <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
            </button>
          ))}
        </div>
      )}

      {/* Error overlay */}
      {connectionState === 'error' && errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--red)/0.3)] max-w-sm text-center">
            <p className="text-xs text-[hsl(var(--red))] mb-2">{errorMessage}</p>
            <p className="text-[10px] text-[hsl(var(--text-muted))]">
              {target.type === 'vm'
                ? 'Make sure the VM is running and SSH is available'
                : 'Make sure the container is running'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
