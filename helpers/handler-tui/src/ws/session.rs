use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::api::types::{Sandbox, SandboxBackend};
use crate::event::{AppEvent, TileId};
use crate::ws::protocol::{ClientMsg, ServerMsg};

const RESIZE_DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Debug)]
enum Outbound {
    Input(String),
    Resize { cols: u16, rows: u16 },
}

pub struct WsSession {
    out_tx: mpsc::UnboundedSender<Outbound>,
    reader_handle: JoinHandle<()>,
    writer_handle: JoinHandle<()>,
}

impl std::fmt::Debug for WsSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsSession").finish_non_exhaustive()
    }
}

impl WsSession {
    pub async fn connect(
        ws_url: String,
        sandbox: &Sandbox,
        tile_id: TileId,
        cols: u16,
        rows: u16,
        app_tx: UnboundedSender<AppEvent>,
    ) -> Result<Self> {
        let start_msg = build_start_message(sandbox, &tile_id, cols, rows)?;

        let (socket, _resp) = tokio_tungstenite::connect_async(&ws_url)
            .await
            .with_context(|| format!("connecting to {ws_url}"))?;
        let (mut sink, mut stream) = socket.split();

        // Send the start message immediately.
        let start_payload = serde_json::to_string(&start_msg)?;
        sink.send(Message::Text(start_payload)).await?;

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Outbound>();

        let writer_id = tile_id.clone();
        let writer_app_tx = app_tx.clone();
        let writer_handle = tokio::spawn(async move {
            // Coalesce resize events: if a new one arrives within RESIZE_DEBOUNCE,
            // replace the pending one rather than send both.
            let mut pending_resize: Option<(u16, u16)> = None;
            let mut resize_timer: Option<tokio::time::Instant> = None;

            loop {
                let send_result: Result<(), tokio_tungstenite::tungstenite::Error> = if let (
                    Some(deadline),
                    Some(_),
                ) = (resize_timer, pending_resize)
                {
                    tokio::select! {
                        msg = out_rx.recv() => match msg {
                            Some(Outbound::Input(s)) => {
                                let payload = serde_json::to_string(&ClientMsg::Input { data: s })
                                    .expect("Input serializes");
                                sink.send(Message::Text(payload)).await
                            }
                            Some(Outbound::Resize { cols, rows }) => {
                                pending_resize = Some((cols, rows));
                                resize_timer = Some(tokio::time::Instant::now() + RESIZE_DEBOUNCE);
                                Ok(())
                            }
                            None => break,
                        },
                        _ = tokio::time::sleep_until(deadline) => {
                            let (cols, rows) = pending_resize.take().expect("resize pending");
                            resize_timer = None;
                            let payload = serde_json::to_string(&ClientMsg::Resize { cols, rows })
                                .expect("Resize serializes");
                            sink.send(Message::Text(payload)).await
                        }
                    }
                } else {
                    match out_rx.recv().await {
                        Some(Outbound::Input(s)) => {
                            let payload = serde_json::to_string(&ClientMsg::Input { data: s })
                                .expect("Input serializes");
                            sink.send(Message::Text(payload)).await
                        }
                        Some(Outbound::Resize { cols, rows }) => {
                            pending_resize = Some((cols, rows));
                            resize_timer = Some(tokio::time::Instant::now() + RESIZE_DEBOUNCE);
                            Ok(())
                        }
                        None => break,
                    }
                };

                if let Err(e) = send_result {
                    let _ = writer_app_tx
                        .send(AppEvent::WsClosed(writer_id.clone(), Some(e.to_string())));
                    break;
                }
            }

            // Try to close the sink cleanly; ignore errors (peer may already be gone).
            let _ = sink.send(Message::Close(None)).await;
            let _ = sink.close().await;
        });

        let reader_id = tile_id.clone();
        let reader_app_tx = app_tx.clone();
        let reader_handle = tokio::spawn(async move {
            while let Some(frame) = stream.next().await {
                let text = match frame {
                    Ok(Message::Text(t)) => t,
                    Ok(Message::Binary(b)) => String::from_utf8_lossy(&b).into_owned(),
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => continue,
                    Ok(Message::Close(reason)) => {
                        let msg = reason.map(|r| r.reason.to_string());
                        let _ = reader_app_tx.send(AppEvent::WsClosed(reader_id.clone(), msg));
                        return;
                    }
                    Err(e) => {
                        let _ = reader_app_tx
                            .send(AppEvent::WsClosed(reader_id.clone(), Some(e.to_string())));
                        return;
                    }
                };

                match serde_json::from_str::<ServerMsg>(&text) {
                    Ok(ServerMsg::Connected {
                        session_id,
                        tmux_session,
                        resumed,
                    }) => {
                        let _ = reader_app_tx.send(AppEvent::WsConnected {
                            tile_id: reader_id.clone(),
                            session_id,
                            tmux_session,
                            resumed: resumed.unwrap_or(false),
                        });
                    }
                    Ok(ServerMsg::Output { data }) => {
                        let _ = reader_app_tx
                            .send(AppEvent::WsOutput(reader_id.clone(), data.into_bytes()));
                    }
                    Ok(ServerMsg::Scrollback { data }) => {
                        let _ = reader_app_tx
                            .send(AppEvent::WsOutput(reader_id.clone(), data.into_bytes()));
                    }
                    Ok(ServerMsg::SessionUpdate { tmux_state }) => {
                        let _ = reader_app_tx
                            .send(AppEvent::WsSessionUpdate(reader_id.clone(), tmux_state));
                    }
                    Ok(ServerMsg::SessionNotFound { message, .. }) => {
                        let _ = reader_app_tx
                            .send(AppEvent::WsError(reader_id.clone(), message.unwrap_or_else(|| "session not found".into())));
                    }
                    Ok(ServerMsg::Exit { code }) => {
                        let _ = reader_app_tx.send(AppEvent::WsExit(reader_id.clone(), code));
                    }
                    Ok(ServerMsg::Error { message }) => {
                        let _ = reader_app_tx.send(AppEvent::WsError(reader_id.clone(), message));
                    }
                    Ok(ServerMsg::Pong) => {}
                    Err(_) => {
                        // Ignore unknown / malformed messages — the server may add new
                        // discriminants we don't yet recognize.
                    }
                }
            }
            let _ = reader_app_tx.send(AppEvent::WsClosed(reader_id, None));
        });

        Ok(Self {
            out_tx,
            reader_handle,
            writer_handle,
        })
    }

