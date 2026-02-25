# Terminal Input/Output Lag — Analysis & Fix Plan

**Date**: 2026-02-20
**Status**: P0 fixes implemented (2026-02-20), P1-P3 pending
**Symptom**: User types into terminal and characters don't appear, or appear with significant delay.

---

## Root Causes (ordered by impact)

### 1. Resize commands injected into shell stdin (CRITICAL)

**Files**:
- `packages/server/src/services/terminal.ts:396` (Docker containers)
- `packages/server/src/services/vm-terminal.ts:506` (non-tmux VMs)

Every terminal resize event triggers this write to the shell's stdin:

```
\x15stty cols X rows Y 2>/dev/null; clear\n
```

This sequence:
1. Sends `Ctrl+U` — erases whatever the user has typed on the current line
2. Types `stty cols X rows Y 2>/dev/null` — a visible command in the shell
3. Runs `clear` — wipes the entire screen

Any characters the user has typed are destroyed by Ctrl+U, and the screen is cleared. This is the single most likely cause of "I type and don't see anything".

The VM tmux path (`vm-terminal.ts:492-500`) correctly avoids this by using a separate SSH exec to resize the PTY externally:
```typescript
sshExec(vmIp, dataDir,
  `PTY=$(tmux list-clients -t ${tmuxSession} -F '#{client_tty}' | head -1) && [ -n "$PTY" ] && stty -F $PTY cols ${cols} rows ${rows}`
);
```

Docker containers have no equivalent — they always inject through stdin.

### 2. Multiple fit/resize calls fire on every connection (HIGH)

**Files**:
- `packages/web/src/components/Terminal/TerminalInstance.tsx:322-323, 421-428`
- `packages/web/src/components/TerminalPanel.tsx:813-814, 882-889`

Both terminal components schedule 5-6 `fitAndResize` calls within the first 600ms of connection:

| Source | Delay |
|--------|-------|
| After `connected` message | 50ms |
| After `connected` message | 200ms |
| Initial fit schedule | 100ms |
| Initial fit schedule | 300ms |
| Initial fit schedule | 600ms |
| `requestAnimationFrame` (nested) | ~16-32ms |

Each call sends a `resize` WebSocket message to the server, which triggers the stdin stty injection from issue #1. Result: **5+ rounds of Ctrl+U + stty + clear** in the first 600ms of a session.

Additionally, the `ResizeObserver` (`TerminalInstance.tsx:463`, `TerminalPanel.tsx:922`) fires on any container layout change (URL bar appearing, panel resizing, etc.) with only a 50-100ms debounce, sending yet more resize events.

### 3. Shell init injection via stdin at 200ms (HIGH)

**File**: `packages/server/src/services/shell-init.ts:224-243`

200ms after shell start, `injectShellInit()` writes a massive init script directly to stdin:

```typescript
setTimeout(() => {
  process.stdin.write(`${SHELL_INIT_SCRIPT}; ${themeScript}; clear\n`);
  // ... then another write to persist to .bashrc
}, 200);
```

