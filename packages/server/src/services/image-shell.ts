/**
 * Image Shell Service
 *
 * Provides interactive shell access into VM image filesystems via
 * loop-mount + chroot. This lets developers inspect and modify
 * rootfs.ext4 images directly from the UI.
 *
 * Mount flow:
 * 1. Check if mount point already exists (user may have mounted manually)
 * 2. If not mounted, try `sudo -n mount` (non-interactive)
 * 3. If sudo fails, show the exact mount command for the user to run
 *    in their terminal, then they can click Shell again
 * 4. Once mounted, spawn chroot shell (sudo -n) or fall back to a
 *    plain shell cd'd to the mount point
 *
 * Dev-only: gated by environment=development at the route level.
 */

import { spawn, ChildProcess, execFileSync } from 'child_process';
import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../lib/paths.js';

const BASE_IMAGES_DIR = path.join(DATA_DIR, 'base-images');

interface ImageShellSession {
  id: string;
  imageName: string;
  mountPoint: string;
  selfMounted: boolean;
  process: ChildProcess;
  ws: WebSocket;
}

const activeSessions = new Map<string, ImageShellSession>();

/**
 * Check if a path is currently a mount point by reading /proc/mounts.
 */
function isMounted(mountPoint: string): boolean {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf-8');
    return mounts.split('\n').some(line => {
      const parts = line.split(' ');
      return parts[1] === mountPoint;
    });
  } catch {
    return false;
  }
}

/**
 * Create a shell session into an image's rootfs via loop mount + chroot.
 *
 * Uses a stable mount point per image so that manual mounts persist
 * across Shell button clicks. If sudo is unavailable, shows the
 * mount command for the user to run manually.
 */
export function createImageShellSession(
  imageName: string,
  ws: WebSocket,
  cols: number,
  rows: number,
): string {
  const imageDir = path.join(BASE_IMAGES_DIR, imageName);
  const rootfsPath = path.join(imageDir, 'rootfs.ext4');
  const layerPath = path.join(imageDir, 'layer.ext4');

  // Prefer rootfs.ext4, fall back to layer.ext4
  let mountTarget: string;
  let isLayer = false;
  if (fs.existsSync(rootfsPath)) {
    mountTarget = rootfsPath;
  } else if (fs.existsSync(layerPath)) {
    mountTarget = layerPath;
    isLayer = true;
  } else {
    throw new Error(`No mountable filesystem found for image '${imageName}' (need rootfs.ext4 or layer.ext4)`);
  }

  // Stable mount point (no timestamp) so manual mounts persist across retries
  const mountPoint = `/tmp/handler-image-${imageName}`;
  let selfMounted = false;

  if (!isMounted(mountPoint)) {
    // Ensure mount point directory exists
    fs.mkdirSync(mountPoint, { recursive: true });

    try {
      // Try non-interactive sudo mount
      execFileSync('sudo', ['-n', 'mount', '-o', 'loop', mountTarget, mountPoint], {
        timeout: 30000,
      });
      selfMounted = true;
    } catch {
      // sudo failed — show the command for the user to run manually
      // Clean up empty mount point
      try { fs.rmdirSync(mountPoint); } catch { /* ignore */ }

      const mountCmd = `sudo mount -o loop ${mountTarget} ${mountPoint}`;
      const umountCmd = `sudo umount ${mountPoint}`;
      throw new Error(
        `Mount requires sudo. Run this in your terminal, then click Shell again:\n\n` +
        `  ${mountCmd}\n\n` +
        `To unmount later:\n` +
        `  ${umountCmd}`
      );
    }
  }

  // Mount is available — create shell session
  const sessionId = `image-${imageName}-${Date.now()}`;

  // Try chroot via sudo -n, fall back to plain shell at mount point
  let shellProcess: ChildProcess;
  let usingChroot = false;

  try {
    execFileSync('sudo', ['-n', 'true'], { timeout: 5000 });
    shellProcess = spawn('sudo', [
      '-n', 'chroot', mountPoint, '/bin/bash',
    ], {
      env: { TERM: 'xterm-256color', HOME: '/root', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    usingChroot = true;
  } catch {
    // sudo not available — fall back to plain shell at mount point
    shellProcess = spawn('bash', ['-i'], {
      cwd: mountPoint,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  const session: ImageShellSession = {
    id: sessionId,
    imageName,
    mountPoint,
    selfMounted,
    process: shellProcess,
    ws,
  };
  activeSessions.set(sessionId, session);

  // Wire stdout to WebSocket
  shellProcess.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  // Wire stderr to WebSocket (merged into output)
  shellProcess.stderr?.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  // Handle process exit
  shellProcess.on('close', (code) => {
    cleanupSession(sessionId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
  });

  shellProcess.on('error', (err) => {
    console.error(`[Image Shell] Process error for ${imageName}:`, err);
    cleanupSession(sessionId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  // Send connected message
  const layerNote = isLayer ? ' [layer — partial filesystem, parent not merged]' : '';
  const modeNote = usingChroot ? 'chroot' : `shell at ${mountPoint}`;
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    message: `Shell into ${imageName} (${modeNote})${layerNote}`,
  }));

  return sessionId;
}

/**
 * Write data to an image shell session.
 */
export function writeToImageShell(sessionId: string, data: string): void {
  const session = activeSessions.get(sessionId);
  if (session?.process.stdin?.writable) {
    session.process.stdin.write(data);
  }
}

/**
 * Resize not directly supported for chroot (no PTY), but we can
 * send SIGWINCH if we get a PTY wrapper in the future.
 */
export function resizeImageShell(_sessionId: string, _cols: number, _rows: number): void {
  // No-op for now — chroot without PTY doesn't support resize
}

/**
 * Clean up a session: kill process, unmount (if we mounted), remove mount point.
 */
function cleanupSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  activeSessions.delete(sessionId);

  // Kill the process if still running
  try {
    if (!session.process.killed) {
      session.process.kill('SIGTERM');
    }
  } catch { /* ignore */ }

  // Only unmount if we were the ones who mounted it
  if (session.selfMounted) {
    try {
      execFileSync('sudo', ['-n', 'umount', session.mountPoint], { timeout: 30000 });
    } catch (err) {
      console.warn(`[Image Shell] Failed to unmount ${session.mountPoint}:`, err);
    }

    // Remove mount point (only if we created it)
    try {
      fs.rmdirSync(session.mountPoint);
    } catch { /* ignore */ }
  }

  console.log(`[Image Shell] Cleaned up session ${sessionId} for ${session.imageName}`);
}

/**
 * Close a session by WebSocket reference (called on WS disconnect).
 */
export function closeImageShellByWebSocket(ws: WebSocket): void {
  for (const [id, session] of activeSessions) {
    if (session.ws === ws) {
      cleanupSession(id);
      return;
    }
  }
}

/**
 * Clean up all active sessions (called on server shutdown).
 */
export function cleanupAllImageShells(): void {
  for (const id of activeSessions.keys()) {
    cleanupSession(id);
  }
}

/**
 * Get session by ID.
 */
export function getImageShellSession(sessionId: string): ImageShellSession | undefined {
  return activeSessions.get(sessionId);
}
