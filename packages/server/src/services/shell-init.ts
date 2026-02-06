/**
 * Shell initialization script injected into all terminal sessions.
 * Emits OSC 7337 escape sequences after every command with cwd and git branch,
 * allowing the frontend to track shell state in real-time.
 *
 * Also injects PS1 prompt themes for visual customization.
 *
 * Works across all backends (docker exec, SSH to VMs, cloud instances, Daytona).
 */

import type { ChildProcess } from 'child_process';
import type { ShellPromptTheme } from './config.js';
import { getConfig } from './config.js';

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

// Git branch helper used by all themes
const GIT_BRANCH_HELPER = `__handler_git_ps1() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }`;

// PS1 theme definitions
// Each theme is a shell script snippet that sets PS1
// They use ANSI escape codes for colors and $() for dynamic content
const PS1_THEMES: Record<ShellPromptTheme, string> = {
  // Minimal: user ~/project $ ▍ (cyan username, bold path, cyan $)
  minimal: [
    GIT_BRANCH_HELPER,
    `__handler_ps1_branch() { local b; b=$(__handler_git_ps1); [ -n "$b" ] && printf ' \\001\\033[0;35m\\002%s\\001\\033[0m\\002' "$b"; }`,
    `PS1='\\[\\033[0;36m\\]\\u\\[\\033[0m\\] \\[\\033[1m\\]\\w\\[\\033[0m\\]$(__handler_ps1_branch) \\[\\033[0;36m\\]\\$\\[\\033[0m\\] '`,
  ].join('; '),

  // Arrow: Powerline segments with  arrows
  arrow: [
    GIT_BRANCH_HELPER,
    `__handler_ps1_branch() { local b; b=$(__handler_git_ps1); [ -n "$b" ] && printf '\\001\\033[0;34m\\002\\001\\033[0;37;44m\\002  %s \\001\\033[0;34;49m\\002\\001\\033[0m\\002' "$b" || printf '\\001\\033[0;32;49m\\002\\001\\033[0m\\002'; }`,
    `PS1='\\[\\033[0;30;42m\\]  \\w \\[\\033[0;32;49m\\]$(__handler_ps1_branch) '`,
  ].join('; '),

  // Bracket: [user@host] [~/project] [main] $ (blue brackets, green user, yellow path)
  bracket: [
    GIT_BRANCH_HELPER,
    `__handler_ps1_branch() { local b; b=$(__handler_git_ps1); [ -n "$b" ] && printf ' \\001\\033[0;34m\\002[\\001\\033[0;36m\\002%s\\001\\033[0;34m\\002]' "$b"; }`,
    `PS1='\\[\\033[0;34m\\][\\[\\033[0;32m\\]\\u@\\h\\[\\033[0;34m\\]] [\\[\\033[0;33m\\]\\w\\[\\033[0;34m\\]]$(__handler_ps1_branch) \\[\\033[0;34m\\]\\$\\[\\033[0m\\] '`,
  ].join('; '),

  // Lambda: λ ~/project (green λ if last cmd succeeded, red if failed)
  lambda: [
    GIT_BRANCH_HELPER,
    `__handler_ps1_branch() { local b; b=$(__handler_git_ps1); [ -n "$b" ] && printf ' \\001\\033[0;35m\\002(%s)\\001\\033[0m\\002' "$b"; }`,
    `PS1='\\[\\033[0;$(( $? == 0 ? 32 : 31 ))m\\]λ\\[\\033[0m\\] \\[\\033[1m\\]\\w\\[\\033[0m\\]$(__handler_ps1_branch) '`,
  ].join('; '),

  // Cyberpunk: ▸ user ▸ ~/project ▸ main ▸ (magenta arrows, cyan user, yellow path)
  cyberpunk: [
    GIT_BRANCH_HELPER,
    `__handler_ps1_branch() { local b; b=$(__handler_git_ps1); [ -n "$b" ] && printf ' \\001\\033[0;35m\\002▸ \\001\\033[0;32m\\002%s' "$b"; }`,
    `PS1='\\[\\033[0;35m\\]▸ \\[\\033[0;36m\\]\\u \\[\\033[0;35m\\]▸ \\[\\033[0;33m\\]\\w$(__handler_ps1_branch) \\[\\033[0;35m\\]▸\\[\\033[0m\\] '`,
  ].join('; '),

  // Multiline: Two-line with box-drawing
  multiline: [
    GIT_BRANCH_HELPER,
    `__handler_ps1_branch() { local b; b=$(__handler_git_ps1); [ -n "$b" ] && printf '─\\001\\033[0;34m\\002[\\001\\033[0;36m\\002%s\\001\\033[0;34m\\002]' "$b"; }`,
    `PS1='\\[\\033[0;34m\\]┌─[\\[\\033[0;32m\\]\\u@\\h\\[\\033[0;34m\\]]─[\\[\\033[0;33m\\]\\w\\[\\033[0;34m\\]]$(__handler_ps1_branch)\\[\\033[0;34m\\]\\n└─\\$\\[\\033[0m\\] '`,
  ].join('; '),
};

