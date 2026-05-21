use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SandboxBackend {
    Docker,
    Firecracker,
    Daytona,
    Aws,
    Azure,
    Gcp,
    Digitalocean,
    Linode,
    #[serde(other)]
    Unknown,
}

impl SandboxBackend {
    pub fn short(self) -> &'static str {
        match self {
            SandboxBackend::Docker => "docker",
            SandboxBackend::Firecracker => "fc",
            SandboxBackend::Daytona => "daytona",
            SandboxBackend::Aws => "aws",
            SandboxBackend::Azure => "azure",
            SandboxBackend::Gcp => "gcp",
            SandboxBackend::Digitalocean => "do",
            SandboxBackend::Linode => "linode",
            SandboxBackend::Unknown => "?",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SandboxStatus {
    Creating,
    Starting,
    Running,
    Stopping,
    Stopped,
    Paused,
    Error,
    Archived,
    Building,
    #[serde(other)]
    Unknown,
}

impl SandboxStatus {
    pub fn is_transitioning(self) -> bool {
        matches!(
            self,
            SandboxStatus::Creating | SandboxStatus::Starting | SandboxStatus::Building
        )
    }

    pub fn label(self) -> &'static str {
        match self {
            SandboxStatus::Creating => "creating",
            SandboxStatus::Starting => "starting",
            SandboxStatus::Running => "running",
            SandboxStatus::Stopping => "stopping",
            SandboxStatus::Stopped => "stopped",
            SandboxStatus::Paused => "paused",
            SandboxStatus::Error => "error",
            SandboxStatus::Archived => "archived",
            SandboxStatus::Building => "building",
            SandboxStatus::Unknown => "?",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // fields are wired in later phases (attach/cloud start payloads)
pub struct Sandbox {
    pub id: String,
    pub name: String,
    pub backend: SandboxBackend,
    pub status: SandboxStatus,
    pub vcpus: u32,
    pub memory_mb: u32,
    pub disk_gb: u32,
    #[serde(default)]
    pub guest_ip: Option<String>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    pub image: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SandboxListResponse {
    pub sandboxes: Vec<Sandbox>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // absolute byte fields are surfaced in the detail panel (later phase)
pub struct GuestMetrics {
    pub cpu_usage: f64,
    pub memory_used: u64,
    pub memory_total: u64,
    pub memory_usage: f64,
    pub disk_used: u64,
    pub disk_total: u64,
    pub disk_usage: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetricsResponse {
    #[serde(default)]
    pub metrics: Option<GuestMetrics>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentId {
    Claude,
    Codex,
    Gemini,
    Opencode,
    #[serde(other)]
    Unknown,
}

impl AgentId {
    pub fn glyph(self) -> &'static str {
        match self {
            AgentId::Claude => "C",
            AgentId::Codex => "X",
            AgentId::Gemini => "G",
            AgentId::Opencode => "O",
            AgentId::Unknown => "?",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)] // `name` shown in detail panel (later phase)
pub struct AgentInfo {
    pub id: AgentId,
    #[serde(default)]
    pub name: String,
    pub installed: bool,
    pub running: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentsResponse {
    #[serde(default)]
    pub agents: Vec<AgentInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStatus {
    NeedsInput,
    Error,
    Working,
    Done,
    Idle,
}

impl TerminalStatus {
    pub fn glyph(self) -> &'static str {
        match self {
            TerminalStatus::NeedsInput => "⚠",
            TerminalStatus::Error => "✗",
            TerminalStatus::Working => "⚙",
            TerminalStatus::Done => "✓",
            TerminalStatus::Idle => "·",
        }
    }

    pub fn is_alert(self) -> bool {
        matches!(self, TerminalStatus::NeedsInput | TerminalStatus::Error)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // `updated_at` surfaced in the detail panel (later phase)
pub struct TerminalSummaryResponse {
    #[serde(default)]
    pub status: Option<TerminalStatus>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub updated_at: Option<u64>,
}
