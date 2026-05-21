use ratatui::layout::{Constraint, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Row, Table, TableState};
use ratatui::Frame;

use crate::api::types::{AgentInfo, Sandbox, TerminalStatus};
use crate::app::AppState;
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    let header_cells = [
        "", "NAME", "BACKEND", "STATUS", "AI STATUS", "CPU", "MEM", "DISK", "AGENTS",
    ]
    .iter()
    .map(|h| Cell::from(*h).style(Style::default().add_modifier(Modifier::BOLD)));
    let header = Row::new(header_cells).height(1);

    let rows: Vec<Row> = state
        .sandboxes
        .iter()
        .map(|s| build_row(s, state))
        .collect();

    let alert_count = state
        .sandboxes
        .iter()
        .filter_map(|s| state.summaries.get(&s.id))
        .filter(|sum| sum.status.is_some_and(|st| st.is_alert()))
        .count();

    let title = if state.sandboxes.is_empty() {
        " handler · no sandboxes ".to_string()
    } else {
        let mut t = format!(
            " handler · {} sandbox{}",
            state.sandboxes.len(),
            if state.sandboxes.len() == 1 { "" } else { "es" },
        );
        if alert_count > 0 {
            t.push_str(&format!(
                " · {alert_count} alert{}",
                if alert_count == 1 { "" } else { "s" }
            ));
        }
        if !state.selected_for_tile.is_empty() {
            t.push_str(&format!(
                " · {} tile{} selected",
                state.selected_for_tile.len(),
                if state.selected_for_tile.len() == 1 {
                    ""
                } else {
                    "s"
                }
            ));
        }
        let unack = state.notifications.unacknowledged_count();
        if unack > 0 {
            t.push_str(&format!(
                " · {unack} new alert{}",
                if unack == 1 { "" } else { "s" }
            ));
        }
        t.push(' ');
        t
    };

    let widths = [
        Constraint::Length(2),  // selection marker
        Constraint::Min(16),    // name
        Constraint::Length(8),  // backend
        Constraint::Length(9),  // status
        Constraint::Min(20),    // AI status
        Constraint::Length(6),  // cpu
        Constraint::Length(6),  // mem
        Constraint::Length(6),  // disk
        Constraint::Length(10), // agents
    ];

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(Color::DarkGray));

    let table = Table::new(rows, widths)
        .header(header)
        .block(block)
        .row_highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▶ ");

    let mut ts = TableState::default();
    if !state.sandboxes.is_empty() {
        ts.select(Some(state.selected.min(state.sandboxes.len() - 1)));
    }

    f.render_stateful_widget(table, area, &mut ts);
}

fn build_row<'a>(s: &'a Sandbox, state: &'a AppState) -> Row<'a> {
    let alert = state.notifications.active_alert(&s.id);
    let marker = match alert {
        Some(a) if !a.acknowledged => Cell::from(Span::styled(
            "●",
            Style::default()
                .fg(alert_color(a.status))
                .add_modifier(Modifier::BOLD),
        )),
        Some(a) => Cell::from(Span::styled(
            "○",
            Style::default().fg(alert_color(a.status)),
        )),
        None if state.selected_for_tile.contains(&s.id) => Cell::from(Span::styled(
            "▣",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )),
        None => Cell::from(Span::styled("·", Style::default().fg(Color::DarkGray))),
    };

    let name = Cell::from(s.name.as_str());
    let backend = Cell::from(s.backend.short());
    let status = Cell::from(Span::styled(
        s.status.label(),
        theme::sandbox_status_style(s.status),
    ));

    let ai_cell = match state.summaries.get(&s.id) {
        Some(sum) => match (sum.status, sum.summary.as_deref()) {
            (Some(st), Some(text)) => {
                let style = theme::terminal_status_style(st);
                let line = Line::from(vec![
                    Span::styled(format!("{} ", st.glyph()), style),
                    Span::raw(truncate(text, 60)),
                ]);
                Cell::from(line)
            }
            (Some(st), None) => Cell::from(Span::styled(
                format!("{} {}", st.glyph(), format_status_label(st)),
                theme::terminal_status_style(st),
            )),
            _ => Cell::from(Span::styled("·", Style::default().fg(Color::DarkGray))),
        },
        None => Cell::from(Span::styled("·", Style::default().fg(Color::DarkGray))),
    };

    let metrics = state.metrics.get(&s.id);
    let cpu = pct_cell(metrics.map(|m| m.cpu_usage), 50.0, 80.0);
    let mem = pct_cell(metrics.map(|m| m.memory_usage), 50.0, 80.0);
    let disk = pct_cell(metrics.map(|m| m.disk_usage), 70.0, 90.0);

    let agents = agents_cell(state.agents.get(&s.id));

    Row::new(vec![
        marker, name, backend, status, ai_cell, cpu, mem, disk, agents,
    ])
}

fn pct_cell<'a>(value: Option<f64>, warn: f64, crit: f64) -> Cell<'a> {
    match value {
        Some(v) => {
            let style = Style::default().fg(theme::usage_color(v, warn, crit));
            Cell::from(Span::styled(format!("{:.0}%", v), style))
        }
        None => Cell::from(Span::styled("—", Style::default().fg(Color::DarkGray))),
    }
}

fn agents_cell<'a>(agents: Option<&'a Vec<AgentInfo>>) -> Cell<'a> {
    let Some(agents) = agents else {
        return Cell::from("");
    };
    let mut spans: Vec<Span> = Vec::new();
    for a in agents.iter().filter(|a| a.installed) {
        let style = if a.running {
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::DarkGray)
        };
        spans.push(Span::styled(a.id.glyph().to_string(), style));
        spans.push(Span::raw(" "));
    }
    if spans.is_empty() {
        Cell::from("")
    } else {
        Cell::from(Line::from(spans))
    }
}

fn alert_color(status: TerminalStatus) -> Color {
    match status {
        TerminalStatus::NeedsInput => Color::Yellow,
        TerminalStatus::Error => Color::Red,
        _ => Color::DarkGray,
    }
}

fn format_status_label(s: crate::api::types::TerminalStatus) -> &'static str {
    use crate::api::types::TerminalStatus as T;
    match s {
        T::NeedsInput => "needs input",
        T::Error => "error",
        T::Working => "working",
        T::Done => "done",
        T::Idle => "idle",
    }
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
