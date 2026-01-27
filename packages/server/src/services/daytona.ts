/**
 * Daytona Cloud Backend Service
 *
 * Integrates with Daytona.io API for cloud-based development workspaces.
 * Implements workspace management similar to local hypervisor VM management.
 */

import { getConfig } from './config.js';
import type { VmInfo, VmStatus } from '../types/vm.js';
import { execSync } from 'child_process';

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

export type DaytonaSizeClass = 'small' | 'medium' | 'large';

// Size class resource configurations
export const DAYTONA_SIZE_PRESETS: Record<DaytonaSizeClass, { cpu: number; memory: number; disk: number }> = {
  small: { cpu: 1, memory: 1, disk: 3 },   // 1 vCPU, 1 GB RAM, 3 GB disk
  medium: { cpu: 2, memory: 4, disk: 8 },  // 2 vCPU, 4 GB RAM, 8 GB disk
  large: { cpu: 4, memory: 8, disk: 10 },  // 4 vCPU, 8 GB RAM, 10 GB disk
};

// Volume types
export type DaytonaVolumeState = 'creating' | 'ready' | 'deleting' | 'error';

export interface DaytonaVolume {
  id: string;
  organizationId: string;
  name: string;
  state: DaytonaVolumeState;
  createdAt: string;
  updatedAt: string;
}

export interface DaytonaVolumeMount {
  volumeId: string;
  mountPath: string;
  subpath?: string;
}

// Snapshot types
export type DaytonaSnapshotState =
  | 'building'
  | 'pending'
  | 'pulling'
  | 'active'
  | 'inactive'
  | 'error'
  | 'build_failed'
  | 'removing';

export interface DaytonaSnapshot {
  id: string;
  organizationId?: string;
  general: boolean;
  name: string;
  imageName?: string;
  state: DaytonaSnapshotState;
  size: number | null;
  entrypoint: string[] | null;
  cpu: number;
  gpu: number;
  mem: number;
  disk: number;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  regionIds?: string[];
  ref?: string;
}

export interface DaytonaPaginatedSnapshots {
  items: DaytonaSnapshot[];
  total: number;
}

export interface CreateDaytonaSnapshotRequest {
  name: string;
  imageName?: string;
  entrypoint?: string[];
  cpu?: number;
  gpu?: number;
  memory?: number;
  disk?: number;
  regionId?: string;
}

export interface DaytonaRegistryPushAccess {
  username: string;
  secret: string;
  registryUrl: string;
  registryId: string;
  project: string;
  expiresAt: string;
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
  sizeClass?: DaytonaSizeClass;
  autoStopInterval?: number;
  ephemeral?: boolean;
  labels?: Record<string, string>;
  volumes?: DaytonaVolumeMount[];
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
    // If sizeClass is provided, use it to set resources (unless explicit resources are given)
    const resources = request.resources ?? (
      request.sizeClass ? DAYTONA_SIZE_PRESETS[request.sizeClass] : undefined
    );

    const payload = {
      name: request.name,
      language: request.language,
      snapshot: request.snapshot,
      resources,
      autoStopInterval: request.autoStopInterval,
      ephemeral: request.ephemeral,
      labels: request.labels,
      volumes: request.volumes,
    };

    console.log('[DaytonaService] Creating sandbox with payload:', JSON.stringify(payload));

