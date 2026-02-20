/**
 * Detect AI coding agents installed/running inside sandboxes.
 * Uses `command -v` (POSIX) for installation and `pgrep -af` for process detection.
 * Results are cached in memory with a 15-second TTL.
 */

import { execInContainer } from './docker.js';
import { execFileSync } from 'child_process';

export type AgentId = 'claude' | 'codex' | 'gemini' | 'opencode';

export interface AgentInfo {
  id: AgentId;
  name: string;
  installed: boolean;
  running: boolean;
}

const AGENTS: Array<{ id: AgentId; name: string }> = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'opencode', name: 'OpenCode' },
];

// Detection script that avoids false positives from the script's own process.
// _dp=$$ captures the current shell PID, then grep -v filters it from pgrep output
// so the sh/bash process running this script doesn't match itself.
const DETECTION_SCRIPT = '_dp=$$; ' + AGENTS.map(a =>
  `command -v ${a.id} >/dev/null 2>&1 && echo "${a.id}:installed"; pgrep -af '[${a.id[0]}]${a.id.slice(1)}' 2>/dev/null | grep -v "^$_dp " | grep -q . && echo "${a.id}:running"`
).join('; ') + '; echo "__AGENT_DETECT_DONE__"';

// In-memory cache
const cache = new Map<string, { agents: AgentInfo[]; timestamp: number }>();
const CACHE_TTL = 15_000;

function parseDetectionOutput(output: string): AgentInfo[] {
  const lines = output.split('\n').map(l => l.trim());
  const installedSet = new Set<string>();
  const runningSet = new Set<string>();

  for (const line of lines) {
    const [agentId, state] = line.split(':');
    if (state === 'installed') installedSet.add(agentId);
    if (state === 'running') runningSet.add(agentId);
  }

  return AGENTS.map(a => ({
    id: a.id,
    name: a.name,
    installed: installedSet.has(a.id),
    running: runningSet.has(a.id),
  }));
}

export async function detectAgentsInDocker(containerId: string, sandboxId: string): Promise<AgentInfo[]> {
  const cached = cache.get(sandboxId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.agents;
  }

  try {
    const output = await Promise.race([
      execInContainer(containerId, ['sh', '-c', DETECTION_SCRIPT]),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    const agents = parseDetectionOutput(output);
    cache.set(sandboxId, { agents, timestamp: Date.now() });
    return agents;
  } catch {
    // Return all-false on error
    return AGENTS.map(a => ({ id: a.id, name: a.name, installed: false, running: false }));
  }
}

const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=5',
];

export async function detectAgentsViaSsh(
  host: string,
  port: number,
  user: string,
  keyPath: string,
  sandboxId: string,
): Promise<AgentInfo[]> {
  const cached = cache.get(sandboxId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.agents;
  }

  try {
    const portArgs = port !== 22 ? ['-p', String(port)] : [];
    // Pass detection script directly — SSH sends all post-hostname args as a
    // single command string to the remote shell, so no sh -c wrapper needed.
    const output = execFileSync('ssh', [
      '-i', keyPath,
      ...portArgs,
      ...SSH_OPTS,
      `${user}@${host}`,
      DETECTION_SCRIPT,
    ], { encoding: 'utf-8', timeout: 5000 });
    const agents = parseDetectionOutput(output);
    cache.set(sandboxId, { agents, timestamp: Date.now() });
    return agents;
  } catch {
    return AGENTS.map(a => ({ id: a.id, name: a.name, installed: false, running: false }));
  }
}
