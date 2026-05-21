# TUI Implementation Plan: `handler-tui`

A standalone Rust + ratatui binary acting as a terminal-native "working view" for the Handler server. Connects to the running Hono server over its existing HTTP + WebSocket API.

## 1. Reconnaissance summary (grounded references)

### Server transport
- **Bind**: `127.0.0.1` only, port from `SERVER_PORT` env, default `4001`. See `packages/server/src/index.ts:715-723`.
- **CORS**: wildcard origin allowed (`packages/server/src/index.ts:223-227`). No auth/token middleware visible — the TUI does not need credentials.
- **HTTP base**: `http://127.0.0.1:4001/api`.
- **WebSocket**: `ws://127.0.0.1:4001/ws/terminal` (`packages/server/src/index.ts:276`).

### HTTP endpoints the TUI consumes
All defined in `packages/server/src/routes/sandboxes.ts`:

| Endpoint | Line | Response shape |
|---|---|---|
| `GET /api/sandboxes` | 268 | `{ sandboxes: Sandbox[], backends: Record<backend, bool> }` |
| `GET /api/sandboxes/:id` | 322 | `Sandbox` |
| `GET /api/sandboxes/:id/metrics` | 1587 | `{ metrics: GuestMetrics \| null }` |
| `GET /api/sandboxes/:id/agents` | 1653 | `{ agents: AgentInfo[] }` |
| `GET /api/sandboxes/:id/tmux-sessions` | 1703 | `{ sessions: [{name, windows, created}] }` |
| `GET /api/sandboxes/:id/terminal-summary` | 1760 | `{ status: TerminalStatus\|null, summary: string\|null, updatedAt?: number }` |
| `GET /api/sandboxes/:id/terminal-capture` | 1792 | `{ content: string\|null }` (ANSI bytes — useful for non-attach previews) |

Canonical TS shapes:
- `Sandbox`: `packages/server/src/types/sandbox.ts` (id, name, backend, status, vcpus, memoryMb, diskGb, ports, guestIp, sshUser, image, createdAt, backendMeta).
- `GuestMetrics`: `packages/server/src/services/guest-metrics.ts:14-22` — `{cpuUsage, memoryUsed, memoryTotal, memoryUsage, diskUsed, diskTotal, diskUsage}` (CPU/mem/disk usage are 0-100, used/total in bytes).
- `AgentInfo`: `packages/server/src/services/agent-detect.ts:12-17` — `{id: 'claude'|'codex'|'gemini'|'opencode', name, installed, running}`.
- `TerminalStatus`: `packages/server/src/services/terminal-summary.ts:28` — `'needs_input'|'error'|'working'|'done'|'idle'`.

### WebSocket protocol (the heart of the attach flow)
Server is at `/ws/terminal`. Both directions use newline-free JSON text frames (`packages/server/src/index.ts:283-619`).

**Client → server messages** (one connection per terminal session):
- `{type: 'start', containerId, shell?, cols, rows, workdir?, attachTmuxSession?}` — Docker container exec
- `{type: 'start-vm', vmId, vmIp, shell?, cols, rows, sessionKey?, attachTmuxSession?}` — Firecracker
- `{type: 'start-daytona', sandboxId, cols, rows}` (line 397)
- `{type: 'start-aws', instanceId, publicIp, cols, rows}` (line 432)
- `{type: 'start-azure'|'start-gcp'|'start-digitalocean'|'start-linode', instanceId, publicIp, sshUser?, cols, rows}` (line 472)
- `{type: 'resume', sessionId, cols, rows}` — reattach to a saved container session
- `{type: 'resume-vm', sessionId, cols, rows}` — reattach to a saved VM session
- `{type: 'input', data: string}` — stdin (UTF-8 bytes/strings)
- `{type: 'resize', cols, rows}`
- `{type: 'ping'}` → server replies `{type: 'pong'}`

