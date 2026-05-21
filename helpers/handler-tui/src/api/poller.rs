use std::collections::{HashMap, HashSet};
use std::time::Duration;

use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;
use tokio::time::{interval, MissedTickBehavior};

use crate::api::types::SandboxStatus;
use crate::api::ApiClient;
use crate::event::{AppEvent, SandboxId};

const LIST_INTERVAL_NORMAL: Duration = Duration::from_secs(5);
const LIST_INTERVAL_BUSY: Duration = Duration::from_secs(2);
const METRICS_INTERVAL: Duration = Duration::from_secs(5);
const SUMMARY_INTERVAL: Duration = Duration::from_secs(5);
const AGENTS_INTERVAL: Duration = Duration::from_secs(30);
const ERROR_BACKOFF: Duration = Duration::from_secs(10);

struct PerSandbox {
    metrics: JoinHandle<()>,
    summary: JoinHandle<()>,
    agents: JoinHandle<()>,
}

impl PerSandbox {
    fn abort(&self) {
        self.metrics.abort();
        self.summary.abort();
        self.agents.abort();
    }
}

pub fn spawn(api: ApiClient, tx: UnboundedSender<AppEvent>) -> JoinHandle<()> {
    tokio::spawn(run(api, tx))
}

async fn run(api: ApiClient, tx: UnboundedSender<AppEvent>) {
    let mut per_sandbox: HashMap<SandboxId, PerSandbox> = HashMap::new();
    let mut current_period = LIST_INTERVAL_NORMAL;
    let mut tick = interval(current_period);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tick.tick().await;

        let list = match api.list_sandboxes().await {
            Ok(l) => l,
            Err(e) => {
                let _ = tx.send(AppEvent::ApiError(format!("list_sandboxes: {e}")));
                // Slow down on errors to avoid hammering an unreachable server.
                if current_period != ERROR_BACKOFF {
                    current_period = ERROR_BACKOFF;
                    tick = interval(current_period);
                    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
                }
                continue;
            }
        };

        let running_ids: HashSet<SandboxId> = list
            .sandboxes
            .iter()
            .filter(|s| s.status == SandboxStatus::Running)
            .map(|s| s.id.clone())
            .collect();

        // Cancel per-sandbox pollers for sandboxes that are no longer running.
        per_sandbox.retain(|id, handles| {
            if running_ids.contains(id) {
                true
            } else {
                handles.abort();
                false
            }
        });

        // Spawn per-sandbox pollers for newly-running sandboxes.
        for id in &running_ids {
            if !per_sandbox.contains_key(id) {
                let handles = PerSandbox {
                    metrics: spawn_metrics(api.clone(), id.clone(), tx.clone()),
                    summary: spawn_summary(api.clone(), id.clone(), tx.clone()),
                    agents: spawn_agents(api.clone(), id.clone(), tx.clone()),
                };
                per_sandbox.insert(id.clone(), handles);
            }
        }

        // Adaptive cadence: faster polling while any sandbox is in a transient state.
        let any_transitioning = list.sandboxes.iter().any(|s| s.status.is_transitioning());
        let desired = if any_transitioning {
            LIST_INTERVAL_BUSY
        } else {
            LIST_INTERVAL_NORMAL
        };
        if desired != current_period {
            current_period = desired;
            tick = interval(current_period);
            tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        }

        if tx.send(AppEvent::SandboxesUpdated(list.sandboxes)).is_err() {
            // Receiver dropped — app is shutting down.
            for (_, h) in per_sandbox.drain() {
                h.abort();
            }
            return;
        }
    }
}

fn spawn_metrics(
    api: ApiClient,
    id: SandboxId,
    tx: UnboundedSender<AppEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = interval(METRICS_INTERVAL);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            match api.get_metrics(&id).await {
                Ok(r) => {
                    if tx
                        .send(AppEvent::MetricsUpdated(id.clone(), r.metrics))
                        .is_err()
                    {
                        return;
                    }
                }
                Err(_) => {
                    if tx
                        .send(AppEvent::MetricsUpdated(id.clone(), None))
                        .is_err()
                    {
                        return;
                    }
                }
            }
        }
    })
}

fn spawn_summary(
    api: ApiClient,
    id: SandboxId,
    tx: UnboundedSender<AppEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = interval(SUMMARY_INTERVAL);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            if let Ok(r) = api.get_terminal_summary(&id, None).await {
                if tx
                    .send(AppEvent::SummaryUpdated(id.clone(), r))
                    .is_err()
                {
                    return;
                }
            }
        }
    })
}

fn spawn_agents(
    api: ApiClient,
    id: SandboxId,
    tx: UnboundedSender<AppEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = interval(AGENTS_INTERVAL);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            if let Ok(r) = api.get_agents(&id).await {
                if tx
                    .send(AppEvent::AgentsUpdated(id.clone(), r.agents))
                    .is_err()
                {
                    return;
                }
            }
        }
    })
}
