/**
 * MinimizedNodeMonitor - Headless component that monitors shell state of minimized nodes
 *
 * This component maintains a WebSocket connection to the terminal and parses OSC 7337
 * escape sequences to track the shell state (cwd, branch, claude status) without
 * rendering a terminal.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ShellState } from '../Terminal/TerminalInstance';

interface MinimizedNodeMonitorProps {
  sandboxId: string;
  onShellState: (state: Partial<ShellState>) => void;
}

export function MinimizedNodeMonitor({ sandboxId, onShellState }: MinimizedNodeMonitorProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parseOsc7337 = useCallback((data: string) => {
    // Look for OSC 7337 escape sequences
    // Format: \x1b]7337;key=value\x07 or \x1b]7337;key=value\x1b\\
    const osc7337Pattern = /\x1b\]7337;([^\x07\x1b]+)(?:\x07|\x1b\\)/g;
    let match;

    while ((match = osc7337Pattern.exec(data)) !== null) {
      const payload = match[1];
      const updates: Partial<ShellState> = {};

      // Parse key=value pairs
      const pairs = payload.split(';');
      for (const pair of pairs) {
        const [key, ...valueParts] = pair.split('=');
        const value = valueParts.join('=');

        switch (key) {
          case 'cwd':
            updates.cwd = value;
            break;
          case 'branch':
            updates.branch = value || undefined;
            break;
          case 'claude':
          case 'claude_status':
            if (value === 'processing' || value === 'idle' || value === 'waiting' || value === 'off') {
              updates.claudeStatus = value;
            }
            break;
        }
      }

      if (Object.keys(updates).length > 0) {
        onShellState(updates);
      }
    }
  }, [onShellState]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = import.meta.env.VITE_SERVER_PORT || '4001';
    const wsUrl = `${protocol}//${host}:${port}/ws/terminal`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Start session for monitoring
      ws.send(JSON.stringify({
        type: 'start',
        containerId: sandboxId,
        shell: '/bin/bash',
        cols: 80,
        rows: 24,
        isDevNode: false,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output' && msg.data) {
          parseOsc7337(msg.data);
        }
      } catch {
        // Raw output - also check for OSC 7337
        if (typeof event.data === 'string') {
          parseOsc7337(event.data);
        }
      }
    };

    ws.onclose = () => {
      // Reconnect after delay
      reconnectTimeoutRef.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [sandboxId, parseOsc7337]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Render nothing - this is a headless component
  return null;
}