**Server → client messages** (from `services/terminal.ts:260-429` and `services/vm-terminal.ts:351-916`):
- `{type: 'connected', sessionId, tmuxSession?, resumed?}` — handshake complete
- `{type: 'output', data: string}` — raw PTY bytes (ANSI escapes included)
- `{type: 'scrollback', data: string}` — sent immediately after a successful `resume` if scrollback history is buffered
- `{type: 'session-update', tmuxState: 'connected'|'detached'|'unavailable'}` — VM tmux state (vm-terminal.ts:351-365)
- `{type: 'session-not-found', oldSessionId, message?}` — failed `resume`; client should fall back to fresh `start`
- `{type: 'exit', code}` — PTY exited
- `{type: 'error', message}`
- `{type: 'pong'}`

Frontend reference: `packages/web/src/components/Terminal/TerminalInstance.tsx:408-560` is the canonical client implementation we mirror in Rust.

### Polling cadence (frontend → mirror in TUI)
From `packages/web/src/hooks/useSandboxes.ts`:
- `listSandboxes` — 5s normal, 2s when any sandbox is in `starting|creating|building` (line 23-30)
- `getSandboxMetrics` — 5s (line 456)
- `getTerminalSummary` — 5s (line 499; docstring on line 479 says 20s, **but the actual interval is 5s** — the doc is stale)
- `detectSandboxAgents` — 30s (line 443)
- `getTerminalCapture` — 5s (line 488; only useful if we add previews to the dashboard)

### Existing Rust crate
- `helpers/tap-helper/Cargo.toml` — `name = "handler-tap-helper"`, edition 2021, release profile size-optimized (`opt-level = "z"`, `lto = true`, `strip = true`, `codegen-units = 1`). Uses clap derive 4.x, serde 1, serde_json 1.
- **No root `Cargo.toml` workspace exists.** The only top-level Cargo manifests are under `helpers/tap-helper/`. So this plan requires creating a workspace.

---

## 2. Crate name, location, workspace

**Recommendation:**
- Crate path: `helpers/handler-tui/`
- Crate name: `handler-tui` (binary name `handler-tui`)
- Create a root `Cargo.toml` workspace at the repo root declaring both members:
  ```toml
  [workspace]
  resolver = "2"
  members = ["helpers/tap-helper", "helpers/handler-tui"]
  ```
- Keep `helpers/tap-helper/Cargo.toml`'s `[profile.release]` block; for the TUI use a saner default profile (don't inherit the size-optimized one — TUI startup latency matters and `opt-level = "z"` hurts).
- Add `target/` to root `.gitignore` if not already there.

Rationale: `helpers/` already houses Rust binaries that ship alongside Handler; the canvas web is in `packages/`. The TUI is a peer to `tap-helper`, not a Hono package.

---

## 3. Dependency list

```toml
[package]
name = "handler-tui"
version = "0.1.0"
edition = "2021"

[dependencies]
# TUI
ratatui = { version = "0.29", features = ["crossterm"] }
crossterm = { version = "0.28", features = ["event-stream"] }

# Async
tokio = { version = "1.40", features = ["rt-multi-thread", "macros", "sync", "time", "signal", "io-util"] }
tokio-util = "0.7"
futures-util = "0.3"

# HTTP + WebSocket
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
tokio-tungstenite = { version = "0.24", features = ["rustls-tls-webpki-roots"] }
url = "2.5"

# Serde
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# CLI
clap = { version = "4.5", features = ["derive", "env"] }

# PTY emulation for tiled rendering
vt100 = "0.15"

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Error handling
anyhow = "1"
thiserror = "1"

# Optional desktop notifications (gated behind feature flag)
[features]
default = []
notify = ["dep:notify-rust"]

[dependencies.notify-rust]
version = "4.11"
optional = true
```

**Why these choices:**
- `ratatui 0.29` is the latest stable line; pairs with `crossterm 0.28` (re-exported via the `crossterm` feature).
- `tokio-tungstenite 0.24` for WebSocket — actively maintained, matches the server (Node `ws`).
- `vt100 0.15` for PTY-bytes → grid parsing (see §6).
- `rustls-tls` (no OpenSSL) so the binary stays portable — only matters if the user later proxies the server through TLS; for plain `ws://localhost` it's irrelevant.

---

## 4. Module layout

