import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Loader2, /* Copy, Check, */ RefreshCw /*, ExternalLink, X */ } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { ShellPromptTheme } from '../../lib/prompt-themes';
import { getTerminalTheme, getTerminalBgColor, getStoredTerminalThemeMode, type TerminalThemeMode } from '../../lib/terminal-themes';
import { SHORTCUT_DEFINITIONS, getCombo, matchesCombo } from '../../lib/keyboard-shortcuts';
import { useTheme } from '../../hooks/useTheme';
import { getWsUrl as getWsUrlBase, uploadFileToSandbox } from '@/api/client';

// Connection state type
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';

export interface TerminalTarget {
  type: 'vm' | 'container' | 'image';
  id: string;
  ip?: string;
  /** Override the working directory for the shell session */
  workdir?: string;
  /** Unique key for session storage — allows multiple independent sessions for the same target */
  sessionKey?: string;
  /** If set, attach to this existing tmux session instead of creating a new one */
  attachTmuxSession?: string;
}

export interface ShellState {
  cwd: string;
  branch: string;
  claudeStatus?: 'processing' | 'idle' | 'waiting' | 'off';
}

export interface TerminalInstanceProps {
  target: TerminalTarget;
  onStateChange?: (state: ConnectionState, errorMessage?: string) => void;
  onTmuxStateChange?: (tmuxState: 'connected' | 'detached' | 'unavailable', tmuxSessionName?: string) => void;
  onShellState?: (state: ShellState) => void;
  onUrlsDetected?: (urls: string[]) => void;
  showStatusBar?: boolean;
  className?: string;
  fontSize?: number;
  /** Current CSS zoom/scale factor (e.g. from ReactFlow). Corrects mouse coordinates for text selection. */
  zoomLevel?: number;
  /** Suppress resize messages to server — used for preview terminals that shouldn't affect tmux window size */
  suppressResize?: boolean;
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
  zoomLevel,
  suppressResize = false,
}: TerminalInstanceProps) {
  const { isDark: systemIsDark } = useTheme();
  const [terminalThemeMode, setTerminalThemeMode] = useState<TerminalThemeMode>(getStoredTerminalThemeMode);
  const terminalIsDark = terminalThemeMode === 'system' ? systemIsDark : terminalThemeMode === 'dark';

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isTmuxSession, setIsTmuxSession] = useState(false);
  const [uploadToast, setUploadToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const tmuxSessionNameRef = useRef<string | undefined>(undefined);
  // URL bar state — commented out while bar is disabled
  // const [detectedUrls, setDetectedUrls] = useState<Array<{ url: string }>>([]);
  // const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  // const [dismissedUrls, setDismissedUrls] = useState<Set<string>>(new Set());
  const terminalIsDarkRef = useRef(terminalIsDark);
  terminalIsDarkRef.current = terminalIsDark;
  const zoomRef = useRef(zoomLevel ?? 1);
  zoomRef.current = zoomLevel ?? 1;

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isDisposedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const getWsUrl = useCallback(() => {
    return getWsUrlBase();
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

  // Get storage key for this target (sessionKey allows multiple independent sessions per target)
  const getStorageKey = useCallback(() => {
    const suffix = target.sessionKey ? `-${target.sessionKey}` : '';
    return `${SESSION_STORAGE_KEY}${target.type}-${target.id}${suffix}`;
  }, [target.type, target.id, target.sessionKey]);

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

    // Web links addon — Ctrl/Cmd+click opens in browser, plain click copies to clipboard
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (event.ctrlKey || event.metaKey) {
        window.open(uri, '_blank', 'noopener,noreferrer');
      } else {
        navigator.clipboard.writeText(uri);
      }
    });
    term.loadAddon(webLinksAddon);

    // Open terminal
    term.open(containerEl);
    xtermRef.current = term;

    // Let browser handle clipboard shortcuts (paste/copy) instead of xterm consuming them
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === 'keydown') {
        const mod = event.ctrlKey || event.metaKey;
        // Let browser handle paste (Ctrl+V / Cmd+V / Ctrl+Shift+V / Shift+Insert)
        if ((mod && event.key === 'v') || (event.ctrlKey && event.shiftKey && event.key === 'V') ||
            (event.shiftKey && event.key === 'Insert')) {
          return false;
        }
        // Let browser handle copy (Ctrl+C / Cmd+C) when there's a selection
        if (mod && event.key === 'c' && term.hasSelection()) {
          return false;
        }
        // Let registered global shortcuts pass through xterm to the window listener
        for (const def of SHORTCUT_DEFINITIONS) {
          const combo = getCombo(def.id);
          if (matchesCombo(event, combo)) return false;
        }
      }
      return true;
    });

    // Right-click to paste from clipboard
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text) term.paste(text);
      }).catch(() => {
        // Clipboard access denied or unavailable
      });
    };
    containerEl.addEventListener('contextmenu', handleContextMenu);

    // Intercept paste events to handle clipboard images (screenshots).
    // When the clipboard contains an image, upload it to the sandbox and
    // write the file path into the terminal so the running process can use it.
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      let imageFile: File | null = null;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          break;
        }
      }

      if (!imageFile) return; // No image — let normal text paste proceed

      e.preventDefault();
      e.stopPropagation();

      // Generate timestamped filename
      const now = new Date();
      const ts = now.toISOString().replace(/[-:T]/g, '').replace(/\..+/, '').slice(0, 15);
      const ext = imageFile.type === 'image/jpeg' ? 'jpg' : 'png';
      const filename = `screenshot-${ts}.${ext}`;
      const renamedFile = new File([imageFile], filename, { type: imageFile.type });

      setUploadToast({ message: `Uploading ${filename}...`, type: 'info' });

      const upload = uploadFileToSandbox(target.id, renamedFile, '/tmp');
      upload.promise.then(() => {
        const filePath = `/tmp/${filename}`;
        setUploadToast({ message: `Uploaded ${filePath}`, type: 'success' });
        setTimeout(() => setUploadToast(null), 3000);
        // Write the path into the terminal input so the running process sees it
        if (currentWs?.readyState === WebSocket.OPEN) {
          currentWs.send(JSON.stringify({ type: 'input', data: filePath }));
        }
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : 'unknown error';
        setUploadToast({ message: `Upload failed: ${msg}`, type: 'error' });
        setTimeout(() => setUploadToast(null), 5000);
      });
    };
    // Listen on xterm's internal textarea — that's where paste events fire
    // (the browser pastes into the focused element, which is xterm's hidden textarea)
    const pasteTarget = term.textarea || containerEl;
    pasteTarget.addEventListener('paste', handlePaste as EventListener);

    // Fix mouse coordinates when inside a CSS-transformed container (e.g. ReactFlow zoom).
    // xterm.js computes cell position as: ceil((clientX - rect.left) / cssCellWidth)
    // But getBoundingClientRect() returns visual (scaled) coordinates while cssCellWidth
    // is unscaled, causing selection offset at non-1.0 zoom. We patch getCoords to divide
    // the visual offset by the zoom factor before the cell-width division.
    const core = (term as unknown as { _core: { _mouseService?: {
      getCoords: (...args: unknown[]) => [number, number] | undefined;
      getMouseReportCoords: (...args: unknown[]) => { col: number; row: number } | undefined;
    }}})._core;
    if (core._mouseService) {
      const origGetCoords = core._mouseService.getCoords.bind(core._mouseService);
      core._mouseService.getCoords = function(event: unknown, element: unknown, ...rest: unknown[]) {
        const z = zoomRef.current;
        if (z !== 1) {
          const me = event as { clientX: number; clientY: number };
          const rect = (element as HTMLElement).getBoundingClientRect();
          event = {
            clientX: rect.left + (me.clientX - rect.left) / z,
            clientY: rect.top + (me.clientY - rect.top) / z,
          };
        }
        return origGetCoords(event, element, ...rest);
      } as typeof core._mouseService.getCoords;
      const origGetMouseReportCoords = core._mouseService.getMouseReportCoords.bind(core._mouseService);
      core._mouseService.getMouseReportCoords = function(event: unknown, element: unknown) {
        const z = zoomRef.current;
        if (z !== 1) {
          const me = event as { clientX: number; clientY: number };
          const rect = (element as HTMLElement).getBoundingClientRect();
          event = {
            clientX: rect.left + (me.clientX - rect.left) / z,
            clientY: rect.top + (me.clientY - rect.top) / z,
          };
        }
        return origGetMouseReportCoords(event, element);
      } as typeof core._mouseService.getMouseReportCoords;
    }

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
        // setDetectedUrls(urls);  // URL bar disabled
        // setDismissedUrls(prev => { ... });  // URL bar disabled
        onUrlsDetectedRef.current?.(urls.map(u => u.url));
      }, 300);
    };

    // Also rescan on scroll
    const scrollDisposable = term.onScroll(() => scanUrlsDebounced());

    // Track current WebSocket for reconnection
    let currentWs: WebSocket | null = null;

    // Fit immediately (throttled via rAF), debounce only the WebSocket resize message
    let lastSentCols = 0;
    let lastSentRows = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let fitRafId: number | null = null;

    const sendResizeIfChanged = () => {
      if (suppressResize) return; // Preview terminals don't send resize
      if (currentWs?.readyState === WebSocket.OPEN &&
          (term.cols !== lastSentCols || term.rows !== lastSentRows)) {
        lastSentCols = term.cols;
        lastSentRows = term.rows;
        currentWs.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }));
      }
    };

    const fitAndResize = () => {
      if (isDisposedRef.current) return;
      // Fit immediately (throttled to one per frame)
      if (fitRafId === null) {
        fitRafId = requestAnimationFrame(() => {
          fitRafId = null;
          if (isDisposedRef.current) return;
          try {
            fitAddon.fit();
          } catch (e) {
            console.warn('[Terminal] Fit failed:', e);
          }
          // Debounce the server resize message
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(sendResizeIfChanged, 150);
        });
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
        } else if (target.type === 'image') {
          // Image shell — chroot into rootfs
          ws.send(JSON.stringify({
            type: 'start-image-shell',
            imageName: target.id,
            cols: term.cols,
            rows: term.rows,
          }));
        } else if (target.type === 'vm') {
          ws.send(JSON.stringify({
            type: 'start-vm',
            vmId: target.id,
            vmIp: target.ip,
            shell: '/bin/bash',
            cols: term.cols,
            rows: term.rows,
            ...(target.sessionKey ? { sessionKey: target.sessionKey } : {}),
            ...(target.attachTmuxSession ? { attachTmuxSession: target.attachTmuxSession } : {}),
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
            ...(target.attachTmuxSession ? { attachTmuxSession: target.attachTmuxSession } : {}),
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
                tmuxSessionNameRef.current = msg.tmuxSession;
                onTmuxStateChangeRef.current?.('connected', msg.tmuxSession);
              }
              term.focus();
              fitAndResize();
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
              if (target.type === 'image') {
                ws.send(JSON.stringify({
                  type: 'start-image-shell',
                  imageName: target.id,
                  cols: term.cols,
                  rows: term.rows,
                }));
              } else if (target.type === 'vm') {
                ws.send(JSON.stringify({
                  type: 'start-vm',
                  vmId: target.id,
                  vmIp: target.ip,
                  shell: '/bin/bash',
                  cols: term.cols,
                  rows: term.rows,
                  ...(target.sessionKey ? { sessionKey: target.sessionKey } : {}),
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
                onTmuxStateChangeRef.current?.(msg.tmuxState, tmuxSessionNameRef.current);
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

    // Fit on init
    fitAndResize();

    // Check for saved session and attempt resume on initial connect
    const savedSession = getSavedSession();
    connect(!!savedSession);

    // Handle terminal input
    const dataDisposable = term.onData((data) => {
      if (currentWs?.readyState === WebSocket.OPEN) {
        currentWs.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(containerEl);

    // Store cleanup for resources created inside init()
    cleanupRef.current = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      if (fitRafId !== null) cancelAnimationFrame(fitRafId);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      resizeObserver.disconnect();
      if (scanTimeout) clearTimeout(scanTimeout);
      containerEl.removeEventListener('contextmenu', handleContextMenu);
      pasteTarget.removeEventListener('paste', handlePaste as EventListener);
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
  }, [target.type, target.id, target.ip, target.workdir, target.sessionKey, getWsUrl, updateState, saveSession, getSavedSession, clearSavedSession]);

  // Update font size when prop changes
  useEffect(() => {
    if (xtermRef.current && fitAddonRef.current) {
      xtermRef.current.options.fontSize = fontSize;
      // Refit terminal after font size change
      try {
        fitAddonRef.current.fit();
        // Send resize to server (skip for preview terminals)
        if (!suppressResize && wsRef.current?.readyState === WebSocket.OPEN) {
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
  }, [fontSize, suppressResize]);

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

      {/* Terminal — outer div provides visual margin, inner div has zero padding
          so FitAddon measures the exact available height for rows */}
      <div className="flex-1 min-h-0 px-1 pt-1 flex flex-col relative" style={{ backgroundColor: getTerminalBgColor(terminalIsDark) }}>
        <div ref={terminalRef} className="flex-1 min-h-0" />
        {uploadToast && (
          <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-xs font-mono shadow-lg z-10 ${
            uploadToast.type === 'error' ? 'bg-[hsl(var(--red)/0.9)] text-white' :
            uploadToast.type === 'success' ? 'bg-[hsl(var(--green)/0.9)] text-white' :
            'bg-[hsl(var(--bg-elevated)/0.95)] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border))]'
          }`}>
            {uploadToast.message}
          </div>
        )}
      </div>

      {/* Detected URLs bar — disabled for now, too buggy
      {(() => {
        const visibleUrls = [...new Map(detectedUrls.map(u => [u.url, u])).values()].filter(({ url }) => !dismissedUrls.has(url));
        return visibleUrls.length > 0 ? (
          <div className="flex items-center gap-1 px-2 py-1 bg-[hsl(var(--bg-surface))] border-t border-[hsl(var(--border))] overflow-x-auto shrink-0">
            <span className="text-[9px] text-[hsl(var(--text-muted))] uppercase tracking-wider shrink-0">Links</span>
            {visibleUrls.map(({ url }) => (
              <div
                key={url}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono bg-[hsl(var(--bg-elevated))] text-[hsl(var(--cyan))] rounded max-w-[300px] group/link"
                onMouseDown={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
              >
                <span className="truncate" title={url}>{url.replace(/^https?:\/\//, '')}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(url).then(() => {
                      setCopiedUrl(url);
                      setTimeout(() => setCopiedUrl(null), 1500);
                    });
                  }}
                  className="shrink-0 p-0.5 hover:text-[hsl(var(--text-primary))] transition-colors rounded hover:bg-[hsl(var(--bg-overlay))]"
                  title="Copy URL"
                >
                  {copiedUrl === url ? <Check className="h-2.5 w-2.5 text-[hsl(var(--green))]" /> : <Copy className="h-2.5 w-2.5" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  className="shrink-0 p-0.5 hover:text-[hsl(var(--text-primary))] transition-colors rounded hover:bg-[hsl(var(--bg-overlay))]"
                  title="Open in browser"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDismissedUrls(prev => new Set(prev).add(url));
                  }}
                  className="shrink-0 p-0.5 hover:text-[hsl(var(--red))] transition-colors rounded hover:bg-[hsl(var(--bg-overlay))]"
                  title="Dismiss link"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null;
      })()} */}

      {/* Error overlay */}
      {connectionState === 'error' && errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--red)/0.3)] max-w-sm text-center">
            <p className="text-xs text-[hsl(var(--red))] mb-2">{errorMessage}</p>
            <p className="text-[10px] text-[hsl(var(--text-muted))]">
              {target.type === 'image'
                ? 'Make sure the rootfs.ext4 exists and sudo is available'
                : target.type === 'vm'
                ? 'Make sure the VM is running and SSH is available'
                : 'Make sure the container is running'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
