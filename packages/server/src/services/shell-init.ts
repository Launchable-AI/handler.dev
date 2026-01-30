/**
 * Shell initialization script injected into all terminal sessions.
 * Emits OSC 7337 escape sequences after every command with cwd and git branch,
 * allowing the frontend to track shell state in real-time.
 *
 * Works across all backends (docker exec, SSH to VMs, cloud instances, Daytona).
 */

import type { ChildProcess } from 'child_process';

// Shell snippet that ensures Claude Code hooks are configured for status tracking.
// Uses a heredoc to avoid quoting issues, and merges with existing settings via
// node/python if available, otherwise writes directly.
// The hooks JSON is stored in an env var to avoid quoting issues in the shell one-liner.
const CLAUDE_HOOKS_JSON = '{"hooks":{"UserPromptSubmit":[{"matcher":"","hooks":[{"type":"command","command":"echo processing > ~/.claude-status"}]}],"Stop":[{"matcher":"","hooks":[{"type":"command","command":"echo idle > ~/.claude-status"}]}]}}';

const CLAUDE_HOOKS_INIT = [
  `mkdir -p ~/.claude`,
  `export __CH='${CLAUDE_HOOKS_JSON}'`,
  // Merge hooks into existing settings: try node, then python3, then overwrite
  `(command -v node >/dev/null 2>&1 && node -e 'var f=process.env.HOME+"/.claude/settings.json",c=require("fs"),s={};try{s=JSON.parse(c.readFileSync(f,"utf8"))}catch(e){}var h=JSON.parse(process.env.__CH);s.hooks=Object.assign(s.hooks||{},h.hooks);c.writeFileSync(f,JSON.stringify(s,null,2))' || command -v python3 >/dev/null 2>&1 && python3 -c 'import json,os;f=os.path.expanduser("~/.claude/settings.json");s={};exec("try:\\n s=json.load(open(f))\\nexcept:pass");h=json.loads(os.environ["__CH"]);s.setdefault("hooks",{}).update(h["hooks"]);json.dump(s,open(f,"w"),indent=2)' || echo "$__CH" > ~/.claude/settings.json) 2>/dev/null`,
  `unset __CH`,
].join(' && ');

// OSC 7337 is a custom code (unused by standard terminals).
// Format: \033]7337;{"cwd":"...","branch":"...","claudeStatus":"..."}\007
const SHELL_INIT_SCRIPT = [
  // Set up Claude Code hooks for status tracking
  CLAUDE_HOOKS_INIT,
  // Helper to read Claude Code status from hook-written file, falling back to process detection
  `__caisson_claude_status() { if [ -f ~/.claude-status ]; then cat ~/.claude-status; elif pgrep -x claude >/dev/null 2>&1; then echo idle; else echo off; fi; }`,
  // Define the prompt hook function
  `__caisson_prompt() { local b cs; b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); cs=$(__caisson_claude_status); printf '\\033]7337;{"cwd":"%s","branch":"%s","claudeStatus":"%s"}\\007' "$PWD" "$b" "$cs"; }`,
  // Append to PROMPT_COMMAND (preserve existing value if any)
  `PROMPT_COMMAND="__caisson_prompt\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"`,
  // Background watcher: emit OSC on Claude status changes (every 2s), independent of prompt
  `(__cs_prev=""; while true; do cs=$(__caisson_claude_status); if [ "$cs" != "$__cs_prev" ]; then __cs_prev="$cs"; b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); printf '\\033]7337;{"cwd":"%s","branch":"%s","claudeStatus":"%s"}\\007' "$PWD" "$b" "$cs"; fi; sleep 2; done &) 2>/dev/null`,
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