```
helpers/handler-tui/
├── Cargo.toml
└── src/
    ├── main.rs              # CLI parsing, tokio runtime entry, terminal raw-mode setup/teardown
    ├── config.rs            # Config struct: server URL resolution (flag → env → default)
    ├── app.rs               # AppState + main event loop dispatch; owns Mode enum (Dashboard/Attach/Tiled/Help)
    ├── event.rs             # crossterm EventStream merged with internal AppEvent tokio mpsc channel
    ├── api/
    │   ├── mod.rs
    │   ├── client.rs        # reqwest::Client wrapper, base_url, JSON helpers
    │   ├── types.rs         # serde mirrors of TS types: Sandbox, GuestMetrics, AgentInfo, TerminalSummary, SandboxStatus, TerminalStatus, SandboxBackend
    │   └── poller.rs        # spawn_pollers(): one tokio task per (resource × sandbox) emitting AppEvent::*Updated
    ├── ws/
    │   ├── mod.rs
    │   ├── protocol.rs      # ClientMsg / ServerMsg enums with #[serde(tag = "type")] mirroring §1 protocol
    │   └── session.rs       # WsSession: owns the connection, exposes input(bytes) + resize(cols, rows); spawns reader task that emits AppEvent::WsOutput
    ├── pty/
    │   ├── mod.rs
    │   └── grid.rs          # PtyGrid: wraps vt100::Parser, exposes resize() and a render_to_buffer(area, &mut Buffer) method
    ├── ui/
    │   ├── mod.rs
    │   ├── theme.rs         # Status color map: needs_input=Yellow, error=Red, working=Cyan, done=Green, idle=DarkGray
    │   ├── dashboard.rs     # render(&Frame, &AppState) — table widget
    │   ├── attach.rs        # render single PtyGrid full-screen with status bar
    │   ├── tiled.rs         # render N PtyGrid widgets in a layout::grid
    │   ├── help.rs          # render keybinding overlay
    │   └── status_bar.rs    # bottom bar: server URL, # sandboxes, notification ticker
    └── notify.rs            # NotificationCenter: track prev_status per sandbox, emit on transitions
```

**Threading model:**
- Single tokio runtime. UI on main task.
- One mpsc<AppEvent> channel into the UI loop.
- Producers: crossterm `EventStream` (input), per-resource HTTP pollers (sandboxes, per-sandbox metrics/agents/summary), per-attached-session WebSocket reader tasks.
- The UI never blocks; it consumes `AppEvent` and re-renders on a 30 Hz tick or on any event (whichever first).

**Key enums:**
```rust
enum Mode { Dashboard, Attach(SandboxId), Tiled(Vec<SandboxId>), Help }
enum AppEvent {
  Input(crossterm::event::Event),
  Tick,
  SandboxesUpdated(Vec<Sandbox>),
  MetricsUpdated(SandboxId, Option<GuestMetrics>),
  AgentsUpdated(SandboxId, Vec<AgentInfo>),
  SummaryUpdated(SandboxId, TerminalSummaryResult),
  WsOutput(SandboxId, Vec<u8>),
  WsConnected(SandboxId, Option<String>), // tmuxSession
  WsClosed(SandboxId, Option<String>),    // reason
  ApiError(String),
}
```

---

## 5. Polling strategy (mirror frontend exactly)

A single `spawn_pollers(client, tx, focus_set)` coordinator owns these tokio tasks:

| Task | Interval | Scope |
|---|---|---|
| `poll_sandboxes` | 2s if any sandbox is `starting`/`creating`/`building`, else 5s | Always running |
| `poll_metrics` | 5s | One per visible sandbox (dashboard rows + active tiles + attach target) |
| `poll_summary` | 5s | Same scope as metrics |
| `poll_agents` | 30s | Same scope as metrics |

Implementation notes:
- Use `tokio::time::interval` with `MissedTickBehavior::Skip`.
- On 5xx/network errors: log via `tracing::warn!`, send `AppEvent::ApiError(_)` (debounce: only forward 1/min to UI status bar), back off to 10s for that resource, return to normal cadence on next success.
- When a sandbox transitions away from `running`, immediately cancel its per-sandbox pollers (use a `HashMap<SandboxId, JoinHandle<()>>` keyed on resource).
- Concurrency cap: bound metrics/summary/agents polls at e.g. 16 concurrent inflight requests with a `tokio::sync::Semaphore` so a 50-sandbox dashboard doesn't hammer the server.

