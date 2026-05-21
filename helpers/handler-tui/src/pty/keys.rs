use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

/// Encode a crossterm KeyEvent into the byte sequence a remote PTY expects.
///
/// `app_cursor` is the DECCKM state (`\x1b[?1h` = true) tracked by the local
/// PtyGrid; it switches arrow / Home / End encoding to the `O`-prefixed form.
///
/// Returns None for keys we don't have a useful encoding for, or for non-Press
/// events. Callers should forward the returned bytes verbatim over the
/// `{type: 'input', data: ...}` WS message.
pub fn encode_key(ev: KeyEvent, app_cursor: bool) -> Option<Vec<u8>> {
    if ev.kind != KeyEventKind::Press {
        return None;
    }

    let mods = ev.modifiers;
    let ctrl = mods.contains(KeyModifiers::CONTROL);
    let alt = mods.contains(KeyModifiers::ALT);

    match ev.code {
        KeyCode::Char(c) => {
            if ctrl {
                Some(ctrl_char(c).map(|b| with_alt(alt, vec![b])).unwrap_or_default())
                    .filter(|v: &Vec<u8>| !v.is_empty())
            } else {
                let mut buf = String::new();
                buf.push(c);
                Some(with_alt(alt, buf.into_bytes()))
            }
        }
        KeyCode::Enter => Some(with_alt(alt, b"\r".to_vec())),
        KeyCode::Tab => Some(with_alt(alt, b"\t".to_vec())),
        KeyCode::BackTab => Some(b"\x1b[Z".to_vec()),
        KeyCode::Backspace => Some(with_alt(alt, b"\x7f".to_vec())),
        KeyCode::Esc => Some(b"\x1b".to_vec()),

        KeyCode::Up => Some(cursor_seq(app_cursor, 'A')),
        KeyCode::Down => Some(cursor_seq(app_cursor, 'B')),
        KeyCode::Right => Some(cursor_seq(app_cursor, 'C')),
        KeyCode::Left => Some(cursor_seq(app_cursor, 'D')),
        KeyCode::Home => Some(cursor_seq(app_cursor, 'H')),
        KeyCode::End => Some(cursor_seq(app_cursor, 'F')),

        KeyCode::PageUp => Some(b"\x1b[5~".to_vec()),
        KeyCode::PageDown => Some(b"\x1b[6~".to_vec()),
        KeyCode::Insert => Some(b"\x1b[2~".to_vec()),
        KeyCode::Delete => Some(b"\x1b[3~".to_vec()),

        KeyCode::F(n) => f_key_seq(n),

        KeyCode::Null => Some(vec![0]),
        _ => None,
    }
}

fn ctrl_char(c: char) -> Option<u8> {
    let c = c.to_ascii_lowercase();
    match c {
        'a'..='z' => Some(c as u8 - b'a' + 1),
        ' ' => Some(0),
        '[' => Some(0x1b),
        '\\' => Some(0x1c),
        ']' => Some(0x1d),
        '^' => Some(0x1e),
        '_' => Some(0x1f),
        '?' => Some(0x7f),
        _ => None,
    }
}

fn with_alt(alt: bool, mut bytes: Vec<u8>) -> Vec<u8> {
    if alt {
        let mut out = Vec::with_capacity(bytes.len() + 1);
        out.push(0x1b);
        out.append(&mut bytes);
        out
    } else {
        bytes
    }
}

fn cursor_seq(app_cursor: bool, letter: char) -> Vec<u8> {
    let prefix: &[u8] = if app_cursor { b"\x1bO" } else { b"\x1b[" };
    let mut v = prefix.to_vec();
    v.push(letter as u8);
    v
}

fn f_key_seq(n: u8) -> Option<Vec<u8>> {
    let seq: &[u8] = match n {
        1 => b"\x1bOP",
        2 => b"\x1bOQ",
        3 => b"\x1bOR",
        4 => b"\x1bOS",
        5 => b"\x1b[15~",
        6 => b"\x1b[17~",
        7 => b"\x1b[18~",
        8 => b"\x1b[19~",
        9 => b"\x1b[20~",
        10 => b"\x1b[21~",
        11 => b"\x1b[23~",
        12 => b"\x1b[24~",
        _ => return None,
    };
    Some(seq.to_vec())
}
