/**
 * Daytona Cloud Backend Service
 *
 * Integrates with Daytona.io API for cloud-based development workspaces.
 * Implements workspace management similar to local hypervisor VM management.
 */

import { getConfig } from './config.js';
import type { VmInfo, VmStatus } from '../types/vm.js';

export interface DaytonaWorkspace {
  id: string;
  name: string;
  status: 'creating' | 'running' | 'stopped' | 'error' | 'deleting';
  repository?: string;
  ide?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  createdAt: string;
  startedAt?: string;
  error?: string;
}

export interface CreateDaytonaWorkspaceRequest {
  name: string;
  repository?: string;
  ide?: 'vscode' | 'cursor' | 'windsurf' | 'fleet' | string;
  branch?: string;
}

export class DaytonaService {
  private apiUrl: string = 'https://api.daytona.io';
  private apiKey: string = '';
  private initialized: boolean = false;

  /**
   * Initialize the Daytona service with config
   */
  async initialize(): Promise<void> {
    const config = await getConfig();
    const daytona = config.cloudBackends?.daytona;

    if (!daytona?.apiKey) {
      throw new Error('Daytona API key not configured');
    }

    this.apiUrl = daytona.apiUrl || 'https://api.daytona.io';
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
   * List all workspaces
   */
  async listWorkspaces(): Promise<DaytonaWorkspace[]> {
    try {
      const response = await this.request<{ workspaces: DaytonaWorkspace[] }>('/workspaces');
      return response.workspaces || [];
    } catch (err) {
      console.error('[DaytonaService] Failed to list workspaces:', err);
      return [];
    }
  }

  /**
   * Get a specific workspace
   */
  async getWorkspace(id: string): Promise<DaytonaWorkspace | null> {
    try {
      return await this.request<DaytonaWorkspace>(`/workspaces/${id}`);
    } catch {
      return null;
    }
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(request: CreateDaytonaWorkspaceRequest): Promise<DaytonaWorkspace> {
    return await this.request<DaytonaWorkspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Start a workspace
   */
  async startWorkspace(id: string): Promise<DaytonaWorkspace> {
    return await this.request<DaytonaWorkspace>(`/workspaces/${id}/start`, {
      method: 'POST',
    });
  }

  /**
   * Stop a workspace
   */
  async stopWorkspace(id: string): Promise<DaytonaWorkspace> {
    return await this.request<DaytonaWorkspace>(`/workspaces/${id}/stop`, {
      method: 'POST',
    });
  }

  /**
   * Delete a workspace
   */
  async deleteWorkspace(id: string): Promise<void> {
    await this.request(`/workspaces/${id}`, {
      method: 'DELETE',
    });
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

    return {
      host: workspace.sshHost,
      port: workspace.sshPort || 22,
      user: workspace.sshUser || 'daytona',
      command: `ssh -p ${workspace.sshPort || 22} ${workspace.sshUser || 'daytona'}@${workspace.sshHost}`,
    };
  }

  /**
   * Convert Daytona workspace status to VmStatus
   */
  private workspaceStatusToVmStatus(status: DaytonaWorkspace['status']): VmStatus {
    switch (status) {
      case 'creating': return 'creating';
      case 'running': return 'running';
      case 'stopped': return 'stopped';
      case 'error': return 'error';
      case 'deleting': return 'stopped';
      default: return 'stopped';
    }
  }

  /**
   * Convert Daytona workspace to VmInfo format for UI compatibility
   */
  workspaceToVmInfo(workspace: DaytonaWorkspace): VmInfo {
    const status = this.workspaceStatusToVmStatus(workspace.status);
    return {
      id: `daytona-${workspace.id}`,
      name: workspace.name,
      status,
      state: status,
      hypervisor: 'daytona',
      sshHost: workspace.sshHost || '',
      sshPort: workspace.sshPort || 22,
      sshUser: workspace.sshUser || 'daytona',
      sshCommand: workspace.sshHost
        ? `ssh -p ${workspace.sshPort || 22} ${workspace.sshUser || 'daytona'}@${workspace.sshHost}`
        : undefined,
      guestIp: workspace.sshHost,
      networkMode: 'none', // Cloud workspaces don't use local networking
      ports: [],
      volumes: [],
      image: workspace.repository || 'daytona-workspace',
      vcpus: 2, // Default values for cloud workspaces
      memoryMb: 4096,
      diskGb: 20,
      createdAt: workspace.createdAt,
      startedAt: workspace.startedAt,
      error: workspace.error,
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
   * Create a new Daytona workspace (VM-like interface)
   */
  async createVm(request: {
    name: string;
    repository?: string;
    ide?: string;
  }): Promise<VmInfo> {
    const workspace = await this.createWorkspace({
      name: request.name,
      repository: request.repository,
      ide: request.ide,
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
