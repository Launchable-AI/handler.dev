use std::collections::{HashMap, HashSet};
use std::io;
use std::time::{Duration, Instant};

use anyhow::Result;
use crossterm::event::{Event, EventStream, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use futures_util::StreamExt;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::Terminal;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::api::types::{AgentInfo, GuestMetrics, Sandbox, SandboxStatus, TerminalSummaryResponse};
use crate::api::{poller, ApiClient};
use crate::event::{new_tile_id, AppEvent, SandboxId, TileId};
use crate::notify::{self, NotificationCenter};
use crate::pty::{encode_key, PtyGrid};
use crate::ui;
use crate::ws::{derive_ws_url, WsSession};

pub const MAX_TILES: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    Dashboard,
    Help,
    Session,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TileConnectionState {
    Connecting,
    Connected,
    Exited,
    ServerError,
    Closed,
}

pub struct SessionTile {
    pub tile_id: TileId,
    pub sandbox_id: SandboxId,
    pub sandbox_name: String,
    pub backend_label: &'static str,
    pub session: Option<WsSession>,
    pub session_id: Option<String>,
    pub tmux_session: Option<String>,
    pub tmux_state: Option<String>,
    pub grid: PtyGrid,
    pub state: TileConnectionState,
    pub error: Option<String>,
    pub exit_code: Option<i32>,
    /// Per-tile terminal summary (captured from this tile's tmux session specifically).
    /// Falls back to sandbox-level summary in the UI when None.
    pub summary: Option<TerminalSummaryResponse>,
    /// Per-tile summary-polling task handle. None until tmux session is known.
    pub summary_poller: Option<tokio::task::JoinHandle<()>>,
}

impl SessionTile {
    pub fn new(tile_id: TileId, sandbox: &Sandbox, cols: u16, rows: u16) -> Self {
        Self {
            tile_id,
            sandbox_id: sandbox.id.clone(),
            sandbox_name: sandbox.name.clone(),
            backend_label: sandbox.backend.short(),
            session: None,
            session_id: None,
            tmux_session: None,
            tmux_state: None,
            grid: PtyGrid::new(rows, cols),
            state: TileConnectionState::Connecting,
            error: None,
            exit_code: None,
            summary: None,
            summary_poller: None,
        }
    }
}

pub struct AppState {
    pub mode: Mode,
    pub sandboxes: Vec<Sandbox>,
    pub metrics: HashMap<SandboxId, GuestMetrics>,
    pub summaries: HashMap<SandboxId, TerminalSummaryResponse>,
    pub agents: HashMap<SandboxId, Vec<AgentInfo>>,
    pub selected: usize,
    pub server_url: String,
    pub last_error: Option<(Instant, String)>,
    pub last_update: Option<Instant>,
    pub term_cols: u16,
    pub term_rows: u16,
    pub sessions: Vec<SessionTile>,
    pub focused_session: usize,
    pub focused_fullscreen: bool,
    pub prefix_pending: bool,
    pub selected_for_tile: HashSet<SandboxId>,
    pub ws_url: String,
    pub notifications: NotificationCenter,
    pub desktop_notify: bool,
    pub api: ApiClient,
    /// Whether to render the persistent sidebar in session mode (Ctrl-A b toggles).
    pub show_sidebar: bool,
}

impl AppState {
    pub fn new(
        server_url: String,
        ws_url: String,
        desktop_notify: bool,
        api: ApiClient,
    ) -> Self {
        Self {
            mode: Mode::Dashboard,
            sandboxes: Vec::new(),
            metrics: HashMap::new(),
            summaries: HashMap::new(),
            agents: HashMap::new(),
            selected: 0,
            server_url,
            last_error: None,
            last_update: None,
            term_cols: 80,
            term_rows: 24,
            sessions: Vec::new(),
            focused_session: 0,
            focused_fullscreen: true,
            prefix_pending: false,
            selected_for_tile: HashSet::new(),
            ws_url,
            notifications: NotificationCenter::new(),
            desktop_notify,
            api,
            show_sidebar: true,
        }
    }

    pub fn select_next(&mut self) {
        if !self.sandboxes.is_empty() {
            self.selected = (self.selected + 1).min(self.sandboxes.len() - 1);
        }
    }

    pub fn select_prev(&mut self) {
        self.selected = self.selected.saturating_sub(1);
    }

    pub fn current_error(&self) -> Option<&str> {
        self.last_error.as_ref().and_then(|(at, msg)| {
            if at.elapsed() < Duration::from_secs(15) {
                Some(msg.as_str())
            } else {
                None
            }
        })
    }

    fn selected_sandbox(&self) -> Option<&Sandbox> {
        self.sandboxes.get(self.selected)
    }

    /// PTY dimensions for a single-fullscreen tile, accounting for the sidebar.
    fn pty_dims(&self) -> (u16, u16) {
        let cols = self.main_area_width().max(1);
        let rows = self.term_rows.saturating_sub(2).max(1);
        (cols, rows)
    }

    /// PTY dimensions for one tile in tiled mode with `tile_count` tiles, accounting
    /// for the sidebar, the footer row, and the per-tile border (2 cols + 2 rows).
    fn pty_dims_tiled(&self, tile_count: usize) -> (u16, u16) {
        let (gc, gr) = tile_grid_dims(tile_count);
        let main_w = self.main_area_width();
        let main_h = self.term_rows.saturating_sub(1); // tiled.rs reserves 1 footer row
        let tile_w = (main_w / gc).saturating_sub(2).max(1); // -2 for tile border
        let tile_h = (main_h / gr).saturating_sub(2).max(1);
        (tile_w, tile_h)
    }

    fn main_area_width(&self) -> u16 {
        if self.show_sidebar && self.term_cols >= crate::ui::sidebar::SIDEBAR_WIDTH + 40 {
            self.term_cols.saturating_sub(crate::ui::sidebar::SIDEBAR_WIDTH)
        } else {
            self.term_cols
        }
    }

    pub fn focused_tile(&self) -> Option<&SessionTile> {
        self.sessions.get(self.focused_session)
    }

    pub fn is_single_fullscreen(&self) -> bool {
        self.sessions.len() == 1 || self.focused_fullscreen
    }

    fn tile_index_for(&self, tile_id: &str) -> Option<usize> {
        self.sessions.iter().position(|t| t.tile_id == tile_id)
    }
}

pub async fn run(api: ApiClient, desktop_notify: bool) -> Result<()> {
    let server_url = api.base_url().to_string();
    let ws_url = derive_ws_url(&server_url)?;
    let mut state = AppState::new(server_url, ws_url, desktop_notify, api.clone());

    let (tx, mut rx) = unbounded_channel::<AppEvent>();
    let _poller = poller::spawn(api.clone(), tx.clone());

    let input_task = spawn_input_task(tx.clone());

    let stdout = io::stdout();
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    let size = terminal.size()?;
    state.term_cols = size.width;
    state.term_rows = size.height;

    draw(&mut terminal, &mut state)?;

    let mut quit = false;
    while !quit {
        let event = match rx.recv().await {
            Some(e) => e,
            None => break,
        };

        let mut pending = vec![event];
        while let Ok(e) = rx.try_recv() {
            pending.push(e);
        }

        let mut needs_draw = false;
        for ev in pending {
            match handle_event(&mut state, ev, &tx).await {
                Action::Quit => quit = true,
                Action::Redraw => needs_draw = true,
                Action::None => {}
            }
        }

        if needs_draw && !quit {
            draw(&mut terminal, &mut state)?;
        }
    }

    for tile in state.sessions.drain(..) {
        if let Some(s) = tile.session {
            s.close();
        }
    }
    input_task.abort();
    Ok(())
}

enum Action {
    None,
    Redraw,
    Quit,
}

async fn handle_event(
    state: &mut AppState,
    event: AppEvent,
    tx: &UnboundedSender<AppEvent>,
) -> Action {
    match event {
        AppEvent::Input(Event::Key(key)) => handle_key(state, key, tx).await,
        AppEvent::Input(Event::Resize(cols, rows)) => {
            state.term_cols = cols;
            state.term_rows = rows;
            Action::Redraw
        }
        AppEvent::Input(_) => Action::None,
        // Tick is fired by deferred timers (toast expiry) — just trigger a redraw so
        // expired toasts disappear.
        AppEvent::Tick => Action::Redraw,
        AppEvent::SandboxesUpdated(list) => {
            state.sandboxes = list;
            state.last_update = Some(Instant::now());
            let ids: HashSet<&String> = state.sandboxes.iter().map(|s| &s.id).collect();
            state.metrics.retain(|k, _| ids.contains(k));
            state.summaries.retain(|k, _| ids.contains(k));
            state.agents.retain(|k, _| ids.contains(k));
            state.selected_for_tile.retain(|id| ids.contains(id));
            let keep_ids: HashSet<SandboxId> = state.sandboxes.iter().map(|s| s.id.clone()).collect();
            state.notifications.retain_ids(|id| keep_ids.contains(id));
            if state.selected >= state.sandboxes.len() && !state.sandboxes.is_empty() {
                state.selected = state.sandboxes.len() - 1;
            }
            // If any attached tile's sandbox stopped, mark its session closed.
            let stopped_ids: Vec<String> = state
                .sessions
                .iter()
                .filter_map(|t| {
                    let still_running = state
                        .sandboxes
                        .iter()
                        .any(|s| s.id == t.sandbox_id && s.status == SandboxStatus::Running);
                    if !still_running
                        && matches!(
                            t.state,
                            TileConnectionState::Connected | TileConnectionState::Connecting
                        )
                    {
                        Some(t.sandbox_id.clone())
                    } else {
                        None
                    }
                })
                .collect();
            for id in stopped_ids {
                if let Some(tile) = state.sessions.iter_mut().find(|t| t.sandbox_id == id) {
                    tile.state = TileConnectionState::Closed;
                    tile.error = Some("sandbox is no longer running".into());
                    if let Some(s) = tile.session.take() {
                        s.close();
                    }
                }
            }
            redraw_if_dashboard(state)
        }
        AppEvent::MetricsUpdated(id, m) => {
            if let Some(m) = m {
                state.metrics.insert(id, m);
            } else {
                state.metrics.remove(&id);
            }
            redraw_if_dashboard(state)
        }
        AppEvent::SummaryUpdated(id, s) => {
            let sandbox_name = state
                .sandboxes
                .iter()
                .find(|sb| sb.id == id)
                .map(|sb| sb.name.clone())
                .unwrap_or_else(|| id.clone());
            let summary_text = s.summary.clone().unwrap_or_default();
            let new_alert = state.notifications.on_status_update(
                &id,
                &sandbox_name,
                &summary_text,
                s.status,
            );
            if new_alert {
                notify::ring_bell();
                if let Some(status) = s.status {
                    if state.desktop_notify {
                        notify::fire_desktop_notification(&sandbox_name, status, &summary_text);
                    }
                }
                // Schedule a redraw 3s out so the toast disappears without further events.
                let app_tx = tx.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    let _ = app_tx.send(AppEvent::Tick);
                });
            }
            state.summaries.insert(id, s);
            Action::Redraw
        }
        AppEvent::AgentsUpdated(id, a) => {
            state.agents.insert(id, a);
            redraw_if_dashboard(state)
        }
        AppEvent::ApiError(msg) => {
            state.last_error = Some((Instant::now(), msg));
            Action::Redraw
        }
        AppEvent::WsAttachReady(tile_id, session) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                state.sessions[idx].session = Some(session);
            } else {
                session.close();
            }
            Action::None
        }
        AppEvent::WsAttachFailed(tile_id, msg) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                state.sessions[idx].state = TileConnectionState::ServerError;
                state.sessions[idx].error = Some(msg);
                return redraw_if_session(state);
            }
            Action::None
        }
        AppEvent::WsConnected {
            tile_id,
            session_id,
            tmux_session,
            resumed: _,
        } => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                let tile = &mut state.sessions[idx];
                tile.state = TileConnectionState::Connected;
                tile.session_id = session_id;
                tile.tmux_session = tmux_session.clone();
                if tmux_session.is_some() {
                    tile.tmux_state = Some("connected".into());
                }
                // Once we know the tmux session name, start polling per-tile summary.
                if tmux_session.is_some() && tile.summary_poller.is_none() {
                    let api = state.api.clone();
                    let sandbox_id = tile.sandbox_id.clone();
                    let tmux_name = tmux_session.clone().unwrap();
                    let tid = tile.tile_id.clone();
                    let app_tx = tx.clone();
                    let handle = tokio::spawn(async move {
                        let mut interval = tokio::time::interval(Duration::from_secs(5));
                        interval
                            .set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                        loop {
                            interval.tick().await;
                            if let Ok(r) =
                                api.get_terminal_summary(&sandbox_id, Some(&tmux_name)).await
                            {
                                if app_tx
                                    .send(AppEvent::TileSummaryUpdated(tid.clone(), r))
                                    .is_err()
                                {
                                    return;
                                }
                            }
                        }
                    });
                    tile.summary_poller = Some(handle);
                }
                return redraw_if_session(state);
            }
            Action::None
        }
        AppEvent::WsOutput(tile_id, bytes) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                state.sessions[idx].grid.feed(&bytes);
                return redraw_if_session(state);
            }
            Action::None
        }
        AppEvent::WsSessionUpdate(tile_id, tmux_state) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                state.sessions[idx].tmux_state = Some(tmux_state);
                return redraw_if_session(state);
            }
            Action::None
        }
        AppEvent::WsExit(tile_id, code) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                state.sessions[idx].state = TileConnectionState::Exited;
                state.sessions[idx].exit_code = code;
                return redraw_if_session(state);
            }
            Action::None
        }
        AppEvent::WsError(tile_id, msg) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                state.sessions[idx].state = TileConnectionState::ServerError;
                state.sessions[idx].error = Some(msg);
                return redraw_if_session(state);
            }
            Action::None
        }
        AppEvent::WsClosed(tile_id, reason) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                let tile = &mut state.sessions[idx];
                if !matches!(
                    tile.state,
                    TileConnectionState::Exited | TileConnectionState::ServerError
                ) {
                    tile.state = TileConnectionState::Closed;
                    if tile.error.is_none() {
                        tile.error = reason.or(Some("connection closed".into()));
                    }
                }
                return redraw_if_session(state);
            }
            Action::None
        }
        AppEvent::TileSummaryUpdated(tile_id, summary) => {
            if let Some(idx) = state.tile_index_for(&tile_id) {
                state.sessions[idx].summary = Some(summary);
                return redraw_if_session(state);
            }
            Action::None
        }
    }
}

