use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::Client;

use super::types::{
    AgentsResponse, MetricsResponse, SandboxListResponse, TerminalSummaryResponse,
};

#[derive(Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
}

impl ApiClient {
    pub fn new(base_url: String) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(3))
            .build()
            .context("failed to build HTTP client")?;
        let base_url = base_url.trim_end_matches('/').to_string();
        Ok(Self { client, base_url })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn list_sandboxes(&self) -> Result<SandboxListResponse> {
        let url = format!("{}/api/sandboxes", self.base_url);
        let res = self.client.get(&url).send().await?;
        let status = res.status();
        if !status.is_success() {
            anyhow::bail!("GET /api/sandboxes returned HTTP {}", status);
        }
        let parsed = res
            .json::<SandboxListResponse>()
            .await
            .context("decoding sandbox list")?;
        Ok(parsed)
    }

    pub async fn get_metrics(&self, id: &str) -> Result<MetricsResponse> {
        let url = format!("{}/api/sandboxes/{}/metrics", self.base_url, id);
        let res = self.client.get(&url).send().await?;
        // Server returns { metrics: null } on errors with 200, so we don't strictly
        // need to check status here, but a non-200 still means something is wrong.
        if !res.status().is_success() {
            return Ok(MetricsResponse { metrics: None });
        }
        Ok(res.json::<MetricsResponse>().await.unwrap_or(MetricsResponse { metrics: None }))
    }

    pub async fn get_agents(&self, id: &str) -> Result<AgentsResponse> {
        let url = format!("{}/api/sandboxes/{}/agents", self.base_url, id);
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            return Ok(AgentsResponse { agents: vec![] });
        }
        Ok(res
            .json::<AgentsResponse>()
            .await
            .unwrap_or(AgentsResponse { agents: vec![] }))
    }

    pub async fn get_terminal_summary(
        &self,
        id: &str,
        tmux_session: Option<&str>,
    ) -> Result<TerminalSummaryResponse> {
        let mut url = format!("{}/api/sandboxes/{}/terminal-summary", self.base_url, id);
        if let Some(s) = tmux_session {
            // Manual encoding rather than dragging in a query-builder; tmux session names
            // are alphanumeric + `-` so percent-encoding isn't required, but we play it safe.
            let encoded: String = s
                .chars()
                .flat_map(|c| {
                    if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                        vec![c]
                    } else {
                        format!("%{:02X}", c as u32).chars().collect()
                    }
                })
                .collect();
            url.push_str("?session=");
            url.push_str(&encoded);
        }
        let res = self.client.get(&url).send().await?;
        if !res.status().is_success() {
            return Ok(TerminalSummaryResponse {
                status: None,
                summary: None,
                updated_at: None,
            });
        }
        Ok(res
            .json::<TerminalSummaryResponse>()
            .await
            .unwrap_or(TerminalSummaryResponse {
                status: None,
                summary: None,
                updated_at: None,
            }))
    }

    pub async fn start_sandbox(&self, id: &str) -> Result<()> {
        let url = format!("{}/api/sandboxes/{}/start", self.base_url, id);
        let res = self.client.post(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!(
                "POST /api/sandboxes/{}/start returned HTTP {}",
                id,
                res.status()
            );
        }
        Ok(())
    }

    pub async fn stop_sandbox(&self, id: &str) -> Result<()> {
        let url = format!("{}/api/sandboxes/{}/stop", self.base_url, id);
        let res = self.client.post(&url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!(
                "POST /api/sandboxes/{}/stop returned HTTP {}",
                id,
                res.status()
            );
        }
        Ok(())
    }
}
