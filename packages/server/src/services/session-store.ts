/**
 * Session Store - Persists terminal session metadata for reconnection
 *
 * Stores mapping between sessionId and tmux session name so clients can
 * reconnect to existing terminal sessions after WebSocket disconnects.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PersistedSession {
  sessionId: string;
  containerId?: string;
  tmuxSession: string;  // e.g., "handler-abc123-1234567890"
  createdAt: number;
  lastAccessedAt: number;
  user: string;
  workdir: string;
  // VM-specific fields
  vmId?: string;
  vmIp?: string;
  dataDir?: string;
}

// Store file location
const DATA_DIR = path.resolve(__dirname, '../../../../data');
const SESSIONS_FILE = path.join(DATA_DIR, 'terminal-sessions.json');

// In-memory cache
let sessions: Map<string, PersistedSession> = new Map();
let loaded = false;

// Default TTL: 24 hours
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Load sessions from disk
 */
function loadSessions(): void {
  if (loaded) return;

  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
      sessions = new Map(Object.entries(data));
    }
  } catch (err) {
    console.warn('[SessionStore] Failed to load sessions:', err);
    sessions = new Map();
  }
  loaded = true;
}

/**
 * Save sessions to disk
 */
function saveSessions(): void {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const data = Object.fromEntries(sessions);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[SessionStore] Failed to save sessions:', err);
  }
}

/**
 * Get a session by ID
 */
export function getSession(sessionId: string): PersistedSession | undefined {
  loadSessions();
  const session = sessions.get(sessionId);

  if (session) {
    // Update last accessed time
    session.lastAccessedAt = Date.now();
    saveSessions();
  }

  return session;
}

/**
 * Store a new session
 */
export function setSession(session: PersistedSession): void {
  loadSessions();
  sessions.set(session.sessionId, session);
  saveSessions();
  console.log(`[SessionStore] Stored session ${session.sessionId} -> tmux:${session.tmuxSession}`);
}

/**
 * Delete a session by ID
 */
export function deleteSession(sessionId: string): boolean {
  loadSessions();
  const existed = sessions.delete(sessionId);
  if (existed) {
    saveSessions();
    console.log(`[SessionStore] Deleted session ${sessionId}`);
  }
  return existed;
}

/**
 * List all sessions for a container
 */
export function listByContainer(containerId: string): PersistedSession[] {
  loadSessions();
  return Array.from(sessions.values()).filter(s => s.containerId === containerId);
}

/**
 * Find session by tmux session name
 */
export function findByTmuxSession(tmuxSession: string): PersistedSession | undefined {
  loadSessions();
  return Array.from(sessions.values()).find(s => s.tmuxSession === tmuxSession);
}

/**
 * Clean up stale sessions (older than TTL)
 */
export function cleanupStaleSessions(ttlMs: number = DEFAULT_TTL_MS): number {
  loadSessions();
  const now = Date.now();
  let cleaned = 0;

  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccessedAt > ttlMs) {
      sessions.delete(id);
      cleaned++;
      console.log(`[SessionStore] Cleaned up stale session ${id} (age: ${Math.round((now - session.lastAccessedAt) / 1000 / 60)}m)`);
    }
  }

  if (cleaned > 0) {
    saveSessions();
  }

  return cleaned;
}

/**
 * Delete all sessions for a container (when container is deleted)
 */
export function deleteByContainer(containerId: string): number {
  loadSessions();
  let deleted = 0;

  for (const [id, session] of sessions.entries()) {
    if (session.containerId === containerId) {
      sessions.delete(id);
      deleted++;
    }
  }

  if (deleted > 0) {
    saveSessions();
    console.log(`[SessionStore] Deleted ${deleted} sessions for container ${containerId}`);
  }

  return deleted;
}

/**
 * List all sessions for a VM
 */
export function listByVm(vmId: string): PersistedSession[] {
  loadSessions();
  return Array.from(sessions.values()).filter(s => s.vmId === vmId);
}

/**
 * Delete all sessions for a VM (when VM is deleted)
 */
export function deleteByVm(vmId: string): number {
  loadSessions();
  let deleted = 0;

  for (const [id, session] of sessions.entries()) {
    if (session.vmId === vmId) {
      sessions.delete(id);
      deleted++;
    }
  }

  if (deleted > 0) {
    saveSessions();
    console.log(`[SessionStore] Deleted ${deleted} sessions for VM ${vmId}`);
  }

  return deleted;
}

/**
 * Get all sessions (for debugging)
 */
export function getAllSessions(): PersistedSession[] {
  loadSessions();
  return Array.from(sessions.values());
}

/**
 * Generate a tmux session name for a container or VM
 */
export function generateTmuxSessionName(id: string): string {
  // Use short ID + timestamp for uniqueness
  const shortId = id.slice(0, 8);
  return `handler-${shortId}-${Date.now()}`;
}