fn redraw_if_dashboard(state: &AppState) -> Action {
    if matches!(state.mode, Mode::Dashboard | Mode::Help) {
        Action::Redraw
    } else {
        Action::None
    }
}

fn redraw_if_session(state: &AppState) -> Action {
    if state.mode == Mode::Session {
        Action::Redraw
    } else {
        Action::None
    }
}

async fn handle_key(
    state: &mut AppState,
    key: KeyEvent,
    tx: &UnboundedSender<AppEvent>,
) -> Action {
    if key.kind != KeyEventKind::Press {
        return Action::None;
    }

    // Ctrl-C in dashboard/help quits; in session it's forwarded as a normal key.
    if matches!(state.mode, Mode::Dashboard | Mode::Help)
        && key.modifiers.contains(KeyModifiers::CONTROL)
        && matches!(key.code, KeyCode::Char('c'))
    {
        return Action::Quit;
    }

    match &state.mode {
        Mode::Help => match key.code {
            KeyCode::Char('?') | KeyCode::Esc | KeyCode::Char('q') => {
                state.mode = Mode::Dashboard;
                Action::Redraw
            }
            _ => Action::None,
        },
        Mode::Dashboard => handle_dashboard_key(state, key, tx),
        Mode::Session => handle_session_key(state, key, tx),
    }
}

