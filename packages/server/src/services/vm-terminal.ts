/**
 * VM Terminal Service - SSH-based terminal sessions for VMs
 * Uses SSH to connect to VMs with tmux for persistent sessions.
 * When tmux is available in the VM, sessions survive WebSocket disconnects
 * and server restarts. Falls back to bare shell when tmux is not installed.
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import { WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import { injectShellInit } from './shell-init.js';
import { getConfig } from './config.js';
import {
  getSession as getPersistedSession,
  setSession as setPersistedSession,
  deleteSession as deletePersistedSession,
  listByVm,
} from './session-store.js';

const execAsync = promisify(exec);

interface VmTerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  vmId: string;
  tmuxSession?: string;
  vmIp?: string;
  dataDir?: string;
}

const sessions = new Map<string, VmTerminalSession>();

// Get SSH key path
// SSH keys are stored at dataDir/ssh-keys/id_ed25519
// dataDir should be the handler data directory (e.g., ~/.local/share/handler)
function getSshKeyPath(dataDir: string): string {
  return path.join(dataDir, 'ssh-keys', 'id_ed25519');
}

/**
 * Execute a command on a VM via SSH and return stdout.
 * Uses single-quote escaping so the local shell passes the command
 * literally to SSH — $() and other expansions run on the remote VM, not locally.
 */
async function sshExec(vmIp: string, dataDir: string, command: string): Promise<string> {
  const sshKeyPath = getSshKeyPath(dataDir);
  const escaped = command.replace(/'/g, "'\\''");
  const { stdout } = await execAsync(
    `ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 agent@${vmIp} '${escaped}'`,
    { timeout: 10000 }
  );
  return stdout;
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
 * Check if tmux is available in a VM
 */
async function hasTmuxInVm(vmIp: string, dataDir: string): Promise<boolean> {
  try {
    await sshExec(vmIp, dataDir, 'which tmux');
    return true;
  } catch {
    return false;
  }
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

  // Check if tmux is enabled in config and available in VM
  getConfig().then(config => {
    if (config.tmuxEnabled === false) {
      console.log(`[VM Terminal] tmux disabled in config, using bare shell`);
      startVmBareSession(ws, sessionId, vmId, vmIp, dataDir, sshKeyPath, shell, cols, rows);
      return;
    }

    return hasTmuxInVm(vmIp, dataDir).then(useTmux => {
      if (useTmux) {
        startVmTmuxSession(ws, sessionId, vmId, vmIp, dataDir, sshKeyPath, shell, cols, rows);
      } else {
        console.log(`[VM Terminal] tmux not available in VM ${vmId}, falling back to bare shell`);
        startVmBareSession(ws, sessionId, vmId, vmIp, dataDir, sshKeyPath, shell, cols, rows);
      }
    });
  }).catch(() => {
    startVmBareSession(ws, sessionId, vmId, vmIp, dataDir, sshKeyPath, shell, cols, rows);
  });

  return sessionId;
}

/**
 * Start a tmux-based VM terminal session.
 *
 * Sets the SSH PTY size with stty BEFORE starting tmux so tmux sees
 * the correct client dimensions from the start. Uses `exec` to replace
 * the shell with tmux so SIGHUP goes directly to tmux on disconnect.
 *
 * The tmux command separator ';' is single-quoted so the remote shell
 * passes it literally to tmux instead of treating it as a command separator.
 */
function startVmTmuxSession(
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
  const tmuxSession = getVmTmuxSessionName(vmId);

  // stty sets the SSH PTY dimensions, then exec replaces the shell with tmux.
  // -A reattaches if the session already exists (deterministic name per VM).
  const remoteCmd = `stty cols ${cols} rows ${rows} 2>/dev/null; exec tmux new-session -A -s ${tmuxSession} -x ${cols} -y ${rows} ${shell} ';' set-option status off`;

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

  setupVmSessionHandlers(ws, sessionId, vmId, vmIp, dataDir, tmuxSession, sshProcess);

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

  console.log(`[VM Terminal] Started tmux session: ${tmuxSession}`);
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
  sshProcess: ChildProcess
): void {
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

  sessions.set(sessionId, { process: sshProcess, ws, vmId, tmuxSession, vmIp, dataDir });

  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    tmuxSession: tmuxSession || undefined,
  }));

  injectShellInit(sshProcess);
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

  // Set SSH PTY size then exec into tmux attach.
  // stty ensures tmux sees the correct client dimensions on reattach.
  const remoteCmd = `stty cols ${cols} rows ${rows} 2>/dev/null; exec tmux attach-session -t ${tmuxSession} ';' set-option status off`;

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
    session.process.stdin.write(data);
    return true;
  }
  return false;
}

export function resizeVmSession(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

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
    session.process.stdin.write(`\x15stty cols ${cols} rows ${rows} 2>/dev/null; clear\n`);
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
