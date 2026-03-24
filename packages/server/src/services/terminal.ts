/**
 * Terminal Service - WebSocket-based terminal sessions
 * Uses docker exec with tmux for persistent sessions that survive disconnects.
 * When a client reconnects, they can resume the same tmux session.
 */

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { injectShellInit, getTmuxThemeContent } from './shell-init.js';
import { getConfig } from './config.js';
import { safeExec } from '../lib/safe-exec.js';
import {
  getSession as getPersistedSession,
  setSession as setPersistedSession,
  deleteSession as deletePersistedSession,
  generateTmuxSessionName,
  type PersistedSession,
} from './session-store.js';

interface TerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  containerId: string;
  tmuxSession: string;
  lastCols?: number;
  lastRows?: number;
}

const sessions = new Map<string, TerminalSession>();

/**
 * Check if tmux is available in the container
 */
async function hasTmux(containerId: string): Promise<boolean> {
  try {
    await safeExec('docker', ['exec', containerId, 'which', 'tmux']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux session exists in the container
 */
async function tmuxSessionExists(containerId: string, tmuxSession: string): Promise<boolean> {
  try {
    await safeExec('docker', ['exec', containerId, 'tmux', 'has-session', '-t', tmuxSession]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture scrollback from a tmux session
 */
async function captureTmuxScrollback(containerId: string, tmuxSession: string, lines: number = 1000): Promise<string> {
  try {
    return await safeExec('docker', ['exec', containerId, 'tmux', 'capture-pane', '-t', tmuxSession, '-p', '-S', `-${lines}`]);
  } catch (err) {
    console.warn(`[Terminal] Failed to capture scrollback for ${tmuxSession}:`, err);
    return '';
  }
}

/**
 * Kill a tmux session in a container
 */
export async function killTmuxSession(containerId: string, tmuxSession: string): Promise<void> {
  try {
    await safeExec('docker', ['exec', containerId, 'tmux', 'kill-session', '-t', tmuxSession]);
    console.log(`[Terminal] Killed tmux session ${tmuxSession} in container ${containerId}`);
  } catch {
    // Session may not exist
  }
}

export function createTerminalSession(
  ws: WebSocket,
  containerId: string,
  shell: string = '/bin/bash',
  cols: number = 80,
  rows: number = 24,
  customWorkdir?: string,
  attachTmuxSession?: string
): string {
  const sessionId = `${containerId}-${Date.now()}`;
  const tmuxSession = attachTmuxSession || generateTmuxSessionName(containerId);

  console.log(`🔧 Creating terminal session: ${sessionId} (tmux: ${tmuxSession}, attach: ${!!attachTmuxSession}, workdir: ${customWorkdir || 'default'})`);

  // Check if tmux is enabled in config and available in container
  getConfig().then(config => {
    if (config.tmuxEnabled === false) {
      console.log(`[Terminal] tmux disabled in config, using script session`);
      startScriptSession(ws, sessionId, containerId, customWorkdir, shell, cols, rows);
      return;
    }

    return hasTmux(containerId).then(async useTmux => {
      if (useTmux) {
        if (attachTmuxSession) {
          // Verify the target tmux session exists before attaching
          const exists = await tmuxSessionExists(containerId, attachTmuxSession);
          if (exists) {
            startAttachTmuxSession(ws, sessionId, containerId, attachTmuxSession, cols, rows);
          } else {
            console.log(`[Terminal] Requested tmux session ${attachTmuxSession} not found, creating new`);
            startTmuxSession(ws, sessionId, containerId, tmuxSession, customWorkdir, shell, cols, rows);
          }
        } else {
          startTmuxSession(ws, sessionId, containerId, tmuxSession, customWorkdir, shell, cols, rows);
        }
      } else {
        console.log(`[Terminal] tmux not available in ${containerId}, falling back to script`);
        startScriptSession(ws, sessionId, containerId, customWorkdir, shell, cols, rows);
      }
    });
  }).catch(() => {
    // Fall back to script on error
    startScriptSession(ws, sessionId, containerId, customWorkdir, shell, cols, rows);
  });

  return sessionId;
}

/**
 * Start a new tmux-based terminal session
 * Uses 'script' to provide PTY emulation (tmux requires a TTY)
 */
async function startTmuxSession(
  ws: WebSocket,
  sessionId: string,
  containerId: string,
  tmuxSession: string,
  customWorkdir: string | undefined,
  shell: string,
  cols: number,
  rows: number
): Promise<void> {
  // Use docker exec with 'script' wrapping tmux to provide PTY emulation
  // tmux requires a TTY, but docker exec -i without -t doesn't provide one
  // The 'script' command creates a pseudo-TTY internally
  // -x/-y set dimensions; status bar visibility is controlled by config
  const config = await getConfig();
  const showStatusBar = config.tmuxStatusBar === true;
  const theme = config.shellPromptTheme || 'minimal';
  const tmuxThemeContent = getTmuxThemeContent(theme, showStatusBar);

  // Write the tmux theme conf and source it after creating the session
  // Use a wrapper script to write config then launch tmux
  const setupAndTmux = `mkdir -p ~/.config/handler && cat > ~/.config/handler/tmux-theme.conf << 'HANDLER_TMUX_EOF'\n${tmuxThemeContent}\nHANDLER_TMUX_EOF\ntmux new-session -A -s ${tmuxSession} -x ${cols} -y ${rows} ${shell} \\; source-file ~/.config/handler/tmux-theme.conf`;
  const tmuxCmd = setupAndTmux;

  const args = [
    'exec',
    '-i',                        // Interactive mode
    '-e', 'TERM=xterm-256color', // Set terminal type
    '-e', `COLUMNS=${cols}`,     // Terminal width
    '-e', `LINES=${rows}`,       // Terminal height
    ...(customWorkdir ? ['-w', customWorkdir] : []),
    containerId,
    'script',                    // Use script for PTY emulation
    '-qec',                      // Quiet, execute command
    tmuxCmd,                     // tmux command
    '/dev/null',                 // Output to /dev/null (we capture via stdout)
  ];

  const process = spawn('docker', args);

  setupSessionHandlers(ws, sessionId, containerId, tmuxSession, process, true, cols, rows);
}

/**
 * Attach to an existing tmux session in a Docker container.
 * Similar to resumeTerminalSession but takes a tmux session name directly
 * (used when the user picks an existing session from the session picker).
 */
async function startAttachTmuxSession(
  ws: WebSocket,
  sessionId: string,
  containerId: string,
  tmuxSession: string,
  cols: number,
  rows: number
): Promise<void> {
  const config = await getConfig();
  const showStatusBar = config.tmuxStatusBar === true;
  const theme = config.shellPromptTheme || 'minimal';
  const tmuxThemeContent = getTmuxThemeContent(theme, showStatusBar);

  const setupAndAttach = `mkdir -p ~/.config/handler && cat > ~/.config/handler/tmux-theme.conf << 'HANDLER_TMUX_EOF'\n${tmuxThemeContent}\nHANDLER_TMUX_EOF\ntmux attach-session -t ${tmuxSession} \\; source-file ~/.config/handler/tmux-theme.conf \\; resize-window -x ${cols} -y ${rows}`;

  const process = spawn('docker', [
    'exec',
    '-i',
    '-e', 'TERM=xterm-256color',
    '-e', `COLUMNS=${cols}`,
    '-e', `LINES=${rows}`,
    containerId,
    'script',
    '-qec',
    setupAndAttach,
    '/dev/null',
  ]);

  setupSessionHandlers(ws, sessionId, containerId, tmuxSession, process, true, cols, rows);
}

/**
 * Start a fallback script-based terminal session (when tmux unavailable)
 */
function startScriptSession(
  ws: WebSocket,
  sessionId: string,
  containerId: string,
  customWorkdir: string | undefined,
  shell: string,
  cols: number,
  rows: number
): void {
  const args = [
    'exec',
    '-i',
    '-e', 'TERM=xterm-256color',
    '-e', `COLUMNS=${cols}`,
    '-e', `LINES=${rows}`,
    ...(customWorkdir ? ['-w', customWorkdir] : []),
    containerId,
    'script',
    '-qec',
    shell,
    '/dev/null',
  ];

  const process = spawn('docker', args);

  setupSessionHandlers(ws, sessionId, containerId, '', process, false, cols, rows);
}

/**
 * Set up event handlers for a terminal session
 */
function setupSessionHandlers(
  ws: WebSocket,
  sessionId: string,
  containerId: string,
  tmuxSession: string,
  process: ChildProcess,
  isTmux: boolean,
  initialCols?: number,
  initialRows?: number
): void {
  // Handle process output → WebSocket
  process.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  process.stderr?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      const output = data.toString().replace(/\n/g, '\r\n');
      ws.send(JSON.stringify({ type: 'output', data: output }));
    }
  });

  // Handle process exit
  process.on('exit', (code) => {
    console.log(`   Shell exited with code ${code} for session ${sessionId}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
    // If tmux session, don't delete the persisted metadata yet - it may be resumed
    // Only delete if the tmux session itself is gone (checked on resume)
  });

  process.on('error', (err) => {
    console.error(`   Process error for session ${sessionId}:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, {
    process, ws, containerId, tmuxSession,
    lastCols: initialCols, lastRows: initialRows,
  });

  // Persist session metadata for reconnection (only for tmux sessions)
  if (isTmux && tmuxSession) {
    setPersistedSession({
      sessionId,
      containerId,
      tmuxSession,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      user: 'root',
      workdir: '/root',
    });
  }

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId, tmuxSession: isTmux ? tmuxSession : undefined }));

  // Inject shell init (PROMPT_COMMAND for real-time cwd/branch tracking)
  injectShellInit(process);
}

/**
 * Resume an existing tmux session
 * Returns the new sessionId if successful, or null if the session doesn't exist
 */
export async function resumeTerminalSession(
  ws: WebSocket,
  oldSessionId: string,
  cols: number = 80,
  rows: number = 24
): Promise<{ sessionId: string; scrollback: string } | null> {
  // Short-circuit if tmux is disabled
  const config = await getConfig();
  if (config.tmuxEnabled === false) {
    return null;
  }

  // Look up the persisted session
  const persisted = getPersistedSession(oldSessionId);
  if (!persisted) {
    console.log(`[Terminal] No persisted session found for ${oldSessionId}`);
    return null;
  }

  const { containerId, tmuxSession } = persisted;

  if (!containerId) {
    console.log(`[Terminal] Session ${oldSessionId} is not a container session`);
    return null;
  }

  // Check if the tmux session still exists
  const exists = await tmuxSessionExists(containerId, tmuxSession);
  if (!exists) {
    console.log(`[Terminal] tmux session ${tmuxSession} no longer exists in container ${containerId}`);
    deletePersistedSession(oldSessionId);
    return null;
  }

  // Capture scrollback before reattaching
  const scrollback = await captureTmuxScrollback(containerId, tmuxSession);

  // Create new session ID for this connection
  const sessionId = `${containerId}-${Date.now()}`;
  console.log(`🔄 Resuming terminal session: ${sessionId} (tmux: ${tmuxSession})`);

  // Attach to the existing tmux session using 'script' for PTY emulation
  // Apply themed status bar config and resize to current dimensions
  const theme = config.shellPromptTheme || 'minimal';
  const showStatusBar = config.tmuxStatusBar === true;
  const tmuxThemeContent = getTmuxThemeContent(theme, showStatusBar);

  const setupAndAttach = `mkdir -p ~/.config/handler && cat > ~/.config/handler/tmux-theme.conf << 'HANDLER_TMUX_EOF'\n${tmuxThemeContent}\nHANDLER_TMUX_EOF\ntmux attach-session -t ${tmuxSession} \\; source-file ~/.config/handler/tmux-theme.conf \\; resize-window -x ${cols} -y ${rows}`;
  const tmuxCmd = setupAndAttach;

  const process = spawn('docker', [
    'exec',
    '-i',
    '-e', 'TERM=xterm-256color',
    '-e', `COLUMNS=${cols}`,
    '-e', `LINES=${rows}`,
    containerId,
    'script',
    '-qec',
    tmuxCmd,
    '/dev/null',
  ]);

  // Handle process output → WebSocket
  process.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  process.stderr?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      const output = data.toString().replace(/\n/g, '\r\n');
      ws.send(JSON.stringify({ type: 'output', data: output }));
    }
  });

  process.on('exit', (code) => {
    console.log(`   Shell exited with code ${code} for resumed session ${sessionId}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
  });

  process.on('error', (err) => {
    console.error(`   Process error for resumed session ${sessionId}:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { process, ws, containerId, tmuxSession, lastCols: cols, lastRows: rows });

  // Update persisted session with new sessionId
  setPersistedSession({
    ...persisted,
    sessionId,
    lastAccessedAt: Date.now(),
  });

  // Delete old session entry
  if (oldSessionId !== sessionId) {
    deletePersistedSession(oldSessionId);
  }

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId, tmuxSession, resumed: true }));

  // Resize the tmux window to match client dimensions
  try {
    await safeExec('docker', ['exec', containerId, 'tmux', 'resize-window', '-t', tmuxSession, '-x', String(cols), '-y', String(rows)]);
  } catch {
    // Ignore resize errors
  }

  return { sessionId, scrollback };
}