fn handle_dashboard_key(
    state: &mut AppState,
    key: KeyEvent,
    tx: &UnboundedSender<AppEvent>,
) -> Action {
    match key.code {
        KeyCode::Char('q') => Action::Quit,
        KeyCode::Char('?') => {
            state.mode = Mode::Help;
            Action::Redraw
        }
        KeyCode::Char('j') | KeyCode::Down => {
            state.select_next();
            acknowledge_current_selection(state);
            Action::Redraw
        }
        KeyCode::Char('k') | KeyCode::Up => {
            state.select_prev();
            acknowledge_current_selection(state);
            Action::Redraw
        }
        KeyCode::Char('g') | KeyCode::Home => {
            state.selected = 0;
            acknowledge_current_selection(state);
            Action::Redraw
        }
        KeyCode::Char('G') | KeyCode::End => {
            if !state.sandboxes.is_empty() {
                state.selected = state.sandboxes.len() - 1;
            }
            acknowledge_current_selection(state);
            Action::Redraw
        }
        KeyCode::Char(' ') => {
            // Toggle the cursor sandbox's membership in the tile set.
            if let Some(sandbox) = state.selected_sandbox() {
                let id = sandbox.id.clone();
                if !state.selected_for_tile.remove(&id) {
                    if state.selected_for_tile.len() < MAX_TILES {
                        state.selected_for_tile.insert(id);
                    } else {
                        state.last_error = Some((
                            Instant::now(),
                            format!("max {MAX_TILES} tiles; deselect one first"),
                        ));
                    }
                }
            }
            Action::Redraw
        }
        KeyCode::Char('c') => {
            // Clear tile-selection set.
            state.selected_for_tile.clear();
            Action::Redraw
        }
        KeyCode::Char('s') => {
            // Toggle start/stop for the cursor sandbox. Fire-and-forget; the next poll
            // (already at the 2s adaptive cadence while transitioning) updates the row.
            let Some(sandbox) = state.selected_sandbox() else {
                return Action::None;
            };
            let id = sandbox.id.clone();
            let name = sandbox.name.clone();
            let action = match sandbox.status {
                SandboxStatus::Stopped | SandboxStatus::Archived => Some("start"),
                SandboxStatus::Running => Some("stop"),
                SandboxStatus::Paused => Some("start"),
                _ => None, // transient states (creating/starting/stopping/building/error): no-op
            };
            let Some(action) = action else {
                state.last_error = Some((
                    Instant::now(),
                    format!(
                        "cannot toggle '{}' ({}): wait for current operation to finish",
                        name,
                        sandbox.status.label()
                    ),
                ));
                return Action::Redraw;
            };
            let api = state.api.clone();
            let app_tx = tx.clone();
            tokio::spawn(async move {
                let res = match action {
                    "start" => api.start_sandbox(&id).await,
                    "stop" => api.stop_sandbox(&id).await,
                    _ => unreachable!(),
                };
                if let Err(e) = res {
                    let _ = app_tx.send(AppEvent::ApiError(format!("{action} {name}: {e}")));
                }
            });
            Action::None
        }
        KeyCode::Enter => {
            // Build a session: tile set if non-empty, otherwise just the cursor sandbox.
            let ids: Vec<String> = if !state.selected_for_tile.is_empty() {
                // Preserve sandbox-list order for determinism.
                state
                    .sandboxes
                    .iter()
                    .filter(|s| state.selected_for_tile.contains(&s.id))
                    .map(|s| s.id.clone())
                    .collect()
            } else if let Some(s) = state.selected_sandbox() {
                vec![s.id.clone()]
            } else {
                return Action::None;
            };

            let sandboxes: Vec<Sandbox> = ids
                .iter()
                .filter_map(|id| state.sandboxes.iter().find(|s| &s.id == id).cloned())
                .filter(|s| s.status == SandboxStatus::Running)
                .collect();

            if sandboxes.is_empty() {
                state.last_error = Some((
                    Instant::now(),
                    "no running sandboxes in selection".into(),
                ));
                return Action::Redraw;
            }

            start_session(state, sandboxes, tx.clone());
            Action::Redraw
        }
        _ => Action::None,
    }
}

