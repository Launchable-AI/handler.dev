use ratatui::layout::{Constraint, Direction, Layout, Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::api::types::TerminalStatus;
use crate::app::{tile_grid_dims, SessionTile, TileConnectionState};
use crate::ui::attach::state_label;

pub fn render(
    f: &mut Frame,
    area: Rect,
    tiles: &mut [SessionTile],
    focused: usize,
    prefix_pending: bool,
) {
    let n = tiles.len();
    if n == 0 {
        return;
    }

    // Reserve 1 row at the bottom for the global footer hint.
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(1)])
        .split(area);
    let grid_area = chunks[0];
    let footer_area = chunks[1];

    let (cols, rows) = tile_grid_dims(n);
    let row_areas = split(grid_area, Direction::Vertical, rows);

    let mut tile_rects: Vec<Rect> = Vec::with_capacity(n);
    for (r_idx, row_area) in row_areas.iter().enumerate() {
        // How many tiles in this row?
        let row_tiles = ((r_idx as u16) * cols..=((r_idx as u16 + 1) * cols - 1))
            .filter(|i| (*i as usize) < n)
            .count() as u16;
        if row_tiles == 0 {
            break;
        }
        let col_areas = split(*row_area, Direction::Horizontal, row_tiles);
        for area in col_areas {
            tile_rects.push(area);
        }
    }

    let mut cursor: Option<Position> = None;
    for (idx, tile) in tiles.iter_mut().enumerate() {
        let Some(rect) = tile_rects.get(idx).copied() else {
            break;
        };
        let is_focused = idx == focused;
        let inner = render_tile_frame(f, rect, tile, is_focused);

        if let Some(pos) = render_tile_grid(f, inner, tile, is_focused) {
            if is_focused {
                cursor = Some(pos);
            }
        }
    }

    if let Some(pos) = cursor {
        f.set_cursor_position(pos);
    }

    render_footer(f, footer_area, tiles, focused, prefix_pending);
}

fn render_tile_frame(f: &mut Frame, rect: Rect, tile: &SessionTile, focused: bool) -> Rect {
    let (state_text, state_style) = state_label(tile);

    // Border color: if there's a per-tile AI status alert, override with the alert color.
    let border_color = match tile.summary.as_ref().and_then(|s| s.status) {
        Some(TerminalStatus::NeedsInput) if focused => Color::Yellow,
        Some(TerminalStatus::Error) if focused => Color::Red,
        _ if focused => Color::Cyan,
        Some(TerminalStatus::NeedsInput) => Color::Yellow,
        Some(TerminalStatus::Error) => Color::Red,
        _ => Color::DarkGray,
    };
    let mut border_style = Style::default().fg(border_color);
    if focused {
        border_style = border_style.add_modifier(Modifier::BOLD);
    }

    let mut title_spans = vec![
        Span::raw(" "),
        Span::styled(
            tile.sandbox_name.clone(),
            Style::default().add_modifier(if focused {
                Modifier::BOLD
            } else {
                Modifier::empty()
            }),
        ),
        Span::raw(" "),
        Span::styled(
            format!("[{}]", tile.backend_label),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw(" "),
        Span::styled(state_text, state_style),
    ];

    // Per-tile AI status, if available. Falls back to connection state only.
    if let Some(summary) = &tile.summary {
        if let Some(s) = summary.status {
            title_spans.push(Span::raw(" "));
            title_spans.push(Span::styled(
                format!("{} {}", s.glyph(), short_status(s)),
                crate::ui::theme::terminal_status_style(s),
            ));
            if let Some(text) = summary.summary.as_deref().filter(|t| !t.is_empty()) {
                title_spans.push(Span::raw(": "));
                title_spans.push(Span::styled(
                    truncate(text, 40),
                    Style::default().fg(Color::DarkGray),
                ));
            }
        }
    }
    title_spans.push(Span::raw(" "));

    let block = Block::default()
        .borders(Borders::ALL)
        .title(Line::from(title_spans))
        .border_style(border_style);
    let inner = block.inner(rect);
    f.render_widget(block, rect);
    inner
}

fn short_status(s: TerminalStatus) -> &'static str {
    match s {
        TerminalStatus::NeedsInput => "needs input",
        TerminalStatus::Error => "error",
        TerminalStatus::Working => "working",
        TerminalStatus::Done => "done",
        TerminalStatus::Idle => "idle",
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

fn render_tile_grid(
    f: &mut Frame,
    area: Rect,
    tile: &mut SessionTile,
    focused: bool,
) -> Option<Position> {
    let pty_rows = area.height.max(1);
    let pty_cols = area.width.max(1);
    if tile.grid.rows() != pty_rows || tile.grid.cols() != pty_cols {
        tile.grid.resize(pty_rows, pty_cols);
        if let Some(s) = &tile.session {
            s.resize(pty_cols, pty_rows);
            // Force tmux/bash to fully repaint at the new size (see attach.rs note).
            s.send_input("\x0c".to_string());
        }
    }
    tile.grid.render(area, f.buffer_mut());

    if !focused || !matches!(tile.state, TileConnectionState::Connected) {
        return None;
    }
    let (row, col) = tile.grid.cursor_position()?;
    let x = area.x + col;
    let y = area.y + row;
    if x < area.x + area.width && y < area.y + area.height {
        Some(Position::new(x, y))
    } else {
        None
    }
}

fn render_footer(
    f: &mut Frame,
    area: Rect,
    tiles: &[SessionTile],
    focused: usize,
    prefix_pending: bool,
) {
    let focused_name = tiles
        .get(focused)
        .map(|t| t.sandbox_name.clone())
        .unwrap_or_default();

    let hint = if prefix_pending {
        Span::styled(
            "  prefix: d=detach · n=new tile (same VM) · z=zoom · k=close · Tab=cycle · ?=help",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(
            format!(
                "  {} of {} tiles  ·  focused: {}  ·  Ctrl-A d detach · Ctrl-A n new tile · Ctrl-A Tab cycle",
                focused + 1,
                tiles.len(),
                focused_name
            ),
            Style::default().fg(Color::DarkGray),
        )
    };
    f.render_widget(Paragraph::new(Line::from(vec![hint])), area);
}

fn split(area: Rect, dir: Direction, n: u16) -> Vec<Rect> {
    if n <= 1 {
        return vec![area];
    }
    let constraints: Vec<Constraint> = (0..n).map(|_| Constraint::Ratio(1, n as u32)).collect();
    Layout::default()
        .direction(dir)
        .constraints(constraints)
        .split(area)
        .to_vec()
}
