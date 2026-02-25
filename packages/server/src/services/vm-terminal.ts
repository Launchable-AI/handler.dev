/**
 * VM Terminal Service - SSH-based terminal sessions for VMs
 * Uses SSH to connect to VMs with tmux for persistent sessions.
 * When tmux is available in the VM, sessions survive WebSocket disconnects
 * and server restarts. Falls back to bare shell when tmux is not installed.
 */

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import { injectShellInit, getShellInitContent, getTmuxThemeContent } from './shell-init.js';
import { getConfig } from './config.js';
import { safeExec } from '../lib/safe-exec.js';
import {
  getSession as getPersistedSession,
  setSession as setPersistedSession,
  deleteSession as deletePersistedSession,
  listByVm,
} from './session-store.js';

interface VmTerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  vmId: string;
  tmuxSession?: string;
  vmIp?: string;
  dataDir?: string;
  lastCols?: number;
  lastRows?: number;
}

const sessions = new Map<string, VmTerminalSession>();

// Get SSH key path
// SSH keys are stored at dataDir/ssh-keys/id_ed25519
// dataDir should be the handler data directory (e.g., {PROJECT_ROOT}/data)
function getSshKeyPath(dataDir: string): string {
  return path.join(dataDir, 'ssh-keys', 'id_ed25519');
}

/** Common SSH options */
const SSH_OPTS = [
  '-o', 'IdentitiesOnly=yes',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'ConnectTimeout=3',
];

/**
 * Execute a command on a VM via SSH and return stdout.
 * Uses execFileAsync (no shell) — the command is passed as a single SSH
 * argument, so no local shell expansion can occur.
 */
async function sshExec(vmIp: string, dataDir: string, command: string): Promise<string> {
  const sshKeyPath = getSshKeyPath(dataDir);
  return safeExec('ssh', ['-i', sshKeyPath, ...SSH_OPTS, `agent@${vmIp}`, command], { timeout: 5000 });
}

/**
 * Generate a deterministic tmux session name for a VM.
 * Uses a stable name (no timestamp) so that reconnections and new connections
 * reuse the same tmux session via `tmux new-session -A`.
 */
function getVmTmuxSessionName(vmId: string): string {
  return `handler-${vmId.replace(/[.:]/g, '-')}`;
}

/**
 * Check if a tmux session exists in a VM
 */
