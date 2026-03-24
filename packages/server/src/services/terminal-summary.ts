/**
 * Terminal Summary Service
 *
 * Captures recent terminal output from tmux sessions and uses Claude Haiku
 * (via OpenRouter) to classify the terminal state and generate a short
 * activity summary. The status classification drives UI treatment:
 *
 *   needs_input — agent/process waiting for user action (orange highlight)
 *   error       — something failed (red)
 *   working     — actively running a task (purple/blue)
 *   done        — task completed, awaiting review (green)
 *   idle        — shell prompt, nothing happening (hidden)
 */

import { safeExec } from '../lib/safe-exec.js';
import { execInSandbox } from '../lib/exec-in-sandbox.js';
import { getOpenRouterApiKey } from './ai.js';
import { getConfig } from './config.js';
import { listByContainer, listByVm } from './session-store.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Gemma 3n e4b — Google's nano model, ~100x cheaper than Haiku
// $0.02/M input, $0.04/M output vs Haiku's $0.80/$4.00
const SUMMARY_MODEL = 'google/gemma-3n-e4b-it';
const CAPTURE_LINES = 40;
const CACHE_TTL_MS = 20_000; // 20 seconds

export type TerminalStatus = 'needs_input' | 'error' | 'working' | 'done' | 'idle';

export interface CachedSummary {
  status: TerminalStatus;
  summary: string;
  updatedAt: number;
}

const cache = new Map<string, CachedSummary>();

const SYSTEM_PROMPT = `You analyze terminal sessions and classify what's happening. You receive the last lines of terminal output.

Respond with EXACTLY one line in this format:
STATUS|short description (3-8 words)

STATUS must be one of:
- needs_input — a process, agent, or prompt is waiting for the user to type something, answer a question, confirm an action, or provide input. Look for: question marks, [y/N] prompts, "waiting for", input cursors, permission requests, Claude/agent asking a question, interactive menus, "press any key", password prompts
- error — a command failed, exception was thrown, build broke, test failed, something crashed. Look for: error messages, stack traces, "FAIL", non-zero exit codes, "command not found", segfaults, permission denied
- done — a task just completed successfully and nothing else is running. Look for: "done", "complete", "success", "built in", "passed", followed by a shell prompt with no running process
- working — a command or process is actively running or producing output. Look for: ongoing compilation, test execution, downloads in progress, active git operations, file editing, running servers
- idle — just a shell prompt with no recent meaningful activity

The description should tell the user WHAT specifically needs attention or is happening.

Examples:
needs_input|claude asking about test strategy
needs_input|npm asking to proceed with install
needs_input|git merge conflict needs resolution
error|jest tests failing in auth module
error|docker build failed missing dependency
working|running database migrations
working|installing python dependencies
done|build completed successfully
done|all 42 tests passed
idle|shell prompt`;

/**
 * Get a cached summary for a sandbox, or generate a new one.
 */
export async function getTerminalSummary(
  sandbox: { id: string; backend: string; guestIp?: string }
): Promise<CachedSummary | null> {
  // Check if feature is enabled
  const config = await getConfig();
  if (config.terminalSummaryEnabled === false) return null;

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return null;

  // Check cache
  const cached = cache.get(sandbox.id);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached;
  }

  // Capture terminal content
  const content = await captureTerminalContent(sandbox);
  if (!content || content.trim().length === 0) {
    return cached || null;
  }

  // Call Haiku for classification + summary
  try {
    const result = await classifyWithHaiku(apiKey, content);
    if (result) {
      const entry: CachedSummary = { ...result, updatedAt: Date.now() };
      cache.set(sandbox.id, entry);
      console.log(`[TerminalSummary] ${sandbox.id}: [${result.status}] ${result.summary}`);
      return entry;
    }
  } catch (err) {
    console.warn('[TerminalSummary] Failed to generate summary:', err instanceof Error ? err.message : err);
  }

  return cached || null;
}

/**
 * Capture recent terminal output from a sandbox's tmux session.
 */
