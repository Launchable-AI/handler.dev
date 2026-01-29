/**
 * MCP Server Deployment Types
 *
 * Types for deploying and managing MCP servers on cloud backends.
 */

import type { SandboxBackend } from './sandbox.js';

export type MCPDeploymentStatus =
  | 'provisioning'
  | 'installing'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'
  | 'unreachable';

export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

export type MCPInstallMethod = 'npm' | 'pip' | 'docker' | 'cargo' | 'git-clone';

export interface MCPDeploymentLogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'warn';
}

export interface MCPConnectionConfig {
  /** For stdio transport (local or SSH) */
  command?: string;
  args?: string[];
  /** For SSE/HTTP transport */
  url?: string;
  /** Environment variables needed */
  env?: Record<string, string>;
}

export interface MCPDeployment {
  id: string;
  serverName: string;
  serverTitle: string;
  status: MCPDeploymentStatus;
  backend: SandboxBackend;
  sandboxId: string;
  installMethod: MCPInstallMethod;
  transport: MCPTransport;
  port?: number;
  endpoint?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  connectionConfig?: MCPConnectionConfig;
  healthCheckFailures: number;
  deployLog: MCPDeploymentLogEntry[];
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
}

export interface MCPLocalServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  status: 'running' | 'stopped' | 'unknown';
  source: 'claude-json' | 'process';
  pid?: number;
}

export interface MCPDeployRequest {
  serverName: string;
  backend: SandboxBackend;
  env?: Record<string, string>;
}

export interface MCPDeploymentStore {
  deployments: MCPDeployment[];
}
