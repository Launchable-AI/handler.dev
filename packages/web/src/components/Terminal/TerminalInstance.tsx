import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Loader2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

// Connection state type
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface TerminalTarget {
  type: 'vm' | 'container';
  id: string;
  ip?: string;
  /** For containers: connect as 'dev' user in /home/dev/workspace instead of root */
  isDevNode?: boolean;
}

export interface TerminalInstanceProps {
  target: TerminalTarget;
  onStateChange?: (state: ConnectionState, errorMessage?: string) => void;
  showStatusBar?: boolean;
  className?: string;
}

export function TerminalInstance({
  target,
  onStateChange,
  showStatusBar = true,
  className = '',
}: TerminalInstanceProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>();

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isDisposedRef = useRef(false);

  const getWsUrl = useCallback(() => {
    const apiPort = (window as unknown as { __API_PORT__?: number }).__API_PORT__ || 4001;
    const hostname = window.location.hostname || 'localhost';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${hostname}:${apiPort}/ws/terminal`;
  }, []);

  // Stable callback ref to avoid re-running effect
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const updateState = useCallback((state: ConnectionState, error?: string) => {
    setConnectionState(state);
    setErrorMessage(error);
    onStateChangeRef.current?.(state, error);
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;

    isDisposedRef.current = false;

    // Create terminal instance with theme matching the UI
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
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
      },
      allowProposedApi: true,
    });

    // Add fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Add web links addon
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    // Open terminal
    term.open(terminalRef.current);
    xtermRef.current = term;

    // Connect WebSocket first
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    // Initial fit and resize helpers
    const fitAndResize = () => {
      if (isDisposedRef.current) return;
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows,
          }));
        }
      } catch (e) {
        console.warn('[Terminal] Fit failed:', e);
      }
    };

    // Schedule multiple fit attempts
    const fitTimeout1 = setTimeout(fitAndResize, 100);
    const fitTimeout2 = setTimeout(fitAndResize, 300);
    const fitTimeout3 = setTimeout(fitAndResize, 600);

    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(fitAndResize);
    });

    ws.onopen = () => {
      if (isDisposedRef.current) return;
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors on startup
      }

      // Send appropriate start message based on target type
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
        // Container terminal
        ws.send(JSON.stringify({
          type: 'start',
          containerId: target.id,
          shell: '/bin/bash',
          cols: term.cols,
          rows: term.rows,
          isDevNode: target.isDevNode ?? true, // Default to dev user for containers
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
            term.focus();
            setTimeout(fitAndResize, 50);
            setTimeout(fitAndResize, 200);
            break;
          case 'output':
            term.write(msg.data);
            break;
          case 'exit':
            updateState('disconnected');
            term.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
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
      updateState('disconnected');
    };

    ws.onerror = () => {
      if (isDisposedRef.current) return;
      updateState('error', 'Connection failed');
    };

    // Handle terminal input
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
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
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
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
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      isDisposedRef.current = true;
      clearTimeout(fitTimeout1);
      clearTimeout(fitTimeout2);
      clearTimeout(fitTimeout3);
      cancelAnimationFrame(rafId);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [target.type, target.id, target.ip, target.isDevNode, getWsUrl, updateState]);

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
            connectionState === 'connecting' ? 'text-[hsl(var(--amber))]' :
            'text-[hsl(var(--red))]'
          }`}>
            {connectionState === 'connecting' && <Loader2 className="h-3 w-3 animate-spin" />}
            <span className="uppercase tracking-wider">{connectionState}</span>
          </span>
          {target.ip && (
            <>
              <span className="text-[hsl(var(--text-muted))]">|</span>
              <span className="text-[hsl(var(--text-secondary))]">agent@{target.ip}</span>
            </>
          )}
        </div>
      )}

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 p-1"
        style={{ backgroundColor: 'hsl(220 20% 6%)' }}
      />

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