/**
 * Get the shell script to set a specific prompt theme.
 */
export function getPromptThemeScript(theme: ShellPromptTheme): string {
  return PS1_THEMES[theme] || PS1_THEMES.minimal;
}

// OSC 7337 is a custom code (unused by standard terminals).
// Format: \033]7337;{"cwd":"...","branch":"...","claudeStatus":"..."}\007
const SHELL_INIT_SCRIPT = [
  // Set up Claude Code hooks for status tracking
  CLAUDE_HOOKS_INIT,
  // Helper to read Claude Code status from hook-written file, falling back to process detection
  `__handler_claude_status() { if [ -f ~/.claude-status ]; then cat ~/.claude-status; elif pgrep -x claude >/dev/null 2>&1; then echo idle; else echo off; fi; }`,
  // Define the prompt hook function
  `__handler_prompt() { local b cs; b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); cs=$(__handler_claude_status); printf '\\033]7337;{"cwd":"%s","branch":"%s","claudeStatus":"%s"}\\007' "$PWD" "$b" "$cs"; }`,
  // Append to PROMPT_COMMAND (preserve existing value if any)
  `PROMPT_COMMAND="__handler_prompt\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"`,
  // Background watcher: emit OSC on Claude status changes (every 2s), independent of prompt
  `(__cs_prev=""; while true; do cs=$(__handler_claude_status); if [ "$cs" != "$__cs_prev" ]; then __cs_prev="$cs"; b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); printf '\\033]7337;{"cwd":"%s","branch":"%s","claudeStatus":"%s"}\\007' "$PWD" "$b" "$cs"; fi; sleep 2; done &) 2>/dev/null`,
].join('; ');

/**
 * Inject the shell init script into a running terminal session.
 * Writes the PROMPT_COMMAND setup to stdin, suppressing visible output.
 * Also injects the configured PS1 prompt theme.
 * Should be called shortly after the shell has started.
 */
export async function injectShellInit(process: ChildProcess, delayMs = 200): Promise<void> {
  const config = await getConfig();
  const theme = config.shellPromptTheme || 'minimal';
  const themeScript = getPromptThemeScript(theme);

  setTimeout(() => {
    if (process.killed || !process.stdin?.writable) return;
    // Write the init script + theme + clear to hide setup noise
    process.stdin.write(`${SHELL_INIT_SCRIPT}; ${themeScript}; clear\n`);
  }, delayMs);
}

/**
 * Inject a prompt theme into a running terminal session (for live-switching).
 * Clears the current line first with Ctrl+U, then writes the PS1 definition.
 */
export function injectPromptTheme(process: ChildProcess, theme: ShellPromptTheme): void {
  if (process.killed || !process.stdin?.writable) return;
  const themeScript = getPromptThemeScript(theme);
  // \x15 = Ctrl+U to clear the current input line
  process.stdin.write(`\x15${themeScript}\n`);
}
