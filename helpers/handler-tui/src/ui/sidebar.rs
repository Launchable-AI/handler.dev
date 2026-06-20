use std::collections::{HashMap, HashSet};

use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::api::types::{SandboxStatus, TerminalStatus, TerminalSummaryResponse};
use crate::app::AppState;
use crate::ui::theme;

pub const SIDEBAR_WIDTH: u16 = 30;

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    let attached: HashSet<&String> = state.sessions.iter().map(|t| &t.sandbox_id).collect();

    // Compute per-VM pane numbers so the sidebar can label tiles "name[1]", "name[2]", etc.
    // We number tiles by their order in state.sessions, which is the order they were opened.
    let mut pane_indices: HashMap<&String, Vec<usize>> = HashMap::new();
    for (i, t) in state.sessions.iter().enumerate() {
        pane_indices.entry(&t.sandbox_id).or_default().push(i);
    }
    let mut pane_number: HashMap<usize, (usize, usize)> = HashMap::new();
    for tiles_for_sandbox in pane_indices.values() {
        let total = tiles_for_sandbox.len();
        for (n, &idx) in tiles_for_sandbox.iter().enumerate() {
            pane_number.insert(idx, (n + 1, total));
        }
    }

    let unack = state.notifications.unacknowledged_count();
    let title = if unack > 0 {
        format!(
            " {} pane{} · {} alert{} ",
            state.sessions.len(),
            if state.sessions.len() == 1 { "" } else { "s" },
            unack,
            if unack == 1 { "" } else { "s" }
        )
    } else {
        format!(
            " {} pane{} ",
            state.sessions.len(),
            if state.sessions.len() == 1 { "" } else { "s" }
        )
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(Color::DarkGray));
    let inner = block.inner(area);
    f.render_widget(block, area);

    let inner_w = inner.width as usize;
    let inner_h = inner.height as usize;
    let mut lines: Vec<Line> = Vec::new();

    // --- Section 1: open panes (one entry per SessionTile)
    if !state.sessions.is_empty() {
        lines.push(section_header("open panes", inner_w));
        for (idx, tile) in state.sessions.iter().enumerate() {
            if lines.len() + 3 > inner_h {
                lines.push(more_indicator(state.sessions.len() - idx, "panes"));
                break;
            }
            let (n, total) = pane_number.get(&idx).copied().unwrap_or((1, 1));
            let is_focused = idx == state.focused_session;
            push_pane_entry(&mut lines, tile, n, total, is_focused, inner_w);
            // separator (skip after last)
            if idx < state.sessions.len() - 1 {
                lines.push(Line::raw(""));
            }
        }
    }

    // --- Section 2: other running sandboxes (no open pane)
    let other_running: Vec<_> = state
        .sandboxes
        .iter()
        .filter(|s| s.status == SandboxStatus::Running && !attached.contains(&s.id))
        .collect();

    if !other_running.is_empty() {
        if !lines.is_empty() {
            lines.push(Line::raw(""));
        }
        if lines.len() + 1 < inner_h {
            lines.push(section_header("other running", inner_w));
        }
        for (i, s) in other_running.iter().enumerate() {
            if lines.len() + 3 > inner_h {
                lines.push(more_indicator(other_running.len() - i, "running"));
                break;
            }
            let alert = state.notifications.active_alert(&s.id);
            let summary = state.summaries.get(&s.id);
            push_sandbox_entry(&mut lines, s.name.as_str(), alert, summary, inner_w);
            if i < other_running.len() - 1 {
                lines.push(Line::raw(""));
            }
        }
    }

    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "  no panes open",
            Style::default().fg(Color::DarkGray),
        )));
        lines.push(Line::raw(""));
        lines.push(Line::from(Span::styled(
            "  no other running",
            Style::default().fg(Color::DarkGray),
        )));
    }

    f.render_widget(Paragraph::new(lines), inner);
}

fn push_pane_entry(
    lines: &mut Vec<Line>,
    tile: &crate::app::SessionTile,
    pane_n: usize,
    pane_total: usize,
    is_focused: bool,
    inner_w: usize,
) {
    // line 1: marker + name [pane_n/pane_total]
    let marker = if is_focused {
        Span::styled(
            "★",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled("◆", Style::default().fg(Color::Cyan))
    };

    let pane_suffix = if pane_total > 1 {
        format!(" [{pane_n}/{pane_total}]")
    } else {
        String::new()
    };
    let name_max = inner_w
        .saturating_sub(2 + pane_suffix.chars().count())
        .max(4);
    let name_style = if is_focused {
        Style::default().add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    };
    let line1 = Line::from(vec![
        marker,
        Span::raw(" "),
        Span::styled(truncate(&tile.sandbox_name, name_max), name_style),
        Span::styled(pane_suffix, Style::default().fg(Color::DarkGray)),
    ]);
    lines.push(line1);

    // line 2: indented AI status from the tile's own summary (not sandbox-level).
    let line2 = summary_line(tile.summary.as_ref(), inner_w);
    lines.push(line2);
}

fn push_sandbox_entry(
    lines: &mut Vec<Line>,
    name: &str,
    alert: Option<&crate::notify::ActiveAlert>,
    summary: Option<&TerminalSummaryResponse>,
    inner_w: usize,
) {
    let (glyph, glyph_style) = match alert {
        Some(a) if !a.acknowledged => (
            "●",
            Style::default()
                .fg(alert_color(a.status))
                .add_modifier(Modifier::BOLD),
        ),
        Some(a) => ("○", Style::default().fg(alert_color(a.status))),
        None => ("·", Style::default().fg(Color::DarkGray)),
    };
    let name_max = inner_w.saturating_sub(2).max(4);
    lines.push(Line::from(vec![
        Span::styled(glyph.to_string(), glyph_style),
        Span::raw(" "),
        Span::raw(truncate(name, name_max)),
    ]));
    lines.push(summary_line(summary, inner_w));
}

fn summary_line(summary: Option<&TerminalSummaryResponse>, inner_w: usize) -> Line<'static> {
    let avail = inner_w.saturating_sub(4); // 2 indent + glyph + space
    match summary {
        Some(sum) => match (sum.status, sum.summary.as_deref().filter(|t| !t.is_empty())) {
            (Some(st), Some(text)) => Line::from(vec![
                Span::raw("  "),
                Span::styled(format!("{} ", st.glyph()), theme::terminal_status_style(st)),
                Span::styled(truncate(text, avail), Style::default().fg(Color::Gray)),
            ]),
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
    }
}

fn section_header(label: &str, inner_w: usize) -> Line<'static> {
    let dash_count = inner_w
        .saturating_sub(label.chars().count() + 4)
        .max(0)
        .min(8);
    let dashes: String = std::iter::repeat('─').take(dash_count).collect();
    Line::from(vec![
        Span::styled(
            format!("─── {label} "),
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(dashes, Style::default().fg(Color::DarkGray)),
    ])
}

fn more_indicator(n: usize, label: &str) -> Line<'static> {
    Line::from(Span::styled(
        format!("  … +{n} more {label}"),
        Style::default().fg(Color::DarkGray),
    ))
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