---

## 6. Terminal attach: WS client + PTY rendering

### WebSocket client (`src/ws/session.rs`)

```rust
// pseudocode
pub struct WsSession {
    tx_out: mpsc::Sender<ClientMsg>,    // input/resize/ping
    abort: AbortHandle,                  // for clean teardown
}
impl WsSession {
    pub async fn connect(url, sandbox: &Sandbox, cols, rows, app_tx: mpsc::Sender<AppEvent>) -> Result<Self> { ... }
    pub fn send_input(&self, bytes: &[u8]) { ... }
    pub fn resize(&self, cols: u16, rows: u16) { ... }
}
```

Start message dispatch — mirror `TerminalInstance.tsx:445-475`:
```
match sandbox.backend {
  Docker        => ClientMsg::Start { container_id: sandbox.id, shell: "/bin/bash", cols, rows, workdir: None, attach_tmux_session: None }
  Firecracker   => ClientMsg::StartVm { vm_id: sandbox.id, vm_ip: sandbox.guest_ip, shell: "/bin/bash", cols, rows, session_key: None, attach_tmux_session: None }
  Daytona       => ClientMsg::StartDaytona { sandbox_id: sandbox.id, cols, rows }
  Aws           => ClientMsg::StartAws { instance_id: sandbox.id, public_ip: sandbox.guest_ip, cols, rows }
  Azure/Gcp/DigitalOcean/Linode => StartGeneric { type: "start-{backend}", instance_id, public_ip, ssh_user: sandbox.ssh_user, cols, rows }
}
```

Use serde tag/rename to produce the right `type` discriminator. **Wire format gotcha**: existing TS uses camelCase keys (`containerId`, `vmId`, `vmIp`, `attachTmuxSession`). Use `#[serde(rename_all = "camelCase")]` on each variant. Only the **discriminator** (`type`) is kebab-case (`start-vm`, `start-aws`); use a manual `#[serde(rename = "start-vm")]` per variant.

### PTY rendering (`src/pty/grid.rs`)

Ratatui has no native PTY renderer. Three options:

1. **`vt100` crate** — small, pure-Rust VT100/xterm emulator. `vt100::Parser::process(bytes)` updates an internal grid; `parser.screen().cell(row, col)` returns fg/bg/attrs. **Recommended.**
2. **`alacritty_terminal`** — fuller xterm compat, but pulls in a heavier dependency tree (intended for Alacritty's renderer). Overkill for tile views.
3. **Direct write of raw bytes** — bypass ratatui's buffer and write to stdout with positioning. Workable for single-attach but breaks multi-pane layout.

Recommendation: **`vt100`**.

Implementation sketch:
```rust
pub struct PtyGrid {
    parser: vt100::Parser,        // own grid sized to widget area
    dirty: bool,
}
impl PtyGrid {
    pub fn new(rows: u16, cols: u16) -> Self { Self { parser: vt100::Parser::new(rows, cols, 1000), dirty: true } }
    pub fn feed(&mut self, bytes: &[u8]) { self.parser.process(bytes); self.dirty = true; }
    pub fn resize(&mut self, rows: u16, cols: u16) { self.parser.set_size(rows, cols); }
}
impl Widget for &PtyGrid {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let screen = self.parser.screen();
        for row in 0..area.height.min(screen.size().0) {
            for col in 0..area.width.min(screen.size().1) {
                let Some(cell) = screen.cell(row, col) else { continue };
                let target = buf.get_mut(area.x + col, area.y + row);
                target.set_symbol(cell.contents());
                target.set_style(vt100_to_ratatui_style(cell));
            }
        }
    }
}
```

Cursor rendering: read `screen.cursor_position()`, set the ratatui frame's cursor on the focused pane only (use `Frame::set_cursor_position`).

Resize protocol: on terminal resize event, compute the inner area for each visible pane, call `PtyGrid::resize` and `WsSession::resize` with the new (cols, rows). Debounce the WebSocket resize to 150ms to match `TerminalInstance.tsx:401-402`.

Input: any non-shortcut keypress → serialize to bytes (printable chars as UTF-8; arrow keys / function keys → CSI escapes per xterm conventions; crossterm provides `KeyEvent` → write a small ~40-line table).

### Session reattach on disconnect

Mirror frontend's behavior (`TerminalInstance.tsx:506-540`): on `session-not-found`, fall back to a fresh `start`. On unclean WebSocket close: try `resume`/`resume-vm` with the saved `sessionId`, up to 5 attempts with 2s delay, then surface an error and let the user re-attach manually.

---

## 7. Tiled view rendering

State: `Mode::Tiled(Vec<SandboxId>)`. Each id has a `PtyGrid` + `WsSession`. Default layout: `ratatui::layout::Layout` split into a near-square grid (1 → full screen, 2 → side-by-side, 3 → 2+1, 4 → 2x2, 5–6 → 3x2, etc. — compute `cols = ceil(sqrt(n))`, `rows = ceil(n/cols)`).

Focus: one tile is the "active" pane (cursor + input target). Tab cycles focus. `Enter` zooms focus to full screen (Mode::Attach).

Each tile shows: a 1-row header (sandbox name + status badge + agent badges) and the PtyGrid below. Inactive tiles get a dim border (`Style::default().fg(DarkGray)`); focused gets a colored border matching its terminal status.

Performance: with N tiles, each WebSocket emits PTY bytes asynchronously. Avoid re-rendering on every byte — coalesce: only redraw at 30 Hz max, set `dirty` on each PtyGrid feed, skip widgets whose `dirty == false` (ratatui re-renders the whole frame anyway, but we can short-circuit the per-cell loop if not dirty).

Cap: hard-limit tile count to e.g. 8. Show a toast if user tries to open a 9th.

---

## 8. Notifications

Trigger: `AppEvent::SummaryUpdated(id, result)` — if previous cached status was `working|done|idle` and new status is `needs_input` or `error`, fire a notification.

Mechanisms (all of the below, layered):
1. **Terminal bell**: write `\x07` once.
2. **Visual pulse in status bar**: a 3-second highlighted message in `status_bar.rs` ("⚠ sandbox foo: needs_input — sudo prompting for password").
3. **Persistent badge**: the row in the dashboard for that sandbox shows a pulsing red/yellow dot until the user views it (cursor lands on the row, or status changes again).
4. **Optional desktop**: gated behind `--features notify` and CLI flag `--desktop-notify`. Uses `notify-rust` (works on Linux via libnotify, macOS via NSUserNotification).

Implementation: `NotificationCenter` holds `HashMap<SandboxId, TerminalStatus>` of last-seen states + a VecDeque of unread events for the status bar ticker. Cleared on status change.

---

## 9. Layout & keybindings

### Dashboard screen (default)

```
┌ handler-tui — http://127.0.0.1:4001 ─────────── 12 sandboxes ─ 2 alerts ┐
│ NAME              BACKEND  STATUS   AI-STATUS    CPU  MEM  DISK  AGENTS │
│▶foo-vm            firecra. running  ⚠ needs_in.. 12%  34%  8%   [C][G] │
│ bar-docker        docker   running  ⚙ working    87%  42%  15%  [C]    │
│ baz-aws           aws      running  ✓ done       3%   12%  4%          │
│ qux-fc            firecra. stopped                                     │
│ ...                                                                   │
└─────────────────────────────── ↑/↓ navigate · Enter attach · ? help ───┘
```

Status badge characters: `⚠ needs_in..` (yellow), `✗ error` (red), `⚙ working` (cyan), `✓ done` (green), `· idle` (dim). Status column truncated to 12 chars; full summary in a detail panel toggled by `i`.

### Attach screen (single)

Full-screen PtyGrid + 1-row top bar (sandbox name, status, tmux session name) + 1-row bottom hint bar (`Ctrl-b d` detach back to dashboard).

### Tiled screen

Grid of PtyGrids; focused pane has thick border; bottom bar shows focused sandbox name.

### Keybindings

| Key | Mode | Action |
|---|---|---|
| `j` / `↓` | Dashboard | Select next sandbox |
| `k` / `↑` | Dashboard | Select previous |
| `Enter` | Dashboard | Attach (Mode::Attach) |
| `t` | Dashboard | Add selected to tile set; switch to Mode::Tiled |
| `T` | Dashboard | Replace tile set with all currently-`needs_input`/`error` sandboxes |
| `space` | Dashboard | Toggle selection in multiselect |
| `r` | Dashboard | Force-refresh now |
| `/` | Dashboard | Filter sandboxes by name (incremental) |
| `i` | Dashboard | Toggle detail panel for selected sandbox |
| `?` | Any | Toggle help overlay |
| `q` / `Ctrl-c` | Any | Quit (with confirmation if any WS sessions are attached) |
| `Tab` | Tiled | Cycle focus through tiles |
| `Shift-Tab` | Tiled | Reverse cycle |
| `n` | Tiled | Open sandbox picker to add tile |
| `x` | Tiled | Close focused tile (back to dashboard if last) |
| `Enter` | Tiled | Zoom focused tile (Mode::Attach) |
| `Esc` / `Ctrl-b d` | Attach | Detach (Mode::Dashboard or Mode::Tiled if came from there) |
| any other | Attach/Tiled focused | Forwarded to PTY as input |

---

## 10. Config (CLI + env + defaults)

```rust
#[derive(clap::Parser)]
#[command(name = "handler-tui", version, about = "Terminal dashboard for the Handler sandbox server")]
struct Cli {
  /// Handler server base URL (HTTP)
  #[arg(long, env = "HANDLER_SERVER", default_value = "http://127.0.0.1:4001")]
  server: String,

  /// Override the WebSocket URL (defaults to `<server>` with ws scheme + /ws/terminal)
  #[arg(long, env = "HANDLER_WS")]
  ws: Option<String>,

  /// Enable desktop notifications (requires `notify` feature)
  #[arg(long)]
  desktop_notify: bool,

  /// Log file path (default: ~/.cache/handler-tui/handler-tui.log)
  #[arg(long)]
  log_file: Option<PathBuf>,
}
```

WS URL derivation: take `--server`, swap `http→ws` / `https→wss`, append `/ws/terminal`. Mirrors `packages/web/src/api/client.ts:15-22`.

Remote use: server only listens on `127.0.0.1` (`packages/server/src/index.ts:715-717`). The TUI **must** run on the same host. Recommended workflow: `ssh user@host -- handler-tui` (or set up an SSH `LocalForward 4001 localhost:4001` and run the TUI locally, but then the WebSocket needs the forwarded port).

---

## 11. Build / dev integration

1. Create a root workspace `Cargo.toml` at the repo root.
2. Add the new crate at `helpers/handler-tui/`.
3. Update root `package.json` scripts:
   ```json
   "tui": "cargo run --release -p handler-tui --",
   "tui:dev": "cargo run -p handler-tui --",
   "tui:build": "cargo build --release -p handler-tui"
   ```
4. Add to `CLAUDE.md` and README a short "Terminal dashboard" section noting `pnpm tui`.
5. CI: extend whatever existing Rust check runs for `tap-helper` — likely just `cargo check --workspace` and `cargo test --workspace`.
6. Distribution: build a static-ish musl binary in release CI; copy into `dist/` alongside `tap-helper`.

---

## 12. Phased delivery

Each phase is independently shippable and merges cleanly.

### Phase 1 — Read-only dashboard (1–2 days)
- Workspace scaffold, crate, CLI, config, logging.
- HTTP client: list sandboxes, metrics, summary, agents (with the polling cadences above).
- ratatui main loop, dashboard widget (table), status bar.
- No WebSocket yet; no attach.
- **Deliverable**: a TUI that shows the running sandboxes with live status/metrics/agents.

### Phase 2 — Single-terminal attach (2–3 days)
- `ws/protocol.rs` + `ws/session.rs`.
- `pty/grid.rs` with `vt100`.
- `ui/attach.rs` + key forwarding.
- Resume-on-reconnect with saved `sessionId`.
- **Deliverable**: `Enter` from dashboard attaches; `Esc` detaches.

### Phase 3 — Tiled multi-terminal (1–2 days)
- `ui/tiled.rs`, Tab focus cycling, layout grid logic.
- Add/remove tile commands.
- Resize debouncing per tile.
- **Deliverable**: `t` builds a tile set; up to 8 panes side-by-side.

### Phase 4 — Notifications (0.5–1 day)
- `notify.rs` state tracking transitions.
- Bell + status bar visual pulse + persistent dashboard badge.
- Optional `notify-rust` behind feature flag.
- **Deliverable**: bell rings and status bar flashes when any sandbox flips to `needs_input` or `error`.

Optional later: filtering (`/`), detail panel (`i`), terminal capture previews on dashboard rows (using the `terminal-capture` endpoint + `vt100` headless render to a thumbnail).

---

## 13. Open questions / risks

1. **Auth**: server has no token. **Decision needed**: do we add a `--token` flag now and skip until the server gains auth? Recommendation: ship without auth (matches the rest of Handler), document the `127.0.0.1`-only binding as the security boundary.
2. **TLS**: same answer — server is plain `http://`. We include `rustls` in deps so a future reverse-proxy setup works without recompiling.
3. **WebSocket headers**: server doesn't check `Origin` or any auth headers in the upgrade (`packages/server/src/index.ts:276-278`). Plain connect works.
4. **Server-not-running UX**: HTTP poll fails → render a `Connection refused — is the Handler server running on http://127.0.0.1:4001?` banner; retry every 5s. WebSocket equivalent on attach.
5. **Tiled-view scaling**: 8 panes × 5s poll intervals × 4 endpoints = 32 inflight HTTP polls every 5s plus 8 WebSockets. The Semaphore in §5 caps concurrency; verify the server handles 32 concurrent `/metrics` requests gracefully (it shells out via SSH for VM backends — could be slow). Mitigation: when in tiled mode, drop poll cadence to 10s for non-focused tiles.
6. **PTY input encoding for special keys**: writing the full xterm key table by hand is error-prone. Consider depending on `termwiz` (heavy, ~30 transitive deps) just for `keymap.rs`, or write a focused table for the common keys (arrows, F1–F12, Home/End/PgUp/PgDn, Tab, Backspace, Ctrl-letters, Alt-letters). **Decision needed**: take the heavier dep or hand-roll ~80 lines? Recommendation: hand-roll — the keymap is well-documented and small.
7. **Tmux detach semantics**: from `TerminalInstance.tsx:548-553`, `session-update tmuxState: detached` means the user (or AI agent) typed `Ctrl-b d` inside the pane and the tmux client exited. The PTY is still alive; the next start will reattach. The TUI should treat this as a soft event (badge, not error).
8. **Disk usage on remote backends**: `getCloudMetricsViaSsh` reuses SSH ControlMaster (line 36-39 in `guest-metrics.ts`) — it's not the TUI's concern, but if the server CPU spikes from concurrent metrics calls, the TUI's polling is the most likely trigger.
9. **Unicode width / emoji in summary text**: ratatui renders by display width. Use `unicode-width` crate or accept occasional one-column overflow in the AI summary column.
10. **Color theme**: ratatui inherits the host terminal's palette. Validate against both a dark and light scheme — the existing canvas has a dark-first aesthetic, the TUI should mirror.

---

### Critical Files for Implementation
- `packages/server/src/routes/sandboxes.ts` (HTTP endpoint shapes — lines 268, 1587, 1653, 1703, 1760)
- `packages/server/src/index.ts` (WebSocket protocol — lines 275-619, server bind 715-723)
- `packages/web/src/components/Terminal/TerminalInstance.tsx` (canonical WS client to mirror — lines 408-560)
- `packages/web/src/hooks/useSandboxes.ts` (polling cadences — lines 23-30, 443, 456, 499)
- `helpers/tap-helper/Cargo.toml` (existing Rust conventions to mirror)