fn handle_session_key(
    state: &mut AppState,
    key: KeyEvent,
    tx: &UnboundedSender<AppEvent>,
) -> Action {
    // Prefix-key handling (Ctrl-A is the TUI command prefix, screen-style).
    if state.prefix_pending {
        state.prefix_pending = false;
        return handle_prefix_subcommand(state, key, tx);
    }

    // Bare Ctrl-A enters prefix mode (always — even if focused tile is dead, so the
    // user can detach).
    if key.modifiers.contains(KeyModifiers::CONTROL) && matches!(key.code, KeyCode::Char('a')) {
        state.prefix_pending = true;
        return Action::Redraw;
    }

    // If the focused tile's session has ended, Esc/q/Enter detaches.
    let focused_alive = state
        .focused_tile()
        .is_some_and(|t| matches!(t.state, TileConnectionState::Connected));
    if !focused_alive {
        if matches!(
            key.code,
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Enter
        ) {
            close_focused_tile(state);
            return Action::Redraw;
        }
        return Action::None;
    }

    // Forward the key to the focused tile's PTY.
    let Some(tile) = state.sessions.get(state.focused_session) else {
        return Action::None;
    };
    if let Some(bytes) = encode_key(key, tile.grid.application_cursor()) {
        if let Some(s) = &tile.session {
            if let Ok(s_str) = std::str::from_utf8(&bytes) {
                s.send_input(s_str.to_string());
            }
        }
    }
    Action::None
}

