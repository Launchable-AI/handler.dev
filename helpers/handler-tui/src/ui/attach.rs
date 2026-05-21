use ratatui::layout::{Constraint, Direction, Layout, Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::app::{SessionTile, TileConnectionState};

pub fn render(f: &mut Frame, area: Rect, tile: &mut SessionTile, prefix_pending: bool) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(1),
        ])
        .split(area);

    render_header(f, chunks[0], tile);
    render_grid(f, chunks[1], tile);
    render_footer(f, chunks[2], tile, prefix_pending);

    if matches!(tile.state, TileConnectionState::Connected) {
        if let Some((row, col)) = tile.grid.cursor_position() {
            let x = chunks[1].x + col;
            let y = chunks[1].y + row;
            if x < chunks[1].x + chunks[1].width && y < chunks[1].y + chunks[1].height {
                f.set_cursor_position(Position::new(x, y));
            }
        }
    }
}

fn render_header(f: &mut Frame, area: Rect, tile: &SessionTile) {
    let (state_text, state_style) = state_label(tile);

    let mut spans = vec![
        Span::styled(
            " ▼ ",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            tile.sandbox_name.clone(),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::raw(" · "),
        Span::styled(tile.backend_label, Style::default().fg(Color::DarkGray)),
        Span::raw(" · "),
        Span::styled(state_text, state_style),
    ];

    if let Some(tmux) = &tile.tmux_session {
        spans.push(Span::raw(" · "));
        spans.push(Span::styled(
            format!("tmux: {tmux}"),
            Style::default().fg(Color::DarkGray),
        ));
    }
    if let Some(code) = tile.exit_code {
        spans.push(Span::raw(" · "));
        spans.push(Span::styled(
            format!("exit {code}"),
            Style::default().fg(Color::DarkGray),
        ));
    }
    if let Some(err) = &tile.error {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            format!("⚠ {}", truncate(err, 60)),
            Style::default().fg(Color::Red),
        ));
    }

    f.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn render_grid(f: &mut Frame, area: Rect, tile: &mut SessionTile) {
    let pty_rows = area.height.max(1);
    let pty_cols = area.width.max(1);
    if tile.grid.rows() != pty_rows || tile.grid.cols() != pty_cols {
        tile.grid.resize(pty_rows, pty_cols);
        if let Some(s) = &tile.session {
            s.resize(pty_cols, pty_rows);
            // Nudge the inner shell/tmux to repaint from scratch. Without this, tmux
            // only sends diffs and stale status-bar fragments from the pre-resize layout
            // remain in the grid.
            s.send_input("\x0c".to_string());
        }
    }
    tile.grid.render(area, f.buffer_mut());
}

fn render_footer(f: &mut Frame, area: Rect, tile: &SessionTile, prefix_pending: bool) {
    let hint = if prefix_pending {
        Span::styled(
            "  prefix: d=detach · z=zoom · k=close · n=new tile in same VM · Tab=cycle · Ctrl-A=literal · ?=help",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )
    } else if matches!(tile.state, TileConnectionState::Connected) {
        Span::styled(
            "  Ctrl-A then: d detach · n new tile · z zoom · k close · Tab cycle · ? help",
            Style::default().fg(Color::DarkGray),
        )
    } else {
        Span::styled(
            "  Esc / q  back to dashboard",
            Style::default().fg(Color::DarkGray),
        )
    };
    f.render_widget(Paragraph::new(Line::from(vec![hint])), area);
}

pub fn state_label(tile: &SessionTile) -> (&'static str, Style) {
    match tile.state {
        TileConnectionState::Connecting => (
            "connecting…",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::DIM),
        ),
        TileConnectionState::Connected => match tile.tmux_state.as_deref() {
            Some("connected") => ("tmux", Style::default().fg(Color::Green)),
            Some("detached") => ("tmux (detached)", Style::default().fg(Color::Yellow)),
            Some("unavailable") => ("no tmux", Style::default().fg(Color::DarkGray)),
            _ => ("live", Style::default().fg(Color::Green)),
        },
        TileConnectionState::Exited => ("exited", Style::default().fg(Color::DarkGray)),
        TileConnectionState::ServerError => (
            "error",
            Style::default()
                .fg(Color::Red)
                .add_modifier(Modifier::BOLD),
        ),
        TileConnectionState::Closed => ("disconnected", Style::default().fg(Color::Yellow)),
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
