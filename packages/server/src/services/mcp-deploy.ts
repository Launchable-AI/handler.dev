/**
 * MCP Server Deployment Service
 *
 * Handles deploying MCP servers to cloud backends, managing lifecycle,
 * and discovering local MCP servers.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { execSync, execFileSync } from 'child_process';
import type {
  MCPDeployment,
  MCPDeploymentStatus,
  MCPDeploymentStore,
  MCPDeployRequest,
  MCPInstallMethod,
  MCPTransport,
  MCPConnectionConfig,
  MCPDeploymentLogEntry,
  MCPLocalServer,
} from '../types/mcp-deployment.js';
import type { SandboxBackend } from '../types/sandbox.js';
import { getServerByName, type MCPServer } from './mcp-registry.js';
import { getSandboxService } from './sandbox/index.js';
import { PROJECT_ROOT } from '../lib/paths.js';

const DATA_DIR = join(PROJECT_ROOT, 'data');
const DEPLOYMENTS_FILE = join(DATA_DIR, 'mcp-deployments.json');

// Image mapping for install methods
const BASE_IMAGES: Record<MCPInstallMethod, string> = {
  npm: 'node:20-slim',
  pip: 'python:3.12-slim',
  docker: 'docker:latest',
  cargo: 'rust:slim',
  'git-clone': 'ubuntu:22.04',
};

// Default port for MCP servers
const DEFAULT_MCP_PORT = 3000;

// ============ Persistence ============

async function loadStore(): Promise<MCPDeploymentStore> {
  try {
    if (existsSync(DEPLOYMENTS_FILE)) {
      const data = await readFile(DEPLOYMENTS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load MCP deployments store:', error);
  }
  return { deployments: [] };
}

async function saveStore(store: MCPDeploymentStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DEPLOYMENTS_FILE, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============ Install Method Resolution ============

function resolveInstallMethod(server: MCPServer): MCPInstallMethod {
  if (!server.packages || server.packages.length === 0) {
    return 'git-clone';
  }

  const pkg = server.packages[0];
  switch (pkg.registryType) {
    case 'npm': return 'npm';
    case 'pypi': return 'pip';
    case 'docker': return 'docker';
    case 'crate': return 'cargo';
    default: return 'git-clone';
  }
}

function resolveTransport(server: MCPServer): MCPTransport {
  if (server.packages?.[0]?.transport?.type) {
    const t = server.packages[0].transport.type;
    if (t === 'sse' || t === 'streamable-http') return t;
  }
  return 'stdio';
}

function getInstallCommands(server: MCPServer, method: MCPInstallMethod): string[] {
  const pkg = server.packages?.[0];
  if (!pkg) return [];

  switch (method) {
    case 'npm':
      return [
        'npm install -g ' + pkg.identifier,
      ];
    case 'pip':
      return [
        'pip install ' + pkg.identifier,
      ];
    case 'cargo':
      return [
        'cargo install ' + pkg.identifier,
      ];
    case 'docker':
      return [
        'docker pull ' + pkg.identifier,
      ];
    case 'git-clone':
      if (server.repository?.url) {
        return [
          'apt-get update && apt-get install -y git nodejs npm',
          `git clone ${server.repository.url} /opt/mcp-server`,
          'cd /opt/mcp-server && npm install',
        ];
      }
      return [];
  }
}

function getStartCommand(server: MCPServer, method: MCPInstallMethod): { command: string; args: string[] } {
  const pkg = server.packages?.[0];

  switch (method) {
    case 'npm':
      return { command: 'npx', args: ['-y', pkg?.identifier || server.name] };
    case 'pip':
      return { command: 'uvx', args: [pkg?.identifier || server.name] };
    case 'cargo':
      return { command: pkg?.identifier || server.name, args: [] };
    case 'docker':
      return { command: 'docker', args: ['run', '-i', pkg?.identifier || server.name] };
    case 'git-clone':
      return { command: 'node', args: ['/opt/mcp-server/index.js'] };
  }
}

// ============ Deploy Pipeline ============

export type DeployProgressCallback = (event: {
  status: MCPDeploymentStatus;
  message: string;
  deployment?: MCPDeployment;
}) => void;

export async function deploy(
  request: MCPDeployRequest,
  onProgress?: DeployProgressCallback
): Promise<MCPDeployment> {
  const { serverName, backend, env: userEnv } = request;

  // 1. Look up server from registry
  const server = await getServerByName(serverName);
  if (!server) {
    throw new Error(`Server '${serverName}' not found in registry`);
  }

  const installMethod = resolveInstallMethod(server);
  const transport = resolveTransport(server);
  const image = BASE_IMAGES[installMethod];
  const startCmd = getStartCommand(server, installMethod);

  const deploymentId = generateId();
  const deployLog: MCPDeploymentLogEntry[] = [];

  const log = (message: string, level: 'info' | 'error' | 'warn' = 'info') => {
    const entry: MCPDeploymentLogEntry = {
      timestamp: new Date().toISOString(),
      message,
      level,
    };
    deployLog.push(entry);
    console.log(`[MCP Deploy ${deploymentId}] ${message}`);
  };

  let deployment: MCPDeployment = {
    id: deploymentId,
    serverName: server.name,
    serverTitle: server.title || server.name,
    status: 'provisioning',
    backend,
    sandboxId: '',
    installMethod,
    transport,
    port: transport !== 'stdio' ? DEFAULT_MCP_PORT : undefined,
    command: startCmd.command,
    args: startCmd.args,
    env: userEnv || {},
    healthCheckFailures: 0,
    deployLog,
    createdAt: new Date().toISOString(),
  };

  try {
    // 2. Provision sandbox
    log(`Provisioning ${backend} sandbox with image ${image}...`);
    onProgress?.({ status: 'provisioning', message: `Provisioning ${backend} sandbox...` });

    const sandboxService = getSandboxService();
    const ports = transport !== 'stdio'
      ? [{ container: DEFAULT_MCP_PORT, host: 0 }]
      : [];

    const sandbox = await sandboxService.create({
      name: `mcp-${server.name.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40)}`,
      backend,
      image,
      ports,
      ...(backend === 'docker' ? {
        dockerOptions: {
          env: userEnv,
        },
      } : {}),
    });

    deployment.sandboxId = sandbox.id;
    log(`Sandbox created: ${sandbox.id}`);

    // Wait for sandbox to be running
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
      const current = await sandboxService.get(sandbox.id);
      if (current?.status === 'running') break;
      if (current?.status === 'error') {
        throw new Error(`Sandbox failed to start: ${current.error}`);
      }
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
    }
    if (attempts >= maxAttempts) {
      throw new Error('Sandbox failed to reach running state');
    }

    // 3. Install MCP server
    deployment.status = 'installing';
    log('Installing MCP server...');
    onProgress?.({ status: 'installing', message: 'Installing MCP server packages...' });

    const installCmds = getInstallCommands(server, installMethod);
    for (const cmd of installCmds) {
      log(`Running: ${cmd}`);
      // Execute install command in sandbox
      // For Docker, use docker exec; for VMs/cloud, use SSH
      const updatedSandbox = await sandboxService.get(sandbox.id);
      if (updatedSandbox?.terminalType === 'docker-exec' && updatedSandbox.backendMeta?.type === 'docker') {
        const containerId = (updatedSandbox.backendMeta as { containerId: string }).containerId;
        try {
          execFileSync('docker', ['exec', containerId, 'sh', '-c', cmd], {
            timeout: 300000,
            stdio: 'pipe',
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          log(`Install command failed: ${errorMsg}`, 'warn');
        }
      } else if (updatedSandbox?.sshCommand) {
        // SSH-based execution
        const sshBase = updatedSandbox.sshCommand.replace(/\s*$/, '');
        try {
          execSync(`${sshBase} "${cmd.replace(/"/g, '\\"')}"`, {
            timeout: 300000,
            stdio: 'pipe',
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          log(`Install command failed: ${errorMsg}`, 'warn');
        }
      }
    }

    // 4. Start MCP server process
    deployment.status = 'starting';
    log('Starting MCP server...');
    onProgress?.({ status: 'starting', message: 'Starting MCP server process...' });

    const fullCommand = `${startCmd.command} ${startCmd.args.join(' ')}`;
    const updatedSandbox = await sandboxService.get(sandbox.id);

    if (updatedSandbox?.terminalType === 'docker-exec' && updatedSandbox.backendMeta?.type === 'docker') {
      const containerId = (updatedSandbox.backendMeta as { containerId: string }).containerId;
      // Start in background for stdio transport
      const bgSuffix = transport === 'stdio' ? '' : ' &';
      const dockerArgs = ['exec', '-d'];
      for (const [k, v] of Object.entries(deployment.env)) {
        dockerArgs.push('-e', `${k}=${v}`);
      }
      dockerArgs.push(containerId, 'sh', '-c', `${fullCommand}${bgSuffix}`);
      try {
        execFileSync('docker', dockerArgs, { timeout: 30000, stdio: 'pipe' });
      } catch (err) {
        log(`Start command output: ${err instanceof Error ? err.message : 'Unknown'}`, 'warn');
      }
    } else if (updatedSandbox?.sshCommand) {
      const sshBase = updatedSandbox.sshCommand.replace(/\s*$/, '');
      const envStr = Object.entries(deployment.env)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      try {
        execSync(
          `${sshBase} "nohup ${envStr ? envStr + ' ' : ''}${fullCommand.replace(/"/g, '\\"')} > /tmp/mcp-server.log 2>&1 &"`,
          { timeout: 30000, stdio: 'pipe' }
        );
      } catch (err) {
        log(`Start command output: ${err instanceof Error ? err.message : 'Unknown'}`, 'warn');
      }
    }

    // 5. Detect port and build connection config
    const finalSandbox = await sandboxService.get(sandbox.id);
    deployment.status = 'running';
    deployment.startedAt = new Date().toISOString();

    // Build connection config
    deployment.connectionConfig = generateConnectionConfig(deployment, finalSandbox);
    deployment.endpoint = deployment.connectionConfig.url;

    log('MCP server deployed and running');
    onProgress?.({ status: 'running', message: 'MCP server is running', deployment });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    deployment.status = 'error';
    log(`Deployment failed: ${message}`, 'error');
    onProgress?.({ status: 'error', message: `Deployment failed: ${message}` });
  }

  // Save deployment
  const store = await loadStore();
  store.deployments.push(deployment);
  await saveStore(store);

  return deployment;
}

// ============ Connection Config ============

function generateConnectionConfig(
  deployment: MCPDeployment,
  sandbox?: { sshHost?: string; sshPort?: number; sshUser?: string; sshCommand?: string; ports?: Array<{ container: number; host: number }> } | null
): MCPConnectionConfig {
  if (deployment.transport === 'stdio') {
    if (sandbox?.sshCommand) {
      // Remote stdio via SSH
      return {
        command: 'ssh',
        args: [
          ...(sandbox.sshPort ? ['-p', String(sandbox.sshPort)] : []),
          ...(sandbox.sshUser ? [`${sandbox.sshUser}@${sandbox.sshHost || 'localhost'}`] : [sandbox.sshHost || 'localhost']),
          deployment.command,
          ...deployment.args,
        ],
        env: deployment.env,
      };
    }
    // Local stdio
    return {
      command: deployment.command,
      args: deployment.args,
      env: deployment.env,
    };
  }

  // SSE or streamable-http
  const hostPort = sandbox?.ports?.find(p => p.container === deployment.port)?.host || deployment.port;
  const host = sandbox?.sshHost || 'localhost';
  const path = deployment.transport === 'sse' ? '/sse' : '/mcp';

  return {
    url: `http://${host}:${hostPort}${path}`,
    env: deployment.env,
  };
}

// ============ Lifecycle ============

export async function stopDeployment(id: string): Promise<MCPDeployment> {
  const store = await loadStore();
  const deployment = store.deployments.find(d => d.id === id);
  if (!deployment) throw new Error(`Deployment '${id}' not found`);

  try {
    const sandboxService = getSandboxService();
    await sandboxService.stop(deployment.sandboxId);
    deployment.status = 'stopped';
    deployment.stoppedAt = new Date().toISOString();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    deployment.deployLog.push({
      timestamp: new Date().toISOString(),
      message: `Stop failed: ${message}`,
      level: 'error',
    });
    throw error;
  }

  await saveStore(store);
  return deployment;
}

export async function restartDeployment(id: string): Promise<MCPDeployment> {
  const store = await loadStore();
  const deployment = store.deployments.find(d => d.id === id);
  if (!deployment) throw new Error(`Deployment '${id}' not found`);

  try {
    const sandboxService = getSandboxService();
    await sandboxService.start(deployment.sandboxId);

    // Re-start the MCP server process
    const sandbox = await sandboxService.get(deployment.sandboxId);
    const fullCommand = `${deployment.command} ${deployment.args.join(' ')}`;

    if (sandbox?.terminalType === 'docker-exec' && sandbox.backendMeta?.type === 'docker') {
      const containerId = (sandbox.backendMeta as { containerId: string }).containerId;
      try {
        execFileSync('docker', ['exec', '-d', containerId, 'sh', '-c', fullCommand], { timeout: 30000, stdio: 'pipe' });
      } catch {
        // Process may already be running
      }
    }

    deployment.status = 'running';
    deployment.startedAt = new Date().toISOString();
    deployment.healthCheckFailures = 0;
    deployment.connectionConfig = generateConnectionConfig(deployment, sandbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    deployment.deployLog.push({
      timestamp: new Date().toISOString(),
      message: `Restart failed: ${message}`,
      level: 'error',
    });
    throw error;
  }

  await saveStore(store);
  return deployment;
}

export async function deleteDeployment(id: string): Promise<void> {
  const store = await loadStore();
  const deployment = store.deployments.find(d => d.id === id);
  if (!deployment) throw new Error(`Deployment '${id}' not found`);

  // Clean up sandbox
  try {
    const sandboxService = getSandboxService();
    await sandboxService.delete(deployment.sandboxId);
  } catch (error) {
    console.warn(`Failed to delete sandbox for deployment ${id}:`, error);
  }

  store.deployments = store.deployments.filter(d => d.id !== id);
  await saveStore(store);
}

// ============ Queries ============

export async function listDeployments(): Promise<MCPDeployment[]> {
  const store = await loadStore();
  return store.deployments;
}

export async function getDeployment(id: string): Promise<MCPDeployment | null> {
  const store = await loadStore();
  return store.deployments.find(d => d.id === id) || null;
}

export async function getDeploymentLogs(id: string): Promise<MCPDeploymentLogEntry[]> {
  const store = await loadStore();
  const deployment = store.deployments.find(d => d.id === id);
  if (!deployment) throw new Error(`Deployment '${id}' not found`);
  return deployment.deployLog;
}

// ============ Local Server Discovery ============

export async function discoverLocalServers(): Promise<MCPLocalServer[]> {
  const servers: MCPLocalServer[] = [];

  // Parse ~/.claude.json
  try {
    const claudeJsonPath = join(homedir(), '.claude.json');
    if (existsSync(claudeJsonPath)) {
      const content = await readFile(claudeJsonPath, 'utf-8');
      const claudeConfig = JSON.parse(content);

      // Check mcpServers in projects or global config
      const mcpServers = claudeConfig.mcpServers || {};

      for (const [name, config] of Object.entries(mcpServers)) {
        const serverConfig = config as { command?: string; args?: string[]; env?: Record<string, string> };
        if (serverConfig.command) {
          // Try to check if process is running
          let status: 'running' | 'stopped' | 'unknown' = 'unknown';
          try {
            const result = execFileSync('pgrep', ['-f', serverConfig.command], { stdio: 'pipe' }).toString().trim();
            status = result ? 'running' : 'stopped';
          } catch {
            status = 'unknown';
          }

          servers.push({
            name,
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: serverConfig.env,
            status,
            source: 'claude-json',
          });
        }
      }
    }
  } catch (error) {
    console.warn('Failed to parse ~/.claude.json:', error);
  }

  // Also check project-level .mcp.json
  try {
    const mcpJsonPath = join(process.cwd(), '.mcp.json');
    if (existsSync(mcpJsonPath)) {
      const content = await readFile(mcpJsonPath, 'utf-8');
      const mcpConfig = JSON.parse(content);
      const mcpServers = mcpConfig.mcpServers || {};

      for (const [name, config] of Object.entries(mcpServers)) {
        const serverConfig = config as { command?: string; args?: string[]; env?: Record<string, string> };
        if (serverConfig.command && !servers.some(s => s.name === name)) {
          servers.push({
            name,
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: serverConfig.env,
            status: 'unknown',
            source: 'claude-json',
          });
        }
      }
    }
  } catch (error) {
    console.warn('Failed to parse .mcp.json:', error);
  }

  return servers;
}

// ============ Health Updates ============

export async function updateDeploymentStatus(id: string, status: MCPDeploymentStatus): Promise<void> {
  const store = await loadStore();
  const deployment = store.deployments.find(d => d.id === id);
  if (deployment) {
    deployment.status = status;
    await saveStore(store);
  }
}

export async function incrementHealthFailures(id: string): Promise<number> {
  const store = await loadStore();
  const deployment = store.deployments.find(d => d.id === id);
  if (deployment) {
    deployment.healthCheckFailures++;
    await saveStore(store);
    return deployment.healthCheckFailures;
  }
  return 0;
}

export async function resetHealthFailures(id: string): Promise<void> {
  const store = await loadStore();
  const deployment = store.deployments.find(d => d.id === id);
  if (deployment) {
    deployment.healthCheckFailures = 0;
    if (deployment.status === 'unreachable') {
      deployment.status = 'running';
    }
    await saveStore(store);
  }
}
