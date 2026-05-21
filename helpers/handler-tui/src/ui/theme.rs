use ratatui::style::{Color, Modifier, Style};

use crate::api::types::{SandboxStatus, TerminalStatus};

pub fn terminal_status_style(status: TerminalStatus) -> Style {
    let color = match status {
        TerminalStatus::NeedsInput => Color::Yellow,
        TerminalStatus::Error => Color::Red,
        TerminalStatus::Working => Color::Cyan,
        TerminalStatus::Done => Color::Green,
        TerminalStatus::Idle => Color::DarkGray,
    };
    let mut style = Style::default().fg(color);
    if matches!(status, TerminalStatus::NeedsInput | TerminalStatus::Error) {
        style = style.add_modifier(Modifier::BOLD);
    }
    style
}

pub fn sandbox_status_style(status: SandboxStatus) -> Style {
    let color = match status {
        SandboxStatus::Running => Color::Green,
        SandboxStatus::Starting | SandboxStatus::Creating | SandboxStatus::Building => Color::Cyan,
        SandboxStatus::Stopping => Color::Yellow,
        SandboxStatus::Stopped | SandboxStatus::Archived => Color::DarkGray,
        SandboxStatus::Paused => Color::Magenta,
        SandboxStatus::Error => Color::Red,
        SandboxStatus::Unknown => Color::DarkGray,
    };
    Style::default().fg(color)
}

pub fn usage_color(pct: f64, warn_at: f64, crit_at: f64) -> Color {
    if pct >= crit_at {
        Color::Red
    } else if pct >= warn_at {
        Color::Yellow
    } else {
        Color::Reset
    }
}
