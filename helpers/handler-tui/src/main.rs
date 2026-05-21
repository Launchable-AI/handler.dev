mod api;
mod app;
mod config;
mod event;
mod notify;
mod pty;
mod ui;
mod ws;

use std::fs::OpenOptions;
use std::io::{self, Stdout};
use std::panic;

use anyhow::{Context, Result};
use clap::Parser;
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use tracing_subscriber::EnvFilter;

use crate::api::ApiClient;
use crate::config::Cli;

fn main() -> Result<()> {
    let cli = Cli::parse();
    init_logging(&cli)?;

    let api = ApiClient::new(cli.server.clone())?;
    let desktop_notify = cli.desktop_notify;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?;

    install_panic_hook();
    let _guard = TerminalGuard::enter()?;

    let result = runtime.block_on(async {
        tokio::select! {
            r = app::run(api, desktop_notify) => r,
            _ = tokio::signal::ctrl_c() => Ok(()),
        }
    });

    // _guard restores the terminal on drop.
    drop(_guard);
    drop(runtime);

    result
}

fn init_logging(cli: &Cli) -> Result<()> {
    let log_path = cli.resolved_log_file();
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("opening log file {}", log_path.display()))?;

    let filter = EnvFilter::try_from_env("HANDLER_TUI_LOG_LEVEL")
        .unwrap_or_else(|_| EnvFilter::new("warn,handler_tui=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(file)
        .with_ansi(false)
        .with_target(false)
        .init();
    Ok(())
}

struct TerminalGuard {
    _stdout: Stdout,
}

impl TerminalGuard {
    fn enter() -> Result<Self> {
        enable_raw_mode().context("enabling raw mode")?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen).context("entering alternate screen")?;
        Ok(Self { _stdout: stdout })
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

fn install_panic_hook() {
    let prev = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
        prev(info);
    }));
}
