use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect) {
    let popup = centered_rect(70, 80, area);
    f.render_widget(Clear, popup);

    let lines = vec![
        Line::from(Span::styled(
            "handler-tui — keybindings",
            Style::default().add_modifier(Modifier::BOLD),
        )),
        Line::raw(""),
        Line::from(Span::styled(
            "Dashboard",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        )),
        kv("j / ↓", "select next sandbox"),
        kv("k / ↑", "select previous sandbox"),
        kv("g / Home", "jump to top"),
        kv("G / End", "jump to bottom"),
        kv("space", "toggle sandbox in tile selection (max 8)"),
        kv("c", "clear tile selection"),
        kv("Enter", "open session: tile selection (if any) or just cursor sandbox"),
        kv("s", "start/stop cursor sandbox (toggles based on current status)"),
        kv("?", "toggle this help"),
        kv("q  /  Ctrl-C", "quit"),
        Line::raw(""),
        Line::from(Span::styled(
            "Session (single attach or tiled)",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            "  All commands are prefixed with Ctrl-A (screen-style).",
            Style::default().fg(Color::DarkGray),
        )),
        kv("Ctrl-A d", "detach all tiles, back to dashboard"),
        kv("Ctrl-A z", "toggle zoom (focused tile fullscreen vs tiled)"),
        kv("Ctrl-A k / x", "close the focused tile"),
        kv("Ctrl-A n", "open a NEW terminal in the focused tile's sandbox (independent tmux session)"),
        kv("Ctrl-A b", "toggle the left sidebar (running sandboxes + AI status)"),
        kv("Ctrl-A Tab", "focus next tile"),
        kv("Ctrl-A ⇧Tab", "focus previous tile"),
        kv("Ctrl-A Ctrl-A", "send a literal Ctrl-A to the remote terminal"),
        kv("Ctrl-A ?", "show this help"),
        kv("(any other key)", "forwarded to the focused tile's PTY"),
        Line::raw(""),
        Line::from(Span::styled(
            "Alerts",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            "  Terminal-summary transitions to needs_input or error ring the bell,",
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            "  flash a 3-second toast in the status bar, and mark the row with ● .",
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            "  Moving the cursor onto a row acknowledges its alert (● → ○).",
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            "  Compile with `--features notify` and pass --desktop-notify for OS-level notifications.",
            Style::default().fg(Color::DarkGray),
        )),
    ];

    let block = Block::default()
        .borders(Borders::ALL)
        .title(" help ")
        .border_style(Style::default().fg(Color::Cyan));
    f.render_widget(Paragraph::new(lines).block(block), popup);
}

fn kv<'a>(key: &'a str, desc: &'a str) -> Line<'a> {
    Line::from(vec![
        Span::styled(
            format!("  {key:<16}"),
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ),
        Span::raw(desc.to_string()),
    ])
}

fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1])[1]
}