The `SHELL_INIT_SCRIPT` (defined at lines 183-205) contains:
- Claude hooks setup (mkdir, export, node/python JSON merge fallback chain)
- Color aliases (ls, grep, fgrep, egrep)
- dircolors eval
- Claude status helper function
- PROMPT_COMMAND setup
- A **background watcher process** (see #4)
- tmux wrapper alias
- PS1 theme definition
- `clear` command

All of this is typed into the shell as visible stdin. If the user starts typing before the 200ms delay fires, or while the init script is still being processed, their input gets interleaved with init commands.

Note: The VM tmux-with-fallback path (`vm-terminal.ts:147-226`) correctly avoids this by embedding the init in the SSH remote command (invisible to the user). Only backends that call `injectShellInit()` directly are affected: Docker containers, Daytona, AWS, and generic cloud sessions.

### 4. Background watcher polling every 2 seconds (MEDIUM)

**File**: `packages/server/src/services/shell-init.ts:201`

The init script spawns a background subshell in every terminal session:

```bash
(__cs_prev=""; while true; do
  cs=$(__handler_claude_status);  # calls pgrep -x claude
  if [ "$cs" != "$__cs_prev" ]; then
    __cs_prev="$cs";
    b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null);
    printf '\033]7337;{"cwd":"%s","branch":"%s","claudeStatus":"%s"}\007' "$PWD" "$b" "$cs";
  fi;
  sleep 2;
done &) 2>/dev/null
```

This runs `pgrep -x claude` every 2 seconds. When the status changes, it also runs `git rev-parse` and emits an OSC escape sequence through stdout. This generates a constant stream of background I/O that:
- Produces WebSocket messages the client must process
- Can interleave with user-visible output
- Adds CPU overhead inside the container/VM

### 5. No output batching on server or client (MEDIUM)

**Files**:
- `packages/server/src/services/terminal.ts:204-207`
- `packages/server/src/services/vm-terminal.ts:276-309`

Each stdout `data` event from the child process is immediately sent as a separate WebSocket message:

```typescript
process.stdout?.on('data', (data: Buffer) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
  }
});
```

A single command's output can arrive as 50-100+ separate OS-level chunks. Each chunk becomes:
1. A `JSON.stringify()` call on the server
2. A WebSocket frame
3. A `JSON.parse()` call on the client
4. A `term.write()` call on xterm.js

For fast-producing commands (`cat`, `find`, compilation output), this creates a flood of small messages. xterm.js handles rapid writes reasonably well, but the JSON serialization/deserialization overhead and WebSocket framing add up.

### 6. URL scanning on every output message (LOW)

**File**: `packages/web/src/components/Terminal/TerminalInstance.tsx:189-217`

Every `output` message triggers `scanUrlsDebounced()` (line 372), which schedules a 300ms debounced scan of all visible buffer lines using regex. While the debounce prevents constant scanning, the scan itself iterates every visible row and calls `translateToString(true)` on each line, which is a non-trivial xterm.js operation. This only affects `TerminalInstance` (used in Command Centre grid view), not `TerminalPanel`.

---

## Fix Plan

### Fix 1: Proper PTY resize for Docker containers

**Goal**: Stop injecting stty/clear through stdin on resize.

**Approach**: Docker `exec` with `-t` (TTY) flag would give us a real PTY that supports `SIGWINCH`. However, the current architecture uses `-i` (interactive) without `-t`, and wraps with `script` for PTY emulation. The `script` command creates a PTY internally but doesn't expose a way to resize it externally.

**Options**:

**Option A — Use `docker exec -it` with a controlling PTY (Recommended)**
Switch from `docker exec -i ... script -qec ...` to `docker exec -it ...` and use Node's `child_process` with `pty.js` (or `node-pty`) to get a resizable PTY. `node-pty` provides `resize(cols, rows)` which sends `SIGWINCH` to the child — no stdin injection needed.

Tradeoff: Adds a native dependency (`node-pty`). But this is the standard approach used by VS Code's terminal, Theia, and other web terminal projects.

**Option B — Resize the inner `script` PTY via `/proc`**
After `docker exec -i`, the `script` command creates a PTY (e.g., `/dev/pts/1`). We could find it via `docker exec ... ls /proc/$PID/fd/0` and then resize it with `stty -F /dev/pts/N cols X rows Y` in a separate `docker exec` call (similar to how VM tmux does it via separate SSH).

Tradeoff: Fragile — requires finding the right PTY device. But avoids new dependencies.

**Option C — Debounce + suppress stdin resize during init**
Keep the current stdin approach but:
1. Don't send any resize events for the first 1 second after connection
2. Deduplicate resize events (skip if cols/rows haven't changed)
3. Remove the `clear` from the stty command (the stty itself is enough)

Tradeoff: Still injects into stdin, but reduces the damage. Quickest to implement.

**Recommendation**: Option C as an immediate fix, Option A as the proper long-term solution.

### Fix 2: Consolidate fit/resize calls

**Goal**: Reduce 5-6 resize events to 1.

**Changes**:
- In `TerminalInstance.tsx` and `TerminalPanel.tsx`: Replace the multiple `setTimeout(fitAndResize, ...)` calls with a single debounced fit function that waits for layout stability.
- Use a single `requestAnimationFrame` after the `connected` message, with one follow-up at ~200ms as a safety net. Remove the 50ms, 100ms, 300ms, 600ms scattered timeouts.
- Add cols/rows dedup on the client: track last-sent dimensions and skip the resize WebSocket message if unchanged.

```typescript
// Proposed: single debounced fit
let fitTimer: ReturnType<typeof setTimeout> | null = null;
let lastSentCols = 0, lastSentRows = 0;

const debouncedFitAndResize = () => {
  if (fitTimer) clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    fitAddon.fit();
    if (term.cols !== lastSentCols || term.rows !== lastSentRows) {
      lastSentCols = term.cols;
      lastSentRows = term.rows;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }, 150);
};
```

### Fix 3: Make shell init invisible for Docker containers

**Goal**: Stop the init script from being visible in the terminal.

**Approach**: Mirror the VM tmux-with-fallback approach — embed the init in the command passed to `docker exec` rather than injecting via stdin after the fact.

Instead of:
```typescript
spawn('docker', ['exec', '-i', ..., containerId, 'script', '-qec', shell, '/dev/null']);
// ... then 200ms later:
process.stdin.write(`${SHELL_INIT_SCRIPT}; clear\n`);
```

Do:
```typescript
const wrappedCmd = `${SHELL_INIT_SCRIPT}; ${themeScript}; exec ${shell}`;
spawn('docker', ['exec', '-i', ..., containerId, 'script', '-qec', wrappedCmd, '/dev/null']);
```

The init runs as part of the initial command before the shell's first prompt, so nothing is visible to the user and there's no timing race with user input.

### Fix 4: Add output batching on the client

**Goal**: Reduce the overhead of many small xterm writes.

**Approach**: Buffer incoming `output` messages on the client and flush to xterm in batches using `requestAnimationFrame`:

```typescript
// Proposed: client-side write batching
let outputBuffer = '';
let outputRafId: number | null = null;

// In ws.onmessage, case 'output':
outputBuffer += msg.data;
if (!outputRafId) {
  outputRafId = requestAnimationFrame(() => {
    term.write(outputBuffer);
    outputBuffer = '';
    outputRafId = null;
  });
}
```

This coalesces all output that arrives within a single frame (~16ms) into one `term.write()` call, reducing xterm rendering overhead significantly during fast output.

### Fix 5: Reduce background watcher overhead

**Goal**: Stop the 2-second polling loop from generating unnecessary I/O.

**Options**:
- **Option A**: Remove the background watcher entirely. Claude status changes would only be detected at prompt time (via PROMPT_COMMAND), which is sufficient for most use cases.
- **Option B**: Increase the polling interval to 10-15 seconds. Claude status doesn't change that frequently.
- **Option C**: Use `inotifywait` on `~/.claude-status` instead of polling (requires inotify-tools, not always available).

**Recommendation**: Option A — remove the background watcher. PROMPT_COMMAND already tracks status on every command, which is frequent enough.

### Fix 6: Add server-side resize dedup

**Goal**: Skip redundant resize operations on the server.

**Change in `terminal.ts` and `vm-terminal.ts`**: Track last-applied cols/rows per session and skip if unchanged:

```typescript
// In TerminalSession interface:
lastCols?: number;
lastRows?: number;

// In resizeSession:
if (session.lastCols === cols && session.lastRows === rows) return true;
session.lastCols = cols;
session.lastRows = rows;
```

---

## Implementation Priority

| Priority | Fix | Impact | Effort |
|----------|-----|--------|--------|
| P0 | Fix 2: Consolidate fit/resize calls + client dedup | Eliminates 4-5 redundant resize events | Small |
| P0 | Fix 6: Server-side resize dedup | Prevents duplicate stty injections | Small |
| P1 | Fix 3: Embed shell init in docker exec command | Eliminates stdin init race condition | Medium |
| P1 | Fix 1C: Suppress resize during init + remove `clear` | Reduces stdin noise during startup | Small |
| P2 | Fix 4: Client-side output batching | Smoother rendering during heavy output | Small |
| P2 | Fix 5A: Remove background watcher | Eliminates constant 2s polling overhead | Small |
| P3 | Fix 1A: node-pty for proper PTY resize | Proper long-term resize solution | Large (new dep) |

Fixes marked P0 should resolve the immediate "I type and don't see anything" symptom. P1 fixes prevent the issue from recurring during session startup. P2/P3 are general performance improvements.