async function captureTerminalContent(
  sandbox: { id: string; backend: string; guestIp?: string }
): Promise<string | null> {
  try {
    // Find the most recent tmux session for this sandbox
    const tmuxSession = findActiveTmuxSession(sandbox);
    if (!tmuxSession) {
      // Fall back to running tmux list + capture inside the sandbox
      return await captureViaExecInSandbox(sandbox);
    }

    if (sandbox.backend === 'docker') {
      const containerId = sandbox.id.startsWith('docker-') ? sandbox.id.slice(7) : sandbox.id;
      return await safeExec('docker', [
        'exec', containerId, 'tmux', 'capture-pane',
        '-t', tmuxSession, '-p', '-S', `-${CAPTURE_LINES}`,
      ], { timeout: 5000 });
    }

    // VM backends — capture via execInSandbox
    return await execInSandbox(
      sandbox,
      `tmux capture-pane -t ${tmuxSession} -p -S -${CAPTURE_LINES} 2>/dev/null`,
      { timeout: 5000 }
    );
  } catch {
    return null;
  }
}

/**
 * Find the most recently accessed tmux session name for a sandbox.
 */
function findActiveTmuxSession(
  sandbox: { id: string; backend: string }
): string | null {
  if (sandbox.backend === 'docker') {
    // Session store may have containerId with or without "docker-" prefix
    let sessions = listByContainer(sandbox.id);
    if (sessions.length === 0) {
      const bareId = sandbox.id.startsWith('docker-') ? sandbox.id.slice(7) : sandbox.id;
      sessions = listByContainer(bareId);
    }
    if (sessions.length === 0) return null;
    sessions.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
    return sessions[0].tmuxSession;
  }

  // VM backends
  const sessions = listByVm(sandbox.id);
  if (sessions.length === 0) return null;
  sessions.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  return sessions[0].tmuxSession;
}

/**
 * Fallback: capture from any tmux session inside the sandbox.
 */
async function captureViaExecInSandbox(
  sandbox: { id: string; backend: string; guestIp?: string }
): Promise<string | null> {
  try {
    const listOutput = await execInSandbox(
      sandbox,
      `tmux list-sessions -F '#{session_name}' 2>/dev/null | head -1`,
      { timeout: 5000 }
    );
    const sessionName = listOutput.trim();
    if (!sessionName) return null;

    return await execInSandbox(
      sandbox,
      `tmux capture-pane -t ${sessionName} -p -S -${CAPTURE_LINES} 2>/dev/null`,
      { timeout: 5000 }
    );
  } catch {
    return null;
  }
}

const VALID_STATUSES: TerminalStatus[] = ['needs_input', 'error', 'working', 'done', 'idle'];

/**
 * Call Claude Haiku via OpenRouter to classify and summarize terminal content.
 */
async function classifyWithHaiku(
  apiKey: string,
  terminalContent: string
): Promise<{ status: TerminalStatus; summary: string } | null> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://handler.dev',
      'X-Title': 'Handler',
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      max_tokens: 50,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: terminalContent.slice(-3000) },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`[TerminalSummary] OpenRouter error ${response.status}:`, text.slice(0, 200));
    return null;
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  // Parse "STATUS|summary" format
  const pipeIdx = content.indexOf('|');
  if (pipeIdx === -1) {
    // No pipe — try to interpret the whole thing
    const lower = content.toLowerCase();
    if (VALID_STATUSES.includes(lower as TerminalStatus)) {
      return { status: lower as TerminalStatus, summary: lower };
    }
    return { status: 'working', summary: lower.replace(/^["']|["']$/g, '').replace(/\.+$/, '') };
  }

  const rawStatus = content.slice(0, pipeIdx).trim().toLowerCase();
  const summary = content.slice(pipeIdx + 1).trim().toLowerCase().replace(/^["']|["']$/g, '').replace(/\.+$/, '');

  const status: TerminalStatus = VALID_STATUSES.includes(rawStatus as TerminalStatus)
    ? (rawStatus as TerminalStatus)
    : 'working';

  return { status, summary: summary || status };
}

/**
 * Clear cached summary for a sandbox (e.g. when stopped).
 */
export function clearSummaryCache(sandboxId: string): void {
  cache.delete(sandboxId);
}