async function vmTmuxSessionExists(vmIp: string, dataDir: string, tmuxSession: string): Promise<boolean> {
  try {
    await sshExec(vmIp, dataDir, `tmux has-session -t ${tmuxSession} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture scrollback from a tmux session in a VM
 */
async function captureVmTmuxScrollback(vmIp: string, dataDir: string, tmuxSession: string, lines: number = 1000): Promise<string> {
  try {
    return await sshExec(vmIp, dataDir, `tmux capture-pane -t ${tmuxSession} -p -S -${lines}`);
  } catch (err) {
    console.warn(`[VM Terminal] Failed to capture scrollback for ${tmuxSession}:`, err);
    return '';
  }
}

export function createVmTerminalSession(
  ws: WebSocket,
  vmId: string,
  vmIp: string,
  dataDir: string,
  shell: string = '/bin/bash',
  cols: number = 80,
  rows: number = 24
): string {
  const sessionId = `vm-${vmId}-${Date.now()}`;
  const sshKeyPath = getSshKeyPath(dataDir);

  console.log(`[VM Terminal] Creating session: ${sessionId} for VM ${vmId} at ${vmIp}`);
  console.log(`[VM Terminal] SSH key path: ${sshKeyPath}`);
  console.log(`[VM Terminal] Data dir: ${dataDir}`);

  if (!fs.existsSync(sshKeyPath)) {
    console.error(`[VM Terminal] SSH key not found at ${sshKeyPath}`);
    ws.send(JSON.stringify({ type: 'error', message: `SSH key not found at ${sshKeyPath}` }));
    return '';
  }

  console.log(`[VM Terminal] SSH key exists, connecting to ${vmIp}...`);

  // Start terminal — use a single SSH connection that tries tmux inline
  // and falls back to a bare shell if tmux isn't installed. This avoids
  // a separate SSH round-trip just to check `which tmux`.
  getConfig().then(config => {
    if (config.tmuxEnabled === false) {
      console.log(`[VM Terminal] tmux disabled in config, using bare shell`);
      startVmBareSession(ws, sessionId, vmId, vmIp, dataDir, sshKeyPath, shell, cols, rows);
    } else {
      startVmTmuxWithFallback(ws, sessionId, vmId, vmIp, dataDir, sshKeyPath, shell, cols, rows, config.tmuxStatusBar);
    }
  }).catch(() => {
    startVmBareSession(ws, sessionId, vmId, vmIp, dataDir, sshKeyPath, shell, cols, rows);
  });

  return sessionId;
}

/** Markers emitted by the remote command for tmux state detection */
const TMUX_MARKER = '__HANDLER_TMUX_ACTIVE__';
const TMUX_DETACHED_MARKER = '__HANDLER_TMUX_DETACHED__';
const TMUX_UNAVAILABLE_MARKER = '__HANDLER_TMUX_UNAVAILABLE__';

/**
 * Start a VM terminal session that tries tmux and falls back to a bare
 * shell — all in a single SSH connection.
 *
 * The shell init (prompt theme, aliases, OSC tracking) is written to a
 * file on the remote VM and sourced from .bashrc, so it's invisible —
 * no stdin echo jank. Tmux state is detected via stdout markers:
 * ACTIVE (connected to tmux), DETACHED (tmux exited/detached, back to
 * bare shell), UNAVAILABLE (tmux not installed).
 */
async function startVmTmuxWithFallback(
  ws: WebSocket,
  sessionId: string,
  vmId: string,
  vmIp: string,
  dataDir: string,
  sshKeyPath: string,
  shell: string,
  cols: number,
  rows: number,
  tmuxStatusBar?: boolean
): Promise<void> {
  const tmuxSession = getVmTmuxSessionName(vmId);

  // Get the shell init content and tmux theme to embed in the remote command
  const config = await getConfig();
  const initContent = await getShellInitContent();
  const theme = config.shellPromptTheme || 'minimal';
  const tmuxThemeContent = getTmuxThemeContent(theme, !!tmuxStatusBar);

  // Build a multi-line remote command that:
  // 1. Writes the shell init to ~/.config/handler/prompt.sh (invisible — no stdin echo)
  // 2. Writes the tmux status bar theme to ~/.config/handler/tmux-theme.conf
  // 3. Ensures .bashrc sources the shell init (so new shells/tmux panes inherit it)
  // 4. Sets PTY dimensions
  // 5. Tries tmux with markers for detection, falls back to bare shell
  const remoteCmd = [
    // Write init files using heredocs (quoted delimiter = no variable expansion)
    `mkdir -p ~/.config/handler`,
    `cat > ~/.config/handler/prompt.sh << 'HANDLER_INIT_EOF'\n${initContent}\nHANDLER_INIT_EOF`,
    `cat > ~/.config/handler/tmux-theme.conf << 'HANDLER_TMUX_EOF'\n${tmuxThemeContent}\nHANDLER_TMUX_EOF`,
    // Ensure .bashrc sources the init file
    `grep -q 'handler/prompt.sh' ~/.bashrc 2>/dev/null || echo '[ -f ~/.config/handler/prompt.sh ] && source ~/.config/handler/prompt.sh' >> ~/.bashrc`,
    // Set terminal dimensions
    `stty cols ${cols} rows ${rows} 2>/dev/null`,
    // Try tmux without exec so parent shell continues after detach/exit.
    // When tmux exits (detach or last pane closed), emit DETACHED marker and fall back to bare shell.
    // If tmux isn't installed, emit UNAVAILABLE marker and use bare shell directly.
    `if command -v tmux >/dev/null 2>&1; then echo ${TMUX_MARKER}; tmux new-session -A -s ${tmuxSession} -x ${cols} -y ${rows} ${shell} ';' source-file ~/.config/handler/tmux-theme.conf; echo ${TMUX_DETACHED_MARKER}; exec ${shell}; else echo ${TMUX_UNAVAILABLE_MARKER}; exec ${shell}; fi`,
  ].join('\n');

  const sshArgs = [
    '-tt',
    '-i', sshKeyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    `agent@${vmIp}`,
    remoteCmd
  ];

  const sshProcess = spawn('ssh', sshArgs, {
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  // Don't pass tmuxSession yet — we'll detect it via the stderr marker
  setupVmSessionHandlers(ws, sessionId, vmId, vmIp, dataDir, undefined, sshProcess, tmuxSession);

  // Clean up old persisted sessions for this VM, then persist the new one
  for (const old of listByVm(vmId)) {
    deletePersistedSession(old.sessionId);
  }

  setPersistedSession({
    sessionId,
    tmuxSession,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    user: 'agent',
    workdir: '/home/agent',
    vmId,
    vmIp,
    dataDir,
  });

  console.log(`[VM Terminal] Started session (tmux with fallback): ${tmuxSession}`);
}

/**
 * Start a bare shell VM terminal session (fallback when tmux unavailable)
 */
function startVmBareSession(
  ws: WebSocket,
  sessionId: string,
  vmId: string,
  vmIp: string,
  dataDir: string,
  sshKeyPath: string,
  shell: string,
  cols: number,
  rows: number
): void {
  const sshArgs = [
    '-tt',
    '-i', sshKeyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    `agent@${vmIp}`,
    shell
  ];

  const sshProcess = spawn('ssh', sshArgs, {
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  setupVmSessionHandlers(ws, sessionId, vmId, vmIp, dataDir, undefined, sshProcess);
}

/**
 * Set up event handlers for a VM terminal session
 */
function setupVmSessionHandlers(
  ws: WebSocket,
  sessionId: string,
  vmId: string,
  vmIp: string,
  dataDir: string,
  tmuxSession: string | undefined,
  sshProcess: ChildProcess,
  pendingTmuxSession?: string // tmux session name to detect via stderr marker
): void {
  // SSH -tt merges stdout/stderr through the PTY, so all markers arrive on stdout
  sshProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    let str = data.toString();

    // Check for tmux state markers and strip them from output
    if (pendingTmuxSession) {
      if (str.includes(TMUX_MARKER)) {
        // tmux is available and we're connecting to it
        const session = sessions.get(sessionId);
        if (session) {
          session.tmuxSession = pendingTmuxSession;
        }
        ws.send(JSON.stringify({ type: 'session-update', tmuxState: 'connected' }));
        str = str.replace(new RegExp(`\\r?\\n?${TMUX_MARKER}\\r?\\n?`), '');
        if (!str) return;
      }

      if (str.includes(TMUX_DETACHED_MARKER)) {
        // tmux exited (user detached or closed all panes) — back to bare shell
        ws.send(JSON.stringify({ type: 'session-update', tmuxState: 'detached' }));
        str = str.replace(new RegExp(`\\r?\\n?${TMUX_DETACHED_MARKER}\\r?\\n?`), '');
        if (!str) return;
      }

      if (str.includes(TMUX_UNAVAILABLE_MARKER)) {
        // tmux is not installed
        ws.send(JSON.stringify({ type: 'session-update', tmuxState: 'unavailable' }));
        str = str.replace(new RegExp(`\\r?\\n?${TMUX_UNAVAILABLE_MARKER}\\r?\\n?`), '');
        if (!str) return;
      }
    }

    ws.send(JSON.stringify({ type: 'output', data: str }));
  });

  sshProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[VM Terminal] SSH stderr: ${data.toString()}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.on('exit', (code) => {
    console.log(`[VM Terminal] Session ${sessionId} exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
  });

  sshProcess.on('error', (err) => {
    console.error(`[VM Terminal] Session ${sessionId} error:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  // Prevent uncaught EPIPE if stdin closes between writable check and write
  sshProcess.stdin?.on('error', () => {});

  sessions.set(sessionId, { process: sshProcess, ws, vmId, tmuxSession, vmIp, dataDir });

  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    tmuxSession: tmuxSession || undefined,
  }));

  // Only inject shell init via stdin if init wasn't embedded in the remote command
  if (!pendingTmuxSession) {
    injectShellInit(sshProcess);
  }
}

/**
 * Resume an existing VM tmux session
 * Returns the new sessionId and scrollback if successful, or null if session doesn't exist
 */
export async function resumeVmTerminalSession(
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

  const persisted = getPersistedSession(oldSessionId);
  if (!persisted || !persisted.vmId || !persisted.vmIp || !persisted.dataDir) {
    console.log(`[VM Terminal] No persisted VM session found for ${oldSessionId}`);
    return null;
  }

  const { vmId, vmIp, dataDir, tmuxSession } = persisted;
  const sshKeyPath = getSshKeyPath(dataDir);

  if (!fs.existsSync(sshKeyPath)) {
    console.log(`[VM Terminal] SSH key not found for resume: ${sshKeyPath}`);
    deletePersistedSession(oldSessionId);
    return null;
  }

  // Check if the tmux session still exists in the VM
  const exists = await vmTmuxSessionExists(vmIp, dataDir, tmuxSession);
  if (!exists) {
    console.log(`[VM Terminal] tmux session ${tmuxSession} no longer exists in VM ${vmId}`);
    deletePersistedSession(oldSessionId);
    return null;
  }

  // Capture scrollback before reattaching
  const scrollback = await captureVmTmuxScrollback(vmIp, dataDir, tmuxSession);

  // Create new session ID for this connection
  const sessionId = `vm-${vmId}-${Date.now()}`;
  console.log(`[VM Terminal] Resuming session: ${sessionId} (tmux: ${tmuxSession})`);

  // Write the tmux theme conf and source it on attach.
  // stty ensures tmux sees the correct client dimensions on reattach.
  const theme = config.shellPromptTheme || 'minimal';
  const tmuxThemeContent = getTmuxThemeContent(theme, config.tmuxStatusBar === true);
  const remoteCmd = [
    `mkdir -p ~/.config/handler`,
    `cat > ~/.config/handler/tmux-theme.conf << 'HANDLER_TMUX_EOF'\n${tmuxThemeContent}\nHANDLER_TMUX_EOF`,
    `stty cols ${cols} rows ${rows} 2>/dev/null`,
    `exec tmux attach-session -t ${tmuxSession} ';' source-file ~/.config/handler/tmux-theme.conf`,
  ].join('\n');

  const sshArgs = [
    '-tt',
    '-i', sshKeyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    `agent@${vmIp}`,
    remoteCmd
  ];

  const sshProcess = spawn('ssh', sshArgs, {
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  sshProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[VM Terminal] SSH stderr: ${data.toString()}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.on('exit', (code) => {
    console.log(`[VM Terminal] Resumed session ${sessionId} exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
  });

  sshProcess.on('error', (err) => {
    console.error(`[VM Terminal] Resumed session ${sessionId} error:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { process: sshProcess, ws, vmId, tmuxSession, vmIp, dataDir });

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

  ws.send(JSON.stringify({ type: 'connected', sessionId, tmuxSession, resumed: true }));

  return { sessionId, scrollback };
}

export function writeToVmSession(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId);
  if (session && session.process.stdin?.writable) {
    try {
      session.process.stdin.write(data);
      return true;
    } catch {
      // EPIPE — process stdin closed between writable check and write
      return false;
    }
  }
  return false;
}

export function resizeVmSession(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // Skip if dimensions haven't changed
  if (session.lastCols === cols && session.lastRows === rows) return true;
  session.lastCols = cols;
  session.lastRows = rows;

  if (session.tmuxSession && session.vmIp && session.dataDir) {
    // For tmux sessions: resize the SSH PTY that tmux is attached to.
    // Find the client's TTY via tmux, then use stty -F to resize it.
    // The kernel sends SIGWINCH to tmux, which auto-resizes its windows.
    // This avoids writing visible stty/clear commands into the shell.
    const { vmIp, dataDir, tmuxSession } = session;
    sshExec(vmIp, dataDir,
      `PTY=$(tmux list-clients -t ${tmuxSession} -F '#{client_tty}' | head -1) && [ -n "$PTY" ] && stty -F $PTY cols ${cols} rows ${rows}`
    ).catch(() => { /* ignore errors */ });

    console.log(`[VM Terminal] Resized session ${sessionId}: ${cols}x${rows}`);
    return true;
  } else if (session.process.stdin?.writable) {
    // For non-tmux sessions: use stty through stdin (changes the SSH PTY directly)
    session.process.stdin.write(`\x15stty cols ${cols} rows ${rows} 2>/dev/null\n`);
    console.log(`[VM Terminal] Resized session ${sessionId}: ${cols}x${rows}`);
    return true;
  }
  return false;
}

export function closeVmSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    if (!session.process.killed) {
      session.process.kill();
    }
    sessions.delete(sessionId);
    console.log(`[VM Terminal] Closed session ${sessionId}`);
  }
}

export function closeVmSessionByWebSocket(ws: WebSocket): void {
  for (const [id, session] of sessions.entries()) {
    if (session.ws === ws) {
      if (session.tmuxSession) {
        // For tmux sessions: detach cleanly, the tmux session continues in the VM
        if (session.process.stdin?.writable) {
          session.process.stdin.write('\x02d'); // Ctrl+B followed by 'd' to detach
        }
        setTimeout(() => {
          if (!session.process.killed) {
            session.process.kill('SIGTERM');
          }
        }, 100);
        console.log(`[VM Terminal] Detached from tmux session ${session.tmuxSession} (session preserved for reconnection)`);
      } else {
        // For non-tmux sessions: kill the process
        if (!session.process.killed) {
          session.process.kill();
        }
        console.log(`[VM Terminal] Closed session ${id} due to WebSocket disconnect`);
      }
      sessions.delete(id);
      break;
    }
  }
}

export function getActiveVmSessionCount(): number {
  return sessions.size;
}

/**
 * Apply tmux status bar theme to all active tmux sessions.
 * For "off": sends a direct `tmux set -g status off` (simple, reliable).
 * For "on": writes the themed conf file and sources it via tmux source-file.
 */
export async function applyTmuxStatusBar(show: boolean): Promise<void> {
  const config = await getConfig();
  const theme = config.shellPromptTheme || 'minimal';

  for (const [id, session] of sessions.entries()) {
    if (session.tmuxSession && session.vmIp && session.dataDir) {
      let cmd: string;
      if (!show) {
        // Direct tmux command — simple and reliable for hiding the bar
        cmd = `tmux set -g status off; mkdir -p ~/.config/handler && echo 'set -g status off' > ~/.config/handler/tmux-theme.conf`;
      } else {
        // Write themed config and source it
        const tmuxThemeContent = getTmuxThemeContent(theme, true);
        const encoded = Buffer.from(tmuxThemeContent).toString('base64');
        cmd = `mkdir -p ~/.config/handler && echo ${encoded} | base64 -d > ~/.config/handler/tmux-theme.conf && tmux source-file ~/.config/handler/tmux-theme.conf`;
      }
      sshExec(session.vmIp, session.dataDir, cmd)
        .then(() => console.log(`[VM Terminal] Applied tmux theme (status ${show ? 'on' : 'off'}) for session ${id}`))
        .catch((err) => console.warn(`[VM Terminal] Failed to apply tmux theme for session ${id}:`, err.message || err));
    }
  }
}

/**
 * Create a Daytona terminal session using their SSH access API
 * Daytona provides a full SSH command with embedded credentials
 */
export function createDaytonaTerminalSession(
  ws: WebSocket,
  sandboxId: string,
  sshCommand: string,
  cols: number = 80,
  rows: number = 24
): string {
  const sessionId = `daytona-${sandboxId}-${Date.now()}`;

  console.log(`[Daytona Terminal] Creating session: ${sessionId}`);
  console.log(`[Daytona Terminal] Original SSH command: ${sshCommand}`);

  // Inject -tt flag to force pseudo-terminal allocation even without a TTY on stdin
  // Daytona SSH commands look like: ssh -o 'ProxyCommand=...' user@host
  // We insert -tt right after 'ssh' to force TTY allocation
  let modifiedCommand = sshCommand;
  if (sshCommand.startsWith('ssh ') && !sshCommand.includes(' -tt ')) {
    modifiedCommand = sshCommand.replace(/^ssh /, 'ssh -tt ');
  }

  console.log(`[Daytona Terminal] Modified SSH command: ${modifiedCommand}`);

  // Run through shell to handle complex quoting in ProxyCommand
  const sshProcess = spawn('sh', ['-c', modifiedCommand], {
    env: {
      ...process.env,
      TERM: 'xterm-256color',
    }
  });

  // Handle process output -> WebSocket
  sshProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[Daytona Terminal] SSH stderr: ${data.toString()}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  // Handle process exit
  sshProcess.on('exit', (code) => {
    console.log(`[Daytona Terminal] Session ${sessionId} exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
  });

  sshProcess.on('error', (err) => {
    console.error(`[Daytona Terminal] Session ${sessionId} error:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  // Prevent uncaught EPIPE if stdin closes between writable check and write
  sshProcess.stdin?.on('error', () => {});

  sessions.set(sessionId, { process: sshProcess, ws, vmId: sandboxId });

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  // Inject shell init (PROMPT_COMMAND for real-time cwd/branch tracking)
  injectShellInit(sshProcess);

  return sessionId;
}

/**
 * Create an AWS terminal session using SSH with the stored private key
 * AWS instances are accessed via SSH to the ubuntu user
 */
export function createAwsTerminalSession(
  ws: WebSocket,
  instanceId: string,
  publicIp: string,
  sshPrivateKey: string,
  cols: number = 80,
  rows: number = 24
): string {
  const sessionId = `aws-${instanceId}-${Date.now()}`;

  console.log(`[AWS Terminal] Creating session: ${sessionId}`);
  console.log(`[AWS Terminal] Connecting to ${publicIp}`);

  // Write the private key to a temporary file
  const tempDir = fs.mkdtempSync('/tmp/aws-terminal-');
  const keyPath = `${tempDir}/key.pem`;
  fs.writeFileSync(keyPath, sshPrivateKey, { mode: 0o600 });

  // SSH command arguments
  const sshArgs = [
    '-tt',                                    // Force PTY allocation
    '-i', keyPath,                            // SSH key
    '-o', 'IdentitiesOnly=yes',               // Only use specified key, not agent keys
    '-o', 'StrictHostKeyChecking=no',         // Don't prompt for host key
    '-o', 'UserKnownHostsFile=/dev/null',     // Don't save host keys
    '-o', 'ConnectTimeout=10',                // Connection timeout
    '-o', 'ServerAliveInterval=30',           // Keep-alive
    '-o', 'ServerAliveCountMax=3',            // Keep-alive retries
    `ubuntu@${publicIp}`,
    '/bin/bash'
  ];

  console.log(`[AWS Terminal] SSH command: ssh ${sshArgs.join(' ')}`);

  const sshProcess = spawn('ssh', sshArgs, {
    env: {
      ...process.env,
      TERM: 'xterm-256color',
    }
  });

  // Handle process output -> WebSocket
  sshProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[AWS Terminal] SSH stderr: ${data.toString()}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  // Handle process exit
  sshProcess.on('exit', (code) => {
    console.log(`[AWS Terminal] Session ${sessionId} exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
    // Clean up temp key file
    try {
      fs.unlinkSync(keyPath);
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  sshProcess.on('error', (err) => {
    console.error(`[AWS Terminal] Session ${sessionId} error:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
    // Clean up temp key file
    try {
      fs.unlinkSync(keyPath);
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  // Prevent uncaught EPIPE if stdin closes between writable check and write
  sshProcess.stdin?.on('error', () => {});

  sessions.set(sessionId, { process: sshProcess, ws, vmId: instanceId });

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  // Inject shell init (PROMPT_COMMAND for real-time cwd/branch tracking)
  injectShellInit(sshProcess);

  return sessionId;
}

/**
 * Create a generic cloud terminal session using SSH with a private key
 * Works for Azure, GCP, DigitalOcean, Linode, etc.
 */
export function createCloudTerminalSession(
  ws: WebSocket,
  instanceId: string,
  publicIp: string,
  sshPrivateKey: string,
  sshUser: string = 'root',
  cols: number = 80,
  rows: number = 24
): string {
  const sessionId = `cloud-${instanceId}-${Date.now()}`;

  console.log(`[Cloud Terminal] Creating session: ${sessionId}`);
  console.log(`[Cloud Terminal] Connecting to ${sshUser}@${publicIp}`);

  // Write the private key to a temporary file
  const tempDir = fs.mkdtempSync('/tmp/cloud-terminal-');
  const keyPath = `${tempDir}/key.pem`;
  fs.writeFileSync(keyPath, sshPrivateKey, { mode: 0o600 });

  const sshArgs = [
    '-tt',
    '-i', keyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    `${sshUser}@${publicIp}`,
    '/bin/bash'
  ];

  const sshProcess = spawn('ssh', sshArgs, {
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  sshProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[Cloud Terminal] SSH stderr: ${data.toString()}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  sshProcess.on('exit', (code) => {
    console.log(`[Cloud Terminal] Session ${sessionId} exited with code ${code}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
    try { fs.unlinkSync(keyPath); fs.rmdirSync(tempDir); } catch { /* ignore */ }
  });

  sshProcess.on('error', (err) => {
    console.error(`[Cloud Terminal] Session ${sessionId} error:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
    try { fs.unlinkSync(keyPath); fs.rmdirSync(tempDir); } catch { /* ignore */ }
  });

  // Prevent uncaught EPIPE if stdin closes between writable check and write
  sshProcess.stdin?.on('error', () => {});

  sessions.set(sessionId, { process: sshProcess, ws, vmId: instanceId });
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  // Inject shell init (PROMPT_COMMAND for real-time cwd/branch tracking)
  injectShellInit(sshProcess);

  return sessionId;
}

export function getVmSession(sessionId: string): VmTerminalSession | undefined {
  return sessions.get(sessionId);
}

export function closeAllVmSessions(): void {
  console.log(`[VM Terminal] Closing ${sessions.size} active session(s)...`);
  for (const [id, session] of sessions.entries()) {
    if (session.tmuxSession) {
      // Detach cleanly from tmux so sessions persist in VMs
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