    pub fn send_input(&self, data: String) {
        let _ = self.out_tx.send(Outbound::Input(data));
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.out_tx.send(Outbound::Resize { cols, rows });
    }

    pub fn close(&self) {
        self.reader_handle.abort();
        self.writer_handle.abort();
    }
}

impl Drop for WsSession {
    fn drop(&mut self) {
        self.reader_handle.abort();
        self.writer_handle.abort();
    }
}

fn build_start_message(
    sandbox: &Sandbox,
    tile_id: &str,
    cols: u16,
    rows: u16,
) -> Result<ClientMsg> {
    let id = sandbox.id.clone();
    Ok(match sandbox.backend {
        SandboxBackend::Docker => ClientMsg::Start {
            container_id: id,
            shell: "/bin/bash".to_string(),
            cols,
            rows,
            workdir: None,
            attach_tmux_session: None,
        },
        SandboxBackend::Firecracker => {
            let vm_ip = sandbox
                .guest_ip
                .clone()
                .ok_or_else(|| anyhow!("VM has no guest IP yet"))?;
            ClientMsg::StartVm {
                vm_id: id,
                vm_ip,
                shell: "/bin/bash".to_string(),
                cols,
                rows,
                // Tile id becomes the sessionKey so each tile gets its own tmux session.
                session_key: Some(tile_id.to_string()),
                attach_tmux_session: None,
            }
        }
        SandboxBackend::Daytona => ClientMsg::StartDaytona {
            sandbox_id: id,
            cols,
            rows,
        },
        SandboxBackend::Aws => {
            let ip = sandbox
                .guest_ip
                .clone()
                .ok_or_else(|| anyhow!("AWS instance has no public IP"))?;
            ClientMsg::StartAws {
                instance_id: id,
                public_ip: ip,
                cols,
                rows,
            }
        }
        SandboxBackend::Azure => {
            let ip = sandbox
                .guest_ip
                .clone()
                .ok_or_else(|| anyhow!("Azure VM has no public IP"))?;
            ClientMsg::StartAzure {
                instance_id: id,
                public_ip: ip,
                ssh_user: sandbox.ssh_user.clone(),
                cols,
                rows,
            }
        }
        SandboxBackend::Gcp => {
            let ip = sandbox
                .guest_ip
                .clone()
                .ok_or_else(|| anyhow!("GCP instance has no public IP"))?;
            ClientMsg::StartGcp {
                instance_id: id,
                public_ip: ip,
                ssh_user: sandbox.ssh_user.clone(),
                cols,
                rows,
            }
        }
        SandboxBackend::Digitalocean => {
            let ip = sandbox
                .guest_ip
                .clone()
                .ok_or_else(|| anyhow!("DigitalOcean droplet has no public IP"))?;
            ClientMsg::StartDigitalocean {
                instance_id: id,
                public_ip: ip,
                ssh_user: sandbox.ssh_user.clone(),
                cols,
                rows,
            }
        }
        SandboxBackend::Linode => {
            let ip = sandbox
                .guest_ip
                .clone()
                .ok_or_else(|| anyhow!("Linode has no public IP"))?;
            ClientMsg::StartLinode {
                instance_id: id,
                public_ip: ip,
                ssh_user: sandbox.ssh_user.clone(),
                cols,
                rows,
            }
        }
        SandboxBackend::Unknown => return Err(anyhow!("unknown backend; cannot attach")),
    })
}

/// Derive the WebSocket URL for `/ws/terminal` from the HTTP base URL.
pub fn derive_ws_url(http_base: &str) -> Result<String> {
    let mut url = url::Url::parse(http_base.trim_end_matches('/'))
        .with_context(|| format!("parsing server URL: {http_base}"))?;
    let new_scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        other => return Err(anyhow!("unsupported scheme: {other}")),
    };
    url.set_scheme(new_scheme)
        .map_err(|_| anyhow!("setting ws scheme"))?;
    url.set_path("/ws/terminal");
    Ok(url.to_string())
}

