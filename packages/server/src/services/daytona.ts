/**
 * Daytona Cloud Backend Service
 *
 * Integrates with Daytona.io API for cloud-based development workspaces.
 * Implements workspace management similar to local hypervisor VM management.
 */

import { getConfig } from './config.js';
import type { VmInfo, VmStatus } from '../types/vm.js';

// Daytona sandbox states from API
export type DaytonaSandboxState =
  | 'creating'
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'archiving'
  | 'archived'
  | 'unarchiving'
  | 'build_failed'
  | 'error'
  | 'destroying'
  | 'destroyed'
  | 'unknown';

export interface DaytonaWorkspace {
  id: string;
  organizationId: string;
  name: string;
  target: string; // region like "us"
  snapshot?: string | null;
  user: string;
  env: Record<string, string>;
  cpu: number;
  gpu: number;
  memory: number; // GB
  disk: number; // GB
  public: boolean;
  labels: Record<string, string>;
  volumes: string[];
  state: DaytonaSandboxState;
  desiredState: string;
  errorReason?: string;
  recoverable: boolean;
  backupState: string;
  autoStopInterval: number;
  autoArchiveInterval: number;
  autoDeleteInterval: number;
  class: string; // "small", etc.
  createdAt: string;
  updatedAt: string;
  daemonVersion?: string | null;
  runnerId?: string;
  // Legacy fields for backwards compatibility
  repository?: string;
  ide?: string;
  sshHost?: string;
  sshPort?: number;
  startedAt?: string;
}

export interface CreateDaytonaWorkspaceRequest {
  name?: string;
  language?: 'python' | 'typescript' | 'javascript';
  snapshot?: string;
  resources?: {
    cpu?: number;
    memory?: number;
    disk?: number;
  };
  autoStopInterval?: number;
  ephemeral?: boolean;
  labels?: Record<string, string>;
}

export class DaytonaService {
  private apiUrl: string = 'https://app.daytona.io/api';
  private apiKey: string = '';
  private initialized: boolean = false;

  // Cache for workspaces to reduce API calls
  private workspacesCache: DaytonaWorkspace[] = [];
  private workspacesCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  /**
   * Initialize the Daytona service with config
   */
  async initialize(): Promise<void> {
    const config = await getConfig();
    const daytona = config.cloudBackends?.daytona;

    if (!daytona?.apiKey) {
      throw new Error('Daytona API key not configured');
    }

    this.apiUrl = daytona.apiUrl || 'https://app.daytona.io/api';
    this.apiKey = daytona.apiKey;
    this.initialized = true;

    console.log('[DaytonaService] Initialized with API URL:', this.apiUrl);
  }

  /**
   * Check if the service is initialized and enabled
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await getConfig();
      const daytona = config.cloudBackends?.daytona;
      return !!(daytona?.apiKey && daytona?.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Make an authenticated API request to Daytona
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.initialized) {
      await this.initialize();
    }

    const url = `${this.apiUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Daytona API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const response = await fetch(`${this.apiUrl}/health`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return { success: true, message: 'Connection successful' };
      } else {
        return { success: false, error: `API returned ${response.status}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  /**
   * Check if the cache is still valid
   */
  private isCacheValid(): boolean {
    return Date.now() - this.workspacesCacheTime < DaytonaService.CACHE_TTL_MS;
  }

  /**
   * Invalidate the workspace cache (call after mutations)
   */
  invalidateCache(): void {
    this.workspacesCacheTime = 0;
    this.workspacesCache = [];
    console.log('[DaytonaService] Cache invalidated');
  }

  /**
   * List all sandboxes (uses cache unless forceRefresh)
   * Note: Daytona API uses /sandbox (singular) for listing
   */
  async listWorkspaces(forceRefresh: boolean = false): Promise<DaytonaWorkspace[]> {
    // Return cached data if valid and not forcing refresh
    if (!forceRefresh && this.isCacheValid() && this.workspacesCache.length > 0) {
      console.log('[DaytonaService] Returning cached sandboxes');
      return this.workspacesCache;
    }

    try {
      // Daytona API uses /sandbox (singular) endpoint, returns array directly
      const sandboxes = await this.request<DaytonaWorkspace[]>('/sandbox');
      this.workspacesCache = sandboxes || [];
      this.workspacesCacheTime = Date.now();
      console.log('[DaytonaService] Fetched fresh sandboxes:', this.workspacesCache.length);
      return this.workspacesCache;
    } catch (err) {
      console.error('[DaytonaService] Failed to list sandboxes:', err);
      // Return cached data on error if available
      if (this.workspacesCache.length > 0) {
        console.log('[DaytonaService] Returning stale cache on error');
        return this.workspacesCache;
      }
      return [];
    }
  }

  /**
   * Get a specific sandbox
   */
  async getWorkspace(id: string): Promise<DaytonaWorkspace | null> {
    try {
      return await this.request<DaytonaWorkspace>(`/sandbox/${id}`);
    } catch {
      return null;
    }
  }

