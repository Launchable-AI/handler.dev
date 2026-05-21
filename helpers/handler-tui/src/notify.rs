use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::api::types::TerminalStatus;
use crate::event::SandboxId;

const TOAST_DURATION: Duration = Duration::from_secs(3);

#[derive(Debug, Clone)]
pub struct ActiveAlert {
    pub status: TerminalStatus,
    pub sandbox_name: String,
    #[allow(dead_code)]
    pub summary: String,
    pub raised_at: Instant,
    pub acknowledged: bool,
}

#[derive(Debug, Clone)]
pub struct Toast {
    pub message: String,
    pub status: TerminalStatus,
    pub raised_at: Instant,
}

#[derive(Default)]
pub struct NotificationCenter {
    last_status: HashMap<SandboxId, TerminalStatus>,
    active: HashMap<SandboxId, ActiveAlert>,
    toast: Option<Toast>,
}

impl NotificationCenter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process a terminal-summary update for a sandbox. Returns true if this is the
    /// edge that flipped a sandbox from non-alert (or first-seen) into an alert state.
    /// Callers should ring the bell on `true`.
    pub fn on_status_update(
        &mut self,
        id: &SandboxId,
        sandbox_name: &str,
        summary: &str,
        new_status: Option<TerminalStatus>,
    ) -> bool {
        let prev = if let Some(s) = new_status {
            self.last_status.insert(id.clone(), s)
        } else {
            self.last_status.remove(id)
        };

        let new_alert_edge = match (prev, new_status) {
            (Some(p), Some(n)) => !p.is_alert() && n.is_alert(),
            (None, Some(n)) => n.is_alert(),
            _ => false,
        };

        match new_status {
            Some(s) if s.is_alert() => {
                let entry = self
                    .active
                    .entry(id.clone())
                    .or_insert_with(|| ActiveAlert {
                        status: s,
                        sandbox_name: sandbox_name.to_string(),
                        summary: summary.to_string(),
                        raised_at: Instant::now(),
                        acknowledged: false,
                    });
                entry.status = s;
                entry.sandbox_name = sandbox_name.to_string();
                entry.summary = summary.to_string();
                if new_alert_edge {
                    entry.raised_at = Instant::now();
                    entry.acknowledged = false;
                    self.toast = Some(Toast {
                        message: format!("{} {}: {}", s.glyph(), sandbox_name, summary),
                        status: s,
                        raised_at: Instant::now(),
                    });
                }
            }
            _ => {
                self.active.remove(id);
            }
        }

        new_alert_edge
    }

    /// Remove tracking for sandboxes no longer present.
    pub fn retain_ids<F: Fn(&SandboxId) -> bool>(&mut self, keep: F) {
        self.last_status.retain(|k, _| keep(k));
        self.active.retain(|k, _| keep(k));
    }

    pub fn acknowledge(&mut self, id: &SandboxId) {
        if let Some(a) = self.active.get_mut(id) {
            a.acknowledged = true;
        }
    }

    pub fn active_alert(&self, id: &SandboxId) -> Option<&ActiveAlert> {
        self.active.get(id)
    }

    pub fn unacknowledged_count(&self) -> usize {
        self.active.values().filter(|a| !a.acknowledged).count()
    }

    /// Returns the most recent toast if it's still within its display window.
    pub fn current_toast(&self) -> Option<&Toast> {
        self.toast
            .as_ref()
            .filter(|t| t.raised_at.elapsed() < TOAST_DURATION)
    }
}

/// Ring the terminal bell. Safe to call while ratatui is in alternate-screen mode —
/// BEL doesn't move the cursor or write any visible characters.
pub fn ring_bell() {
    use std::io::Write;
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(b"\x07");
    let _ = stdout.flush();
}

#[cfg(feature = "notify")]
pub fn fire_desktop_notification(sandbox_name: &str, status: TerminalStatus, summary: &str) {
    let summary_text = match status {
        TerminalStatus::NeedsInput => format!("Handler: {sandbox_name} needs input"),
        TerminalStatus::Error => format!("Handler: {sandbox_name} error"),
        _ => format!("Handler: {sandbox_name}"),
    };
    let _ = notify_rust::Notification::new()
        .summary(&summary_text)
        .body(summary)
        .timeout(notify_rust::Timeout::Milliseconds(8_000))
        .show();
}

#[cfg(not(feature = "notify"))]
pub fn fire_desktop_notification(_: &str, _: TerminalStatus, _: &str) {
    // No-op without the `notify` feature.
}
