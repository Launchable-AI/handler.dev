/**
 * Shell initialization script injected into all terminal sessions.
 * Emits OSC 7337 escape sequences after every command with cwd and git branch,
 * allowing the frontend to track shell state in real-time.
 *
 * Works across all backends (docker exec, SSH to VMs, cloud instances, Daytona).
 */

import type { ChildProcess } from 'child_process';

// OSC 7337 is a custom code (unused by standard terminals).
// Format: \033]7337;{"cwd":"...","branch":"..."}\007
const SHELL_INIT_SCRIPT = [
  // Define the prompt hook function
  `__caisson_prompt() { local b; b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); printf '\\033]7337;{"cwd":"%s","branch":"%s"}\\007' "$PWD" "$b"; }`,
  // Append to PROMPT_COMMAND (preserve existing value if any)
  `PROMPT_COMMAND="__caisson_prompt\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"`,
].join('; ');

/**
 * Inject the shell init script into a running terminal session.
 * Writes the PROMPT_COMMAND setup to stdin, suppressing visible output.
 * Should be called shortly after the shell has started.
 */
export function injectShellInit(process: ChildProcess, delayMs = 200): void {
  setTimeout(() => {
    if (process.killed || !process.stdin?.writable) return;
    // Write the init script followed by `clear` to hide setup noise
    process.stdin.write(`${SHELL_INIT_SCRIPT}; clear\n`);
  }, delayMs);
}