fn handle_prefix_subcommand(
    state: &mut AppState,
    key: KeyEvent,
    tx: &UnboundedSender<AppEvent>,
) -> Action {
    // Literal Ctrl-A: prefix followed by Ctrl-A sends the byte through.
    if key.modifiers.contains(KeyModifiers::CONTROL) && matches!(key.code, KeyCode::Char('a')) {
        if let Some(tile) = state.sessions.get(state.focused_session) {
            if let Some(s) = &tile.session {
                s.send_input("\x01".to_string());
            }
        }
        return Action::None;
    }

    match key.code {
        KeyCode::Char('d') | KeyCode::Char('D') => {
            // Detach all and return to dashboard.
            detach_all(state);
            Action::Redraw
        }
        KeyCode::Char('z') | KeyCode::Char('Z') => {
            // Toggle focused-fullscreen.
            state.focused_fullscreen = !state.focused_fullscreen;
            Action::Redraw
        }
        KeyCode::Char('b') | KeyCode::Char('B') => {
            // Toggle the running-sandboxes sidebar.
            state.show_sidebar = !state.show_sidebar;
            Action::Redraw
        }
        KeyCode::Char('k') | KeyCode::Char('K') | KeyCode::Char('x') | KeyCode::Char('X') => {
            close_focused_tile(state);
            Action::Redraw
        }
        KeyCode::Char('n') | KeyCode::Char('N') => {
            // Spawn a new tile in the focused tile's sandbox (fresh sessionKey →
            // independent tmux session inside the same VM).
            if state.sessions.len() >= MAX_TILES {
                state.last_error = Some((
                    Instant::now(),
                    format!("max {MAX_TILES} tiles; close one first"),
                ));
                return Action::Redraw;
            }
            let Some(focused) = state.sessions.get(state.focused_session) else {
                return Action::None;
            };
            let Some(sandbox) = state
                .sandboxes
                .iter()
                .find(|s| s.id == focused.sandbox_id)
                .cloned()
            else {
                state.last_error = Some((
                    Instant::now(),
                    "focused tile's sandbox is no longer in the list".into(),
                ));
                return Action::Redraw;
            };
            if sandbox.status != SandboxStatus::Running {
                state.last_error = Some((
                    Instant::now(),
                    format!("sandbox '{}' is not running", sandbox.name),
                ));
                return Action::Redraw;
            }
            // Compute per-tile dimensions for the new (larger) tile count.
            let new_count = state.sessions.len() + 1;
            let (cols, rows) = state.pty_dims_tiled(new_count);
            let tile_id = new_tile_id();
            let tile = SessionTile::new(tile_id.clone(), &sandbox, cols, rows);
            state.sessions.push(tile);
            // Adding a tile turns off fullscreen unless we're zooming intentionally.
            if state.sessions.len() > 1 {
                state.focused_fullscreen = false;
            }
            state.focused_session = state.sessions.len() - 1;
            spawn_tile_connect(state.ws_url.clone(), sandbox, tile_id, cols, rows, tx.clone());
            Action::Redraw
        }
        KeyCode::Tab => {
            if !state.sessions.is_empty() {
                state.focused_session = (state.focused_session + 1) % state.sessions.len();
            }
            Action::Redraw
        }
        KeyCode::BackTab => {
            if !state.sessions.is_empty() {
                state.focused_session = if state.focused_session == 0 {
                    state.sessions.len() - 1
                } else {
                    state.focused_session - 1
                };
            }
            Action::Redraw
        }
        KeyCode::Char('?') => {
            state.mode = Mode::Help;
            Action::Redraw
        }
        _ => Action::Redraw,
    }
}