  /**
   * Create a new sandbox
   */
  async createWorkspace(request: CreateDaytonaWorkspaceRequest): Promise<DaytonaWorkspace> {
    const workspace = await this.request<DaytonaWorkspace>('/sandbox', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    this.invalidateCache();
    return workspace;
  }

  /**
   * Start a sandbox
   */
  async startWorkspace(id: string): Promise<DaytonaWorkspace> {
    const workspace = await this.request<DaytonaWorkspace>(`/sandbox/${id}/start`, {
      method: 'POST',
    });
    this.invalidateCache();
    return workspace;
  }

  /**
   * Stop a sandbox
   */
  async stopWorkspace(id: string): Promise<DaytonaWorkspace> {
    const workspace = await this.request<DaytonaWorkspace>(`/sandbox/${id}/stop`, {
      method: 'POST',
    });
    this.invalidateCache();
    return workspace;
  }

  /**
   * Delete a sandbox
   */
  async deleteWorkspace(id: string): Promise<void> {
    await this.request(`/sandbox/${id}`, {
      method: 'DELETE',
    });
    this.invalidateCache();
  }

  /**
   * Get SSH connection info for a workspace
   */
  async getSshInfo(id: string): Promise<{
    host: string;
    port: number;
    user: string;
    command: string;
  } | null> {
    const workspace = await this.getWorkspace(id);
    if (!workspace || !workspace.sshHost) {
      return null;
    }

    const sshUser = workspace.user || 'daytona';
    return {
      host: workspace.sshHost,
      port: workspace.sshPort || 22,
      user: sshUser,
      command: `ssh -p ${workspace.sshPort || 22} ${sshUser}@${workspace.sshHost}`,
    };
  }

  /**
   * Convert Daytona sandbox state to VmStatus
   */
  private workspaceStatusToVmStatus(state: DaytonaSandboxState): VmStatus {
    switch (state) {
      case 'creating':
      case 'starting':
      case 'unarchiving':
        return 'creating';
      case 'started':
        return 'running';
      case 'stopping':
      case 'stopped':
      case 'archiving':
      case 'archived':
        return 'stopped';
      case 'build_failed':
      case 'error':
        return 'error';
      case 'destroying':
      case 'destroyed':
        return 'stopped';
      default:
        return 'stopped';
    }
  }

  /**
   * Convert Daytona sandbox to VmInfo format for UI compatibility
   * Note: Daytona uses Docker containers (daytonaio/sandbox:0.4.1)
   */
  workspaceToVmInfo(workspace: DaytonaWorkspace): VmInfo {
    const status = this.workspaceStatusToVmStatus(workspace.state);
    const language = workspace.labels?.['code-toolbox-language'] || 'python';
    const sshUser = workspace.user || 'daytona';
    // Sandbox class: small (1cpu/1gb), medium (2cpu/4gb), large (4cpu/8gb)
    const sizeClass = workspace.class || 'small';

    return {
      id: `daytona-${workspace.id}`,
      name: workspace.name,
      status,
      state: status,
      hypervisor: 'daytona',
      sshHost: workspace.sshHost || '',
      sshPort: workspace.sshPort || 22,
      sshUser,
      sshCommand: workspace.sshHost
        ? `ssh -p ${workspace.sshPort || 22} ${sshUser}@${workspace.sshHost}`
        : undefined,
      guestIp: workspace.sshHost,
      networkMode: 'none', // Cloud sandboxes don't use local networking
      ports: [],
      volumes: [], // Daytona volumes have different structure, return empty for now
      image: `daytona-${sizeClass} (${language})`,
      vcpus: workspace.cpu || 1,
      memoryMb: (workspace.memory || 1) * 1024, // Convert GB to MB
      diskGb: workspace.disk || 5,
      createdAt: workspace.createdAt,
      startedAt: workspace.updatedAt, // Use updatedAt as proxy for startedAt
      error: workspace.errorReason,
    };
  }

  /**
   * List all Daytona workspaces as VmInfo
   */
  async listVms(): Promise<VmInfo[]> {
    const workspaces = await this.listWorkspaces();
    return workspaces.map((ws) => this.workspaceToVmInfo(ws));
  }

  /**
   * Get a Daytona workspace as VmInfo
   */
  async getVm(id: string): Promise<VmInfo | null> {
    // Strip the 'daytona-' prefix if present
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
    const workspace = await this.getWorkspace(workspaceId);
    return workspace ? this.workspaceToVmInfo(workspace) : null;
  }

  /**
   * Create a new Daytona sandbox (VM-like interface)
   */
  async createVm(request: {
    name: string;
    language?: 'python' | 'typescript' | 'javascript';
    autoStopInterval?: number;
  }): Promise<VmInfo> {
    const workspace = await this.createWorkspace({
      name: request.name,
      language: request.language || 'python',
      autoStopInterval: request.autoStopInterval ?? 15, // 15 min default
    });
    return this.workspaceToVmInfo(workspace);
  }

  /**
   * Start a Daytona workspace (VM-like interface)
   */
  async startVm(id: string): Promise<VmInfo> {
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
    const workspace = await this.startWorkspace(workspaceId);
    return this.workspaceToVmInfo(workspace);
  }

  /**
   * Stop a Daytona workspace (VM-like interface)
   */
  async stopVm(id: string): Promise<VmInfo> {
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
    const workspace = await this.stopWorkspace(workspaceId);
    return this.workspaceToVmInfo(workspace);
  }

  /**
   * Delete a Daytona workspace (VM-like interface)
   */
  async deleteVm(id: string): Promise<void> {
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
    await this.deleteWorkspace(workspaceId);
  }
}

// Singleton instance
let daytonaService: DaytonaService | null = null;

export function getDaytonaService(): DaytonaService {
  if (!daytonaService) {
    daytonaService = new DaytonaService();
  }
  return daytonaService;
}

export async function initializeDaytonaService(): Promise<DaytonaService> {
  const service = getDaytonaService();
  await service.initialize();
  return service;
}
