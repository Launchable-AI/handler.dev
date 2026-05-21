use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};

pub struct PtyGrid {
    parser: vt100::Parser,
    rows: u16,
    cols: u16,
}

impl PtyGrid {
    pub fn new(rows: u16, cols: u16) -> Self {
        // Scrollback isn't rendered by us (the inner program manages its own view if it uses
        // alternate screen). 1000 lines is plenty for the resume scrollback replay.
        let parser = vt100::Parser::new(rows.max(1), cols.max(1), 1000);
        Self {
            parser,
            rows: rows.max(1),
            cols: cols.max(1),
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        let rows = rows.max(1);
        let cols = cols.max(1);
        if rows == self.rows && cols == self.cols {
            return;
        }
        self.parser.set_size(rows, cols);
        self.rows = rows;
        self.cols = cols;
    }

    pub fn rows(&self) -> u16 {
        self.rows
    }

    pub fn cols(&self) -> u16 {
        self.cols
    }

    pub fn application_cursor(&self) -> bool {
        self.parser.screen().application_cursor()
    }

    /// Returns (row, col) within the grid, or None if cursor is hidden.
    pub fn cursor_position(&self) -> Option<(u16, u16)> {
        let screen = self.parser.screen();
        if screen.hide_cursor() {
            None
        } else {
            Some(screen.cursor_position())
        }
    }

    /// Render the current grid state into the given ratatui area.
    /// The PtyGrid must have been sized to `(area.height, area.width)` for a 1:1 mapping;
    /// callers can render into a smaller area but content past the area is clipped.
    pub fn render(&self, area: Rect, buf: &mut Buffer) {
        let screen = self.parser.screen();
        let max_rows = area.height.min(self.rows);
        let max_cols = area.width.min(self.cols);

        for row in 0..max_rows {
            for col in 0..max_cols {
                let Some(cell) = screen.cell(row, col) else {
                    continue;
                };

                // Wide-character continuation cells have empty contents; the wide glyph
                // is rendered by the previous cell. Skip them so we don't blank out the
                // glyph's second half.
                if cell.is_wide_continuation() {
                    continue;
                }

                let target = &mut buf[(area.x + col, area.y + row)];
                let contents = cell.contents();
                if contents.is_empty() {
                    target.set_symbol(" ");
                } else {
                    target.set_symbol(&contents);
                }
                target.set_style(cell_style(cell));
            }
        }
    }
}

fn cell_style(cell: &vt100::Cell) -> Style {
    let mut style = Style::default();
    let fg = vt_color_to_ratatui(cell.fgcolor());
    let bg = vt_color_to_ratatui(cell.bgcolor());
    if cell.inverse() {
        // Swap fg/bg manually: ratatui's Modifier::REVERSED works on the terminal level,
        // but we already mapped explicit colors so swapping here is more reliable.
        style = style.fg(bg).bg(fg);
    } else {
        style = style.fg(fg).bg(bg);
    }
    if cell.bold() {
        style = style.add_modifier(Modifier::BOLD);
    }
    if cell.italic() {
        style = style.add_modifier(Modifier::ITALIC);
    }
    if cell.underline() {
        style = style.add_modifier(Modifier::UNDERLINED);
    }
    style
}

fn vt_color_to_ratatui(c: vt100::Color) -> Color {
    match c {
        vt100::Color::Default => Color::Reset,
        vt100::Color::Idx(i) => match i {
            0 => Color::Black,
            1 => Color::Red,
            2 => Color::Green,
            3 => Color::Yellow,
            4 => Color::Blue,
            5 => Color::Magenta,
            6 => Color::Cyan,
            7 => Color::Gray,
            8 => Color::DarkGray,
            9 => Color::LightRed,
            10 => Color::LightGreen,
            11 => Color::LightYellow,
            12 => Color::LightBlue,
            13 => Color::LightMagenta,
            14 => Color::LightCyan,
            15 => Color::White,
            n => Color::Indexed(n),
        },
        vt100::Color::Rgb(r, g, b) => Color::Rgb(r, g, b),
    }
}
