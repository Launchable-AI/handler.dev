/**
 * MCP Health Monitor
 *
 * Background service that periodically checks the health of all running
 * MCP server deployments and updates their status.
 */

import { execSync } from 'child_process';
import {
  listDeployments,
  updateDeploymentStatus,
  incrementHealthFailures,
  resetHealthFailures,
} from './mcp-deploy.js';
import { getSandboxService } from './sandbox/index.js';

const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const MAX_FAILURES = 3;

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

export function startHealthMonitor(): void {
  if (healthCheckTimer) return;

  console.log('[MCP Health] Starting health monitor (30s interval)');

  healthCheckTimer = setInterval(async () => {
    try {
      await checkAllDeployments();
    } catch (error) {
      console.error('[MCP Health] Health check error:', error);
    }
  }, HEALTH_CHECK_INTERVAL);
}

export function stopHealthMonitor(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log('[MCP Health] Health monitor stopped');
  }
}

async function checkAllDeployments(): Promise<void> {
  const deployments = await listDeployments();
  const running = deployments.filter(d => d.status === 'running' || d.status === 'unreachable');

  if (running.length === 0) return;

  const sandboxService = getSandboxService();

  for (const deployment of running) {
    try {
      let healthy = false;

      if (deployment.transport === 'stdio') {
        // Check if the process is alive in the sandbox
        healthy = await checkStdioHealth(deployment.sandboxId, deployment.command, sandboxService);
      } else {
        // HTTP health check for SSE/streamable-http
        healthy = await checkHttpHealth(deployment);
      }

      if (healthy) {
        await resetHealthFailures(deployment.id);
      } else {
        const failures = await incrementHealthFailures(deployment.id);
        if (failures >= MAX_FAILURES) {
          console.warn(`[MCP Health] Deployment ${deployment.id} (${deployment.serverName}) marked unreachable after ${failures} failures`);
          await updateDeploymentStatus(deployment.id, 'unreachable');
        }
      }
    } catch (error) {
      console.warn(`[MCP Health] Check failed for ${deployment.id}:`, error);
      const failures = await incrementHealthFailures(deployment.id);
      if (failures >= MAX_FAILURES) {
        await updateDeploymentStatus(deployment.id, 'unreachable');
      }
    }
  }
}

async function checkStdioHealth(
  sandboxId: string,
  command: string,
  sandboxService: ReturnType<typeof getSandboxService>
): Promise<boolean> {
  try {
    const sandbox = await sandboxService.get(sandboxId);
    if (!sandbox || sandbox.status !== 'running') return false;

    if (sandbox.terminalType === 'docker-exec' && sandbox.backendMeta?.type === 'docker') {
      const containerId = (sandbox.backendMeta as { containerId: string }).containerId;
      const result = execSync(
        `docker exec ${containerId} pgrep -f "${command}" 2>/dev/null || true`,
        { timeout: 10000, stdio: 'pipe' }
      ).toString().trim();
      return result.length > 0;
    }

    if (sandbox.sshCommand) {
      const sshBase = sandbox.sshCommand.replace(/\s*$/, '');
      const result = execSync(
        `${sshBase} "pgrep -f '${command}' 2>/dev/null || true"`,
        { timeout: 10000, stdio: 'pipe' }
      ).toString().trim();
      return result.length > 0;
    }

    return false;
  } catch {
    return false;
  }
}

async function checkHttpHealth(deployment: {
  connectionConfig?: { url?: string };
  port?: number;
}): Promise<boolean> {
  const url = deployment.connectionConfig?.url;
  if (!url) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok || response.status === 405; // Some MCP servers don't support GET
  } catch {
    return false;
  }
}
