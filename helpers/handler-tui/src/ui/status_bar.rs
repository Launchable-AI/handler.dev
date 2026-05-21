use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::api::types::TerminalStatus;
use crate::app::AppState;

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    let mut spans: Vec<Span> = vec![
        Span::styled(
            "handler-tui",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" · "),
        Span::styled(state.server_url.clone(), Style::default().fg(Color::DarkGray)),
    ];

    // An active toast takes priority over the API-error banner — it's the most
    // actionable thing on screen for those 3 seconds.
    if let Some(toast) = state.notifications.current_toast() {
        let color = match toast.status {
            TerminalStatus::Error => Color::Red,
            _ => Color::Yellow,
        };
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            truncate(&toast.message, 100),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ));
    } else if let Some(err) = state.current_error() {
        spans.push(Span::styled(
            format!("  ⚠ {}", truncate(err, 80)),
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        ));
    } else {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            "  j/k navigate · space select · Enter open · ? help · q quit",
            Style::default().fg(Color::DarkGray),
        ));
    }

    f.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}
