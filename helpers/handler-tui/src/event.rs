use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crossterm::event::Event as CrosstermEvent;

use crate::api::types::{AgentInfo, GuestMetrics, Sandbox, TerminalSummaryResponse};

pub type SandboxId = String;
pub type TileId = String;

static TILE_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Generate a fresh tile id. Used as the `sessionKey` on the WS `start-vm` message,
/// which causes the server to allocate an independent tmux session per tile (so multiple
/// tiles pointing to the same VM get independent shells).
pub fn new_tile_id() -> String {
    let n = TILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("tui-{millis:x}-{n:x}")
}

#[derive(Debug)]
#[allow(dead_code)] // `Tick` reserved for animations in later phases
pub enum AppEvent {
    Input(CrosstermEvent),
    Tick,

    // Sandbox-level events (keyed by SandboxId — shared by all tiles for that sandbox).
    SandboxesUpdated(Vec<Sandbox>),
    MetricsUpdated(SandboxId, Option<GuestMetrics>),
    AgentsUpdated(SandboxId, Vec<AgentInfo>),
    SummaryUpdated(SandboxId, TerminalSummaryResponse),
    ApiError(String),

    // Tile-level events (keyed by TileId — multiple tiles can share SandboxId).
    /// Server accepted the start/resume; we now have a session id and (for tmux-backed
    /// sessions) the tmux session name.
    WsConnected {
        tile_id: TileId,
        session_id: Option<String>,
        tmux_session: Option<String>,
        resumed: bool,
    },
    /// PTY output bytes (already UTF-8 from the server's JSON string).
    WsOutput(TileId, Vec<u8>),
    /// tmux state transition: "connected" / "detached" / "unavailable".
    WsSessionUpdate(TileId, String),
    /// Inner shell/process exited.
    WsExit(TileId, Option<i32>),
    /// Server-side error message (e.g., SSH key missing).
    WsError(TileId, String),
    /// WebSocket closed (peer or local). Optional reason from the close frame.
    WsClosed(TileId, Option<String>),
    /// Connect task succeeded — hand the live session over to the app loop.
    WsAttachReady(TileId, crate::ws::WsSession),
    /// Connect task failed before we had a session.
    WsAttachFailed(TileId, String),
    /// Per-tile terminal summary (captured from this tile's tmux session specifically).
    TileSummaryUpdated(TileId, TerminalSummaryResponse),
}