export function writeToSession(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId);
  if (session && session.process.stdin?.writable) {
    session.process.stdin.write(data);
    return true;
  }
  return false;
}

export function resizeSession(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // Skip if dimensions haven't changed
  if (session.lastCols === cols && session.lastRows === rows) return true;
  session.lastCols = cols;
  session.lastRows = rows;

  if (session.tmuxSession) {
    // For tmux sessions: resize via docker exec (no stdin echo).
    // tmux resize-window handles the PTY and sends SIGWINCH to the shell.
    safeExec('docker', ['exec', session.containerId, 'tmux', 'resize-window', '-t', session.tmuxSession, '-x', String(cols), '-y', String(rows)])
      .catch(() => { /* ignore errors */ });
  } else if (session.process.stdin?.writable) {
    // For non-tmux sessions: send stty through stdin (only fallback)
    session.process.stdin.write(`\x15stty cols ${cols} rows ${rows} 2>/dev/null\n`);
  }

  console.log(`   Resized session ${sessionId}: ${cols}x${rows}`);
  return true;
}

export function closeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    if (!session.process.killed) {
      session.process.kill();
    }
    sessions.delete(sessionId);
    // Note: Don't delete persisted session metadata - allows reconnection
  }
}

/**
 * Handle WebSocket disconnect - detach from tmux (keep session alive) instead of killing
 */