fn acknowledge_current_selection(state: &mut AppState) {
    if let Some(s) = state.selected_sandbox() {
        let id = s.id.clone();
        state.notifications.acknowledge(&id);
    }
}

fn close_focused_tile(state: &mut AppState) {
    if state.sessions.is_empty() {
        state.mode = Mode::Dashboard;
        return;
    }
    let mut removed = state.sessions.remove(state.focused_session);
    if let Some(s) = removed.session.take() {
        s.close();
    }
    if let Some(h) = removed.summary_poller.take() {
        h.abort();
    }
    if state.sessions.is_empty() {
        state.mode = Mode::Dashboard;
        state.focused_session = 0;
        state.focused_fullscreen = true;
        state.selected_for_tile.clear();
    } else if state.focused_session >= state.sessions.len() {
        state.focused_session = state.sessions.len() - 1;
    }
}

fn detach_all(state: &mut AppState) {
    for mut tile in state.sessions.drain(..) {
        if let Some(s) = tile.session.take() {
            s.close();
        }
        if let Some(h) = tile.summary_poller.take() {
            h.abort();
        }
    }
    state.mode = Mode::Dashboard;
    state.focused_session = 0;
    state.focused_fullscreen = true;
    state.selected_for_tile.clear();
}

fn start_session(state: &mut AppState, sandboxes: Vec<Sandbox>, tx: UnboundedSender<AppEvent>) {
    // Compute per-tile dimensions to match what `draw()` will allocate after the sidebar
    // and per-tile borders are taken into account. Matching at start avoids a post-connect
    // resize that causes tmux to leave stale status-bar fragments in the grid.
    let count = sandboxes.len().min(MAX_TILES);
    let fullscreen = count == 1;
    let (cols, rows) = if fullscreen {
        state.pty_dims()
    } else {
        state.pty_dims_tiled(count)
    };

    state.sessions.clear();
    state.selected_for_tile.clear();
    state.focused_session = 0;
    state.focused_fullscreen = fullscreen;
    state.prefix_pending = false;

    for sandbox in sandboxes.into_iter().take(MAX_TILES) {
        let tile_id = new_tile_id();
        let tile = SessionTile::new(tile_id.clone(), &sandbox, cols, rows);
        state.notifications.acknowledge(&tile.sandbox_id);
        state.sessions.push(tile);
        spawn_tile_connect(state.ws_url.clone(), sandbox, tile_id, cols, rows, tx.clone());
    }

    state.mode = Mode::Session;
}

