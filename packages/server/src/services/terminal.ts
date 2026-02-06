/**
 * Terminal Service - WebSocket-based terminal sessions
 * Uses docker exec with tmux for persistent sessions that survive disconnects.
 * When a client reconnects, they can resume the same tmux session.
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import { WebSocket } from 'ws';
import { injectShellInit } from './shell-init.js';
import {
  getSession as getPersistedSession,
  setSession as setPersistedSession,
  deleteSession as deletePersistedSession,
  generateTmuxSessionName,
  type PersistedSession,
} from './session-store.js';

const execAsync = promisify(exec);

interface TerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  containerId: string;
  tmuxSession: string;
  user: string;
  workdir: string;
}

const sessions = new Map<string, TerminalSession>();

/**
 * Check if tmux is available in the container
 */
async function hasTmux(containerId: string): Promise<boolean> {
  try {
    await execAsync(`docker exec ${containerId} which tmux`);
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
    await execAsync(`docker exec ${containerId} tmux has-session -t ${tmuxSession} 2>/dev/null`);
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
    const { stdout } = await execAsync(
      `docker exec ${containerId} tmux capture-pane -t ${tmuxSession} -p -S -${lines}`
    );
    return stdout;
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
    await execAsync(`docker exec ${containerId} tmux kill-session -t ${tmuxSession} 2>/dev/null`);
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
  isDevNode: boolean = false,
  customWorkdir?: string
): string {
  const sessionId = `${containerId}-${Date.now()}`;
  const tmuxSession = generateTmuxSessionName(containerId);

  console.log(`🔧 Creating terminal session: ${sessionId} (tmux: ${tmuxSession}, isDevNode: ${isDevNode}, workdir: ${customWorkdir || 'default'})`);

  // For dev-node containers: connect as 'dev' user in /home/dev/workspace
  // For other containers: connect as 'root' in /root
  const user = isDevNode ? 'dev' : 'root';
  const workdir = customWorkdir || (isDevNode ? '/home/dev/workspace' : '/root');

  // Check if tmux is available, fall back to script if not
  hasTmux(containerId).then(useTmux => {
    if (useTmux) {
      startTmuxSession(ws, sessionId, containerId, tmuxSession, user, workdir, shell, cols, rows);
    } else {
      console.log(`[Terminal] tmux not available in ${containerId}, falling back to script`);
      startScriptSession(ws, sessionId, containerId, user, workdir, shell, cols, rows);
    }
  }).catch(() => {
    // Fall back to script on error
    startScriptSession(ws, sessionId, containerId, user, workdir, shell, cols, rows);
  });

  return sessionId;
}

/**
 * Start a new tmux-based terminal session
 * Uses 'script' to provide PTY emulation (tmux requires a TTY)
 */
function startTmuxSession(
  ws: WebSocket,
  sessionId: string,
  containerId: string,
  tmuxSession: string,
  user: string,
  workdir: string,
  shell: string,
  cols: number,
  rows: number
): void {
  // Use docker exec with 'script' wrapping tmux to provide PTY emulation
  // tmux requires a TTY, but docker exec -i without -t doesn't provide one
  // The 'script' command creates a pseudo-TTY internally
  // -x/-y set dimensions, set-option status off hides the status bar (we have our own UI)
  const tmuxCmd = `tmux new-session -A -s ${tmuxSession} -x ${cols} -y ${rows} ${shell} \\; set-option status off`;

  const process = spawn('docker', [
    'exec',
    '-i',                        // Interactive mode
    '-u', user,                  // Run as specified user
    '-e', 'TERM=xterm-256color', // Set terminal type
    '-e', `COLUMNS=${cols}`,     // Terminal width
    '-e', `LINES=${rows}`,       // Terminal height
    '-w', workdir,               // Start in appropriate directory
    containerId,
    'script',                    // Use script for PTY emulation
    '-qec',                      // Quiet, execute command
    tmuxCmd,                     // tmux command
    '/dev/null',                 // Output to /dev/null (we capture via stdout)
  ]);

  setupSessionHandlers(ws, sessionId, containerId, tmuxSession, user, workdir, process, true);
}

/**
 * Start a fallback script-based terminal session (when tmux unavailable)
 */
function startScriptSession(
  ws: WebSocket,
  sessionId: string,
  containerId: string,
  user: string,
  workdir: string,
  shell: string,
  cols: number,
  rows: number
): void {
  const process = spawn('docker', [
    'exec',
    '-i',
    '-u', user,
    '-e', 'TERM=xterm-256color',
    '-e', `COLUMNS=${cols}`,
    '-e', `LINES=${rows}`,
    '-w', workdir,
    containerId,
    'script',
    '-qec',
    shell,
    '/dev/null',
  ]);

  setupSessionHandlers(ws, sessionId, containerId, '', user, workdir, process, false);
}

/**
 * Set up event handlers for a terminal session
 */
function setupSessionHandlers(
  ws: WebSocket,
  sessionId: string,
  containerId: string,
  tmuxSession: string,
  user: string,
  workdir: string,
  process: ChildProcess,
  isTmux: boolean
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

  sessions.set(sessionId, { process, ws, containerId, tmuxSession, user, workdir });

  // Persist session metadata for reconnection (only for tmux sessions)
  if (isTmux && tmuxSession) {
    setPersistedSession({
      sessionId,
      containerId,
      tmuxSession,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      user,
      workdir,
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
  // Look up the persisted session
  const persisted = getPersistedSession(oldSessionId);
  if (!persisted) {
    console.log(`[Terminal] No persisted session found for ${oldSessionId}`);
    return null;
  }

  const { containerId, tmuxSession, user, workdir } = persisted;

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
  // Also ensure status bar is hidden and resize to current dimensions
  const tmuxCmd = `tmux attach-session -t ${tmuxSession} \\; set-option status off \\; resize-window -x ${cols} -y ${rows}`;

  const process = spawn('docker', [
    'exec',
    '-i',
    '-u', user,
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

  sessions.set(sessionId, { process, ws, containerId, tmuxSession, user, workdir });

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
    await execAsync(`docker exec ${containerId} tmux resize-window -t ${tmuxSession} -x ${cols} -y ${rows}`);
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
  if (session && session.process.stdin?.writable) {
    // Always send stty through stdin - this sets the TTY size for the innermost shell
    // Ctrl+U clears current line, then stty sets dimensions, then clear refreshes display
    session.process.stdin.write(`\x15stty cols ${cols} rows ${rows} 2>/dev/null; clear\n`);

    if (session.tmuxSession) {
      // Also resize tmux window/pane via separate command for proper tmux handling
      execAsync(`docker exec ${session.containerId} tmux resize-window -t ${session.tmuxSession} -x ${cols} -y ${rows} 2>/dev/null`)
        .catch(() => { /* ignore errors */ });
    }

    console.log(`   Resized session ${sessionId}: ${cols}x${rows}`);
    return true;
  }
  return false;
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
