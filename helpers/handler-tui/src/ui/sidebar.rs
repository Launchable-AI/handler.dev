use std::collections::{HashMap, HashSet};

use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::api::types::{SandboxStatus, TerminalStatus};
use crate::app::AppState;
use crate::ui::theme;

pub const SIDEBAR_WIDTH: u16 = 30;

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    let attached: HashSet<&String> = state.sessions.iter().map(|t| &t.sandbox_id).collect();
    let mut tile_counts: HashMap<&String, usize> = HashMap::new();
    for t in &state.sessions {
        *tile_counts.entry(&t.sandbox_id).or_insert(0) += 1;
    }

    let running: Vec<_> = state
        .sandboxes
        .iter()
        .filter(|s| s.status == SandboxStatus::Running)
        .collect();

    let unack = state.notifications.unacknowledged_count();
    let title = if unack > 0 {
        format!(" running · {} · {} alert{} ", running.len(), unack, if unack == 1 { "" } else { "s" })
    } else {
        format!(" running · {} ", running.len())
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(Color::DarkGray));
    let inner = block.inner(area);
    f.render_widget(block, area);

    if running.is_empty() {
        let p = Paragraph::new(Line::from(Span::styled(
            "  no running sandboxes",
            Style::default().fg(Color::DarkGray),
        )));
        f.render_widget(p, inner);
        return;
    }

    // Each entry is up to 3 rows: name + summary + blank separator.
    // Compute how many entries fit; reserve one row for a "+N more" tail if needed.
    let inner_w = inner.width as usize;
    let inner_h = inner.height as usize;
    let mut lines: Vec<Line> = Vec::new();
    let mut rendered = 0usize;

    for (idx, s) in running.iter().enumerate() {
        // We need 3 rows per entry (except the last, which doesn't need a separator).
        // Conservatively assume 3 to keep layout consistent.
        let need = 3;
        let remaining_rows = inner_h.saturating_sub(lines.len());
        if remaining_rows < need {
            // Not enough room for another full card. Show how many we skipped.
            let hidden = running.len() - rendered;
            if hidden > 0 && remaining_rows >= 1 {
                lines.push(Line::from(Span::styled(
                    format!("  … +{hidden} more"),
                    Style::default().fg(Color::DarkGray),
                )));
            }
            break;
        }

        let alert = state.notifications.active_alert(&s.id);
        let is_attached = attached.contains(&s.id);
        let n_tiles = *tile_counts.get(&s.id).unwrap_or(&0);

        // --- line 1: marker + name + ×N
        let (glyph, glyph_style) = marker_for(alert, is_attached);
        let name_max = inner_w.saturating_sub(if n_tiles > 1 { 7 } else { 3 });
        let name_style = if is_attached {
            Style::default().add_modifier(Modifier::BOLD)
        } else {
            Style::default()
        };
        let mut line1: Vec<Span> = vec![
            Span::styled(glyph.to_string(), glyph_style),
            Span::raw(" "),
            Span::styled(truncate(&s.name, name_max), name_style),
        ];
        if n_tiles > 1 {
            line1.push(Span::styled(
                format!(" ×{}", n_tiles),
                Style::default().fg(Color::Cyan),
            ));
        }
        lines.push(Line::from(line1));

        // --- line 2: indented AI status glyph + summary
        let summary_entry = state.summaries.get(&s.id);
        let line2 = match summary_entry {
            Some(sum) => match (sum.status, sum.summary.as_deref().filter(|t| !t.is_empty())) {
                (Some(st), Some(text)) => {
                    let avail = inner_w.saturating_sub(4); // 2 indent + glyph + space
                    Line::from(vec![
                        Span::raw("  "),
                        Span::styled(
                            format!("{} ", st.glyph()),
                            theme::terminal_status_style(st),
                        ),
                        Span::styled(
                            truncate(text, avail),
                            Style::default().fg(Color::Gray),
                        ),
                    ])
                }
                (Some(st), None) => Line::from(vec![
                    Span::raw("  "),
                    Span::styled(
                        format!("{} {}", st.glyph(), status_label(st)),
                        theme::terminal_status_style(st),
                    ),
                ]),
                _ => Line::from(Span::styled(
                    "  (no summary)",
                    Style::default().fg(Color::DarkGray),
                )),
            },
            None => Line::from(Span::styled(
                "  (no summary yet)",
                Style::default().fg(Color::DarkGray),
            )),
        };
        lines.push(line2);

        // --- line 3: blank separator (skip after the very last entry)
        if idx < running.len() - 1 {
            lines.push(Line::raw(""));
        }
        rendered += 1;
    }

    f.render_widget(Paragraph::new(lines), inner);
}

fn marker_for(
    alert: Option<&crate::notify::ActiveAlert>,
    is_attached: bool,
) -> (&'static str, Style) {
    match alert {
        Some(a) if !a.acknowledged => (
            "●",
            Style::default()
                .fg(alert_color(a.status))
                .add_modifier(Modifier::BOLD),
        ),
        Some(a) => ("○", Style::default().fg(alert_color(a.status))),
        None if is_attached => (
            "◆",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        None => ("·", Style::default().fg(Color::DarkGray)),
    }
}

fn alert_color(status: TerminalStatus) -> Color {
    match status {
        TerminalStatus::NeedsInput => Color::Yellow,
        TerminalStatus::Error => Color::Red,
        _ => Color::DarkGray,
    }
}

fn status_label(s: TerminalStatus) -> &'static str {
    match s {
        TerminalStatus::NeedsInput => "needs input",
        TerminalStatus::Error => "error",
        TerminalStatus::Working => "working",
        TerminalStatus::Done => "done",
        TerminalStatus::Idle => "idle",
    }
}

fn truncate(s: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}
