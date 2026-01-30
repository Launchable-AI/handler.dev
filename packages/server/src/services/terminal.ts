/**
 * Terminal Service - WebSocket-based terminal sessions
 * Uses docker exec with 'script' command for PTY emulation (no native modules needed)
 */

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { injectShellInit } from './shell-init.js';


interface TerminalSession {
  process: ChildProcess;
  ws: WebSocket;
  containerId: string;
}

const sessions = new Map<string, TerminalSession>();

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

  console.log(`🔧 Creating terminal session: ${sessionId} (isDevNode: ${isDevNode}, workdir: ${customWorkdir || 'default'})`);

  // For dev-node containers: connect as 'dev' user in /home/dev/workspace
  // For other containers: connect as 'root' in /root
  const user = isDevNode ? 'dev' : 'root';
  const workdir = customWorkdir || (isDevNode ? '/home/dev/workspace' : '/root');

  // Use docker exec with 'script' to create a pseudo-TTY
  // This avoids needing node-pty native module
  const process = spawn('docker', [
    'exec',
    '-i',                        // Interactive mode
    '-u', user,                  // Run as dev user for dev-node, root otherwise
    '-e', 'TERM=xterm-256color', // Set terminal type
    '-e', `COLUMNS=${cols}`,     // Terminal width
    '-e', `LINES=${rows}`,       // Terminal height
    '-w', workdir,               // Start in appropriate directory
    containerId,
    'script',                    // Use script for PTY emulation
    '-qec',                      // Quiet, execute command
    shell,
    '/dev/null',                 // Output to /dev/null (we capture via stdout)
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

  // Handle process exit
  process.on('exit', (code) => {
    console.log(`   Shell exited with code ${code} for session ${sessionId}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
    sessions.delete(sessionId);
  });

  process.on('error', (err) => {
    console.error(`   Process error for session ${sessionId}:`, err);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { process, ws, containerId });

  // Send connected message
  ws.send(JSON.stringify({ type: 'connected', sessionId }));

  // Inject shell init (PROMPT_COMMAND for real-time cwd/branch tracking)
  injectShellInit(process);

  return sessionId;
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
    // Send resize command silently using subshell and clear
    // \x15 (Ctrl+U) clears the current line before command
    // The command runs in background and clears output after
    session.process.stdin.write(`\x15stty cols ${cols} rows ${rows} 2>/dev/null; clear\n`);
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
  }
}

export function closeSessionByWebSocket(ws: WebSocket): void {
  for (const [id, session] of sessions.entries()) {
    if (session.ws === ws) {
      if (!session.process.killed) {
        session.process.kill();
      }
      sessions.delete(id);
      console.log(`   Closed session ${id} due to WebSocket disconnect`);
      break;
    }
  }
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function closeAllSessions(): void {
  console.log(`[Terminal] Closing ${sessions.size} active session(s)...`);
  for (const [id, session] of sessions.entries()) {
    if (!session.process.killed) {
      session.process.kill();
    }
    sessions.delete(id);
  }
}