    const workspace = await this.request<DaytonaWorkspace>('/sandbox', {
      method: 'POST',
      body: JSON.stringify(payload),
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
    sizeClass?: DaytonaSizeClass;
    autoStopInterval?: number;
    volumes?: DaytonaVolumeMount[];
  }): Promise<VmInfo> {
    const workspace = await this.createWorkspace({
      name: request.name,
      language: request.language || 'python',
      sizeClass: request.sizeClass || 'small',
      autoStopInterval: request.autoStopInterval ?? 15, // 15 min default
      volumes: request.volumes,
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

  // ==================== Volume Management ====================

  /**
   * List all Daytona volumes
   */
  async listVolumes(): Promise<DaytonaVolume[]> {
    try {
      const volumes = await this.request<DaytonaVolume[]>('/volume');
      return volumes || [];
    } catch (err) {
      console.error('[DaytonaService] Failed to list volumes:', err);
      return [];
    }
  }

  /**
   * Get a specific volume by ID
   */
  async getVolume(id: string): Promise<DaytonaVolume | null> {
    try {
      return await this.request<DaytonaVolume>(`/volume/${id}`);
    } catch {
      return null;
    }
  }

  /**
   * Get a volume by name (or create if not exists)
   */
  async getVolumeByName(name: string, create: boolean = false): Promise<DaytonaVolume | null> {
    try {
      // First try to find the volume by name in the list
      const volumes = await this.listVolumes();
      const existing = volumes.find(v => v.name === name);
      if (existing) {
        return existing;
      }

      // If not found and create is true, create it
      if (create) {
        return await this.createVolume(name);
      }

      return null;
    } catch (err) {
      console.error('[DaytonaService] Failed to get volume by name:', err);
      return null;
    }
  }

  /**
   * Create a new volume
   */
  async createVolume(name: string): Promise<DaytonaVolume> {
    const volume = await this.request<DaytonaVolume>('/volume', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    console.log('[DaytonaService] Created volume:', volume.name);
    return volume;
  }

  /**
   * Delete a volume
   */
  async deleteVolume(id: string): Promise<void> {
    await this.request(`/volume/${id}`, {
      method: 'DELETE',
    });
    console.log('[DaytonaService] Deleted volume:', id);
  }

  // ==================== Snapshot Management ====================

  /**
   * List all snapshots with pagination
   */
  async listSnapshots(options?: {
    page?: number;
    limit?: number;
    name?: string;
    sort?: 'name' | 'state' | 'lastUsedAt' | 'createdAt';
    order?: 'asc' | 'desc';
  }): Promise<DaytonaPaginatedSnapshots> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.name) params.set('name', options.name);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.order) params.set('order', options.order);

    const queryString = params.toString();
    const path = queryString ? `/snapshots?${queryString}` : '/snapshots';

    try {
      return await this.request<DaytonaPaginatedSnapshots>(path);
    } catch (err) {
      console.error('[DaytonaService] Failed to list snapshots:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Get a snapshot by ID or name
   */
  async getSnapshot(idOrName: string): Promise<DaytonaSnapshot | null> {
    try {
      return await this.request<DaytonaSnapshot>(`/snapshots/${encodeURIComponent(idOrName)}`);
    } catch {
      return null;
    }
  }

  /**
   * Create a snapshot from a public/private registry image
   */
  async createSnapshot(request: CreateDaytonaSnapshotRequest): Promise<DaytonaSnapshot> {
    const payload = {
      name: request.name,
      imageName: request.imageName,
      entrypoint: request.entrypoint,
      cpu: request.cpu,
      gpu: request.gpu,
      memory: request.memory,
      disk: request.disk,
      regionId: request.regionId,
    };

    console.log('[DaytonaService] Creating snapshot:', JSON.stringify(payload));
    return await this.request<DaytonaSnapshot>('/snapshots', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(id: string): Promise<void> {
    await this.request(`/snapshots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    console.log('[DaytonaService] Deleted snapshot:', id);
  }

  /**
   * Activate an inactive snapshot
   */
  async activateSnapshot(id: string): Promise<DaytonaSnapshot> {
    return await this.request<DaytonaSnapshot>(`/snapshots/${encodeURIComponent(id)}/activate`, {
      method: 'POST',
    });
  }

  /**
   * Deactivate an active snapshot
   */
  async deactivateSnapshot(id: string): Promise<void> {
    await this.request(`/snapshots/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
    });
  }

  /**
   * Get snapshot build logs URL
   */
  async getSnapshotBuildLogsUrl(id: string): Promise<string | null> {
    try {
      const result = await this.request<{ url: string }>(`/snapshots/${encodeURIComponent(id)}/build-logs-url`);
      return result.url;
    } catch {
      return null;
    }
  }

  // ==================== Local Image Push ====================

  /**
   * Get temporary registry access for pushing local images
   */
  async getRegistryPushAccess(regionId?: string): Promise<DaytonaRegistryPushAccess> {
    const params = regionId ? `?regionId=${encodeURIComponent(regionId)}` : '';
    return await this.request<DaytonaRegistryPushAccess>(`/docker-registry/transient-push-access${params}`);
  }

  /**
   * Push a local Docker image to Daytona and create a snapshot
   *
   * This method:
   * 1. Gets temporary registry credentials from Daytona
   * 2. Logs into the registry with Docker
   * 3. Tags and pushes the local image
   * 4. Creates a snapshot from the pushed image
   *
   * @param localImage - Local Docker image (e.g., "my-image:1.0")
   * @param snapshotName - Name for the snapshot in Daytona
   * @param options - Optional resources and region
   */
  async pushLocalImage(
    localImage: string,
    snapshotName: string,
    options?: {
      cpu?: number;
      memory?: number;
      disk?: number;
      entrypoint?: string[];
      regionId?: string;
    }
  ): Promise<DaytonaSnapshot> {
    console.log(`[DaytonaService] Pushing local image ${localImage} as snapshot ${snapshotName}`);

    // Step 1: Get temporary registry access
    const access = await this.getRegistryPushAccess(options?.regionId);
    console.log(`[DaytonaService] Got registry access: ${access.registryUrl}/${access.project}`);

    // Step 2: Login to registry
    try {
      execSync(
        `echo "${access.secret}" | docker login ${access.registryUrl} -u ${access.username} --password-stdin`,
        { stdio: 'pipe' }
      );
      console.log('[DaytonaService] Docker login successful');
    } catch (err) {
      throw new Error(`Failed to login to Daytona registry: ${err}`);
    }

    // Step 3: Tag and push the image
    // Extract tag from local image or use 'latest'
    const [imageName, imageTag = 'latest'] = localImage.split(':');
    const remoteImage = `${access.registryUrl}/${access.project}/${snapshotName}:${imageTag}`;

    try {
      console.log(`[DaytonaService] Tagging ${localImage} as ${remoteImage}`);
      execSync(`docker tag ${localImage} ${remoteImage}`, { stdio: 'pipe' });

      console.log(`[DaytonaService] Pushing ${remoteImage}`);
      execSync(`docker push ${remoteImage}`, { stdio: 'inherit' });
    } catch (err) {
      throw new Error(`Failed to push image to Daytona registry: ${err}`);
    } finally {
      // Logout from registry
      try {
        execSync(`docker logout ${access.registryUrl}`, { stdio: 'pipe' });
      } catch {
        // Ignore logout errors
      }
    }

    // Step 4: Create the snapshot
    const snapshot = await this.createSnapshot({
      name: snapshotName,
      imageName: remoteImage,
      cpu: options?.cpu,
      memory: options?.memory,
      disk: options?.disk,
      entrypoint: options?.entrypoint,
      regionId: options?.regionId,
    });

    console.log(`[DaytonaService] Snapshot created: ${snapshot.id} (${snapshot.state})`);
    return snapshot;
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