export function closeSessionByWebSocket(ws: WebSocket): void {
  for (const [id, session] of sessions.entries()) {
    if (session.ws === ws) {
      if (session.tmuxSession) {
        // For tmux sessions: just kill the attach process, the tmux session continues
        // Send tmux detach key sequence (Ctrl+B d) before killing
        if (session.process.stdin?.writable) {
          session.process.stdin.write('\x02d'); // Ctrl+B followed by 'd' to detach
        }
        // Give it a moment to detach cleanly
        setTimeout(() => {
          if (!session.process.killed) {
            session.process.kill('SIGTERM');
          }
        }, 100);
        console.log(`   Detached from tmux session ${session.tmuxSession} (session preserved for reconnection)`);
      } else {
        // For non-tmux sessions: kill the process
        if (!session.process.killed) {
          session.process.kill();
        }
        console.log(`   Closed session ${id} due to WebSocket disconnect`);
      }
      sessions.delete(id);
      break;
    }
  }
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Close all sessions - used during server shutdown
 * Note: tmux sessions in containers will persist for reconnection after restart
 */
export function closeAllSessions(): void {
  console.log(`[Terminal] Closing ${sessions.size} active session(s)...`);
  for (const [id, session] of sessions.entries()) {
    if (session.tmuxSession) {
      // Detach cleanly from tmux
      if (session.process.stdin?.writable) {
        session.process.stdin.write('\x02d');
      }
      setTimeout(() => {
        if (!session.process.killed) {
          session.process.kill('SIGTERM');
        }
      }, 50);
    } else {
      if (!session.process.killed) {
        session.process.kill();
      }
    }
    sessions.delete(id);
  }
}

/**
 * Get session by ID (for external access)
 */
export function getSession(sessionId: string): TerminalSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Apply tmux status bar theme to all active Docker tmux sessions.
 * For "off": sends `tmux set -g status off` directly.
 * For "on": writes themed conf and sources it via tmux source-file.
 */
export async function applyDockerTmuxStatusBar(show: boolean): Promise<void> {
  const config = await getConfig();
  const theme = config.shellPromptTheme || 'minimal';

  for (const [id, session] of sessions.entries()) {
    if (session.tmuxSession && session.containerId) {
      let cmd: string;
      if (!show) {
        cmd = `tmux set -g status off; mkdir -p ~/.config/handler && echo 'set -g status off' > ~/.config/handler/tmux-theme.conf`;
      } else {
        const tmuxThemeContent = getTmuxThemeContent(theme, true);
        const encoded = Buffer.from(tmuxThemeContent).toString('base64');
        cmd = `mkdir -p ~/.config/handler && echo ${encoded} | base64 -d > ~/.config/handler/tmux-theme.conf && tmux source-file ~/.config/handler/tmux-theme.conf`;
      }
      safeExec('docker', ['exec', session.containerId, 'bash', '-c', cmd])
        .then(() => console.log(`[Terminal] Applied tmux theme (status ${show ? 'on' : 'off'}) for session ${id}`))
        .catch((err: unknown) => console.warn(`[Terminal] Failed to apply tmux theme for session ${id}:`, err instanceof Error ? err.message : err));
    }
  }
}