fn spawn_tile_connect(
    ws_url: String,
    sandbox: Sandbox,
    tile_id: TileId,
    cols: u16,
    rows: u16,
    app_tx: UnboundedSender<AppEvent>,
) {
    tokio::spawn(async move {
        match WsSession::connect(ws_url, &sandbox, tile_id.clone(), cols, rows, app_tx.clone())
            .await
        {
            Ok(s) => {
                let _ = app_tx.send(AppEvent::WsAttachReady(tile_id, s));
            }
            Err(e) => {
                let _ = app_tx.send(AppEvent::WsAttachFailed(tile_id, e.to_string()));
            }
        }
    });
}

/// Hardcoded layout that picks a reasonable (cols, rows) split for up to MAX_TILES tiles.
pub fn tile_grid_dims(n: usize) -> (u16, u16) {
    match n {
        0 | 1 => (1, 1),
        2 => (2, 1),
        3 => (3, 1),
        4 => (2, 2),
        5 | 6 => (3, 2),
        _ => (4, 2),
    }
}

fn draw(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    state: &mut AppState,
) -> Result<()> {
    terminal.draw(|f| {
        let area = f.area();
        match state.mode {
            Mode::Session => {
                if state.sessions.is_empty() {
                    state.mode = Mode::Dashboard;
                    render_dashboard(f, area, state);
                    return;
                }

                // Carve out a left sidebar if enabled and the terminal is wide enough
                // to leave a usable main area (need at least ~40 cols for the PTY).
                let (sidebar_area, main_area) =
                    if state.show_sidebar && area.width >= ui::sidebar::SIDEBAR_WIDTH + 40 {
                        let parts = ratatui::layout::Layout::default()
                            .direction(ratatui::layout::Direction::Horizontal)
                            .constraints([
                                ratatui::layout::Constraint::Length(ui::sidebar::SIDEBAR_WIDTH),
                                ratatui::layout::Constraint::Min(1),
                            ])
                            .split(area);
                        (Some(parts[0]), parts[1])
                    } else {
                        (None, area)
                    };

                if let Some(s_area) = sidebar_area {
                    ui::sidebar::render(f, s_area, state);
                }

                if state.is_single_fullscreen() {
                    ui::attach::render(
                        f,
                        main_area,
                        &mut state.sessions[state.focused_session],
                        state.prefix_pending,
                    );
                } else {
                    ui::tiled::render(
                        f,
                        main_area,
                        &mut state.sessions,
                        state.focused_session,
                        state.prefix_pending,
                    );
                }
            }
            Mode::Dashboard | Mode::Help => {
                render_dashboard(f, area, state);
                if state.mode == Mode::Help {
                    ui::help::render(f, area);
                }
            }
        }
    })?;
    Ok(())
}

fn render_dashboard(
    f: &mut ratatui::Frame,
    area: ratatui::layout::Rect,
    state: &AppState,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(1)])
        .split(area);
    ui::dashboard::render(f, chunks[0], state);
    ui::status_bar::render(f, chunks[1], state);
}

fn spawn_input_task(tx: UnboundedSender<AppEvent>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut stream = EventStream::new();
        loop {
            match stream.next().await {
                Some(Ok(ev)) => {
                    if tx.send(AppEvent::Input(ev)).is_err() {
                        return;
                    }
                }
                Some(Err(_)) => continue,
                None => return,
            }
        }
    })
}
