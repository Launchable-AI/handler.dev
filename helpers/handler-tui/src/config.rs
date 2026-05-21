use std::path::PathBuf;

use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "handler-tui",
    version,
    about = "Terminal dashboard for the Handler sandbox server",
    long_about = "Connects to a running Handler server over its HTTP API and renders a live status \
                  dashboard. The server only listens on 127.0.0.1, so run this on the same host \
                  (locally or via SSH)."
)]
pub struct Cli {
    /// Handler server base URL.
    #[arg(long, env = "HANDLER_SERVER", default_value = "http://127.0.0.1:4001")]
    pub server: String,

    /// Log file path (defaults to $XDG_CACHE_HOME/handler-tui/handler-tui.log).
    #[arg(long, env = "HANDLER_TUI_LOG")]
    pub log_file: Option<PathBuf>,

    /// Send a desktop notification on each new alert (compile-time gated behind the
    /// `notify` Cargo feature; without that feature this flag has no effect).
    #[arg(long, env = "HANDLER_TUI_DESKTOP_NOTIFY")]
    pub desktop_notify: bool,
}

impl Cli {
    pub fn resolved_log_file(&self) -> PathBuf {
        if let Some(p) = &self.log_file {
            return p.clone();
        }
        let base = std::env::var("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .ok()
            .or_else(|| std::env::var("HOME").map(|h| PathBuf::from(h).join(".cache")).ok())
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("handler-tui").join("handler-tui.log")
    }
}
