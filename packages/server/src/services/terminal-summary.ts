/**
 * Terminal Summary Service
 *
 * Captures recent terminal output from tmux sessions and uses Claude Haiku
 * (via OpenRouter) to generate short activity summaries like
 * "installing dependencies", "debugging API tests", etc.
 *
 * Results are cached per sandbox with a configurable TTL to avoid excessive
 * API calls.
 */

import { safeExec } from '../lib/safe-exec.js';
import { execInSandbox } from '../lib/exec-in-sandbox.js';
import { getOpenRouterApiKey } from './ai.js';
import { listByContainer, listByVm } from './session-store.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SUMMARY_MODEL = 'anthropic/claude-haiku-4.5';
const CAPTURE_LINES = 40;
const CACHE_TTL_MS = 20_000; // 20 seconds

interface CachedSummary {
  summary: string;
  updatedAt: number;
}

const cache = new Map<string, CachedSummary>();

const SYSTEM_PROMPT = `You summarize what a developer is doing in a terminal session. You receive the last lines of terminal output and respond with ONLY a short phrase (3-6 words) describing the current activity. No punctuation, no quotes, lowercase.

Examples of good responses:
- installing node dependencies
- running test suite
- editing nginx config
- debugging api endpoint
- reviewing git diff
- building docker image
- writing python script
- setting up database

If the terminal is idle at a shell prompt with no recent activity, respond with: idle`;

/**
 * Get a cached summary for a sandbox, or generate a new one.
 */
export async function getTerminalSummary(
  sandbox: { id: string; backend: string; guestIp?: string }
): Promise<CachedSummary | null> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return null;

  // Check cache
  const cached = cache.get(sandbox.id);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached;
  }

  // Capture terminal content
  const content = await captureTerminalContent(sandbox);
  if (!content || content.trim().length === 0) return cached || null;

  // Call Haiku for summary
  try {
    const summary = await summarizeWithHaiku(apiKey, content);
    if (summary) {
      const entry: CachedSummary = { summary, updatedAt: Date.now() };
      cache.set(sandbox.id, entry);
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
    const containerId = sandbox.id.startsWith('docker-') ? sandbox.id.slice(7) : sandbox.id;
    const sessions = listByContainer(containerId);
    if (sessions.length === 0) return null;
    // Pick most recently accessed
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
    // Get the first available tmux session name
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

/**
 * Call Claude Haiku via OpenRouter to summarize terminal content.
 */
async function summarizeWithHaiku(apiKey: string, terminalContent: string): Promise<string | null> {
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
      max_tokens: 30,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: terminalContent.slice(-3000) }, // limit input size
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`[TerminalSummary] OpenRouter error ${response.status}:`, text.slice(0, 200));
    return null;
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) return null;

  // Clean up: trim, lowercase, remove quotes/punctuation
  return content.trim().toLowerCase().replace(/^["']|["']$/g, '').replace(/\.+$/, '');
}

/**
 * Clear cached summary for a sandbox (e.g. when stopped).
 */
export function clearSummaryCache(sandboxId: string): void {
  cache.delete(sandboxId);
}
