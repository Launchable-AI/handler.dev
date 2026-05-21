use serde::{Deserialize, Serialize};

/// Messages the TUI sends to the Handler server over `/ws/terminal`.
///
/// The wire format uses camelCase fields and a `type` discriminator that is
/// lowercase for simple messages and kebab-case for compound `start-*` variants.
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
#[allow(dead_code)] // `Ping` is reserved for future keepalive
pub enum ClientMsg {
    #[serde(rename = "start")]
    Start {
        #[serde(rename = "containerId")]
        container_id: String,
        shell: String,
        cols: u16,
        rows: u16,
        #[serde(skip_serializing_if = "Option::is_none")]
        workdir: Option<String>,
        #[serde(
            skip_serializing_if = "Option::is_none",
            rename = "attachTmuxSession"
        )]
        attach_tmux_session: Option<String>,
    },

    #[serde(rename = "start-vm")]
    StartVm {
        #[serde(rename = "vmId")]
        vm_id: String,
        #[serde(rename = "vmIp")]
        vm_ip: String,
        shell: String,
        cols: u16,
        rows: u16,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sessionKey")]
        session_key: Option<String>,
        #[serde(
            skip_serializing_if = "Option::is_none",
            rename = "attachTmuxSession"
        )]
        attach_tmux_session: Option<String>,
    },

    #[serde(rename = "start-daytona")]
    StartDaytona {
        #[serde(rename = "sandboxId")]
        sandbox_id: String,
        cols: u16,
        rows: u16,
    },

    #[serde(rename = "start-aws")]
    StartAws {
        #[serde(rename = "instanceId")]
        instance_id: String,
        #[serde(rename = "publicIp")]
        public_ip: String,
        cols: u16,
        rows: u16,
    },

    #[serde(rename = "start-azure")]
    StartAzure {
        #[serde(rename = "instanceId")]
        instance_id: String,
        #[serde(rename = "publicIp")]
        public_ip: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sshUser")]
        ssh_user: Option<String>,
        cols: u16,
        rows: u16,
    },

    #[serde(rename = "start-gcp")]
    StartGcp {
        #[serde(rename = "instanceId")]
        instance_id: String,
        #[serde(rename = "publicIp")]
        public_ip: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sshUser")]
        ssh_user: Option<String>,
        cols: u16,
        rows: u16,
    },

    #[serde(rename = "start-digitalocean")]
    StartDigitalocean {
        #[serde(rename = "instanceId")]
        instance_id: String,
        #[serde(rename = "publicIp")]
        public_ip: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sshUser")]
        ssh_user: Option<String>,
        cols: u16,
        rows: u16,
    },

    #[serde(rename = "start-linode")]
    StartLinode {
        #[serde(rename = "instanceId")]
        instance_id: String,
        #[serde(rename = "publicIp")]
        public_ip: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sshUser")]
        ssh_user: Option<String>,
        cols: u16,
        rows: u16,
    },

    #[serde(rename = "input")]
    Input { data: String },

    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },

    #[serde(rename = "ping")]
    Ping,
}

/// Messages the server sends back over the same socket.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)] // `old_session_id` is deserialized but not surfaced (we use `message`)
pub enum ServerMsg {
    #[serde(rename = "connected")]
    Connected {
        #[serde(default, rename = "sessionId")]
        session_id: Option<String>,
        #[serde(default, rename = "tmuxSession")]
        tmux_session: Option<String>,
        #[serde(default)]
        resumed: Option<bool>,
    },

    #[serde(rename = "output")]
    Output { data: String },

    #[serde(rename = "scrollback")]
    Scrollback { data: String },

    #[serde(rename = "session-update")]
    SessionUpdate {
        #[serde(rename = "tmuxState")]
        tmux_state: String,
    },

    #[serde(rename = "session-not-found")]
    SessionNotFound {
        #[serde(default, rename = "oldSessionId")]
        old_session_id: Option<String>,
        #[serde(default)]
        message: Option<String>,
    },

    #[serde(rename = "exit")]
    Exit {
        #[serde(default)]
        code: Option<i32>,
    },

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "pong")]
    Pong,
}
