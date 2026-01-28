/**
 * VM Terminal Service - SSH-based terminal sessions for VMs
 * Uses SSH to connect to VMs instead of docker exec
 */

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';

interface VmTerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  vmId: string;
}

const sessions = new Map<string, VmTerminalSession>();

// Get SSH key path
// SSH keys are stored at dataDir/ssh-keys/id_ed25519
// dataDir should be the caisson data directory (e.g., ~/.local/share/caisson)
function getSshKeyPath(dataDir: string): string {
  return path.join(dataDir, 'ssh-keys', 'id_ed25519');
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

  // Use SSH to connect to the VM
  // The -tt forces pseudo-terminal allocation
  const sshArgs = [
    '-tt',                                    // Force PTY allocation
    '-i', sshKeyPath,                         // SSH key
    '-o', 'IdentitiesOnly=yes',               // Only use specified key, not agent keys
    '-o', 'StrictHostKeyChecking=no',         // Don't prompt for host key
    '-o', 'UserKnownHostsFile=/dev/null',     // Don't save host keys
    '-o', 'ConnectTimeout=10',                // Connection timeout
    '-o', 'ServerAliveInterval=30',           // Keep-alive
    '-o', 'ServerAliveCountMax=3',            // Keep-alive retries
    `agent@${vmIp}`,
    shell
  ];

  console.log(`[VM Terminal] SSH command: ssh ${sshArgs.join(' ')}`);

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
    console.log(`[VM Terminal] SSH stderr: ${data.toString()}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  // Handle process exit
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

  sessions.set(sessionId, { process: sshProcess, ws, vmId });

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  return sessionId;
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
  if (session && session.process.stdin?.writable) {
    // Send resize escape sequence for SSH PTY
    // Using stty command through the shell
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
      if (!session.process.killed) {
        session.process.kill();
      }
      sessions.delete(id);
      console.log(`[VM Terminal] Closed session ${id} due to WebSocket disconnect`);
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

  return sessionId;
}

export function closeAllVmSessions(): void {
  console.log(`[VM Terminal] Closing ${sessions.size} active session(s)...`);
  for (const [id, session] of sessions.entries()) {
    if (!session.process.killed) {
      session.process.kill();
    }
    sessions.delete(id);
  }
}
