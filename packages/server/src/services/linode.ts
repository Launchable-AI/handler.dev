/**
 * Linode Backend Service
 *
 * Integrates with Linode API v4 for cloud-based instances as sandboxes.
 * Uses REST API with Personal Access Token authentication.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { getConfig, setConfig } from './config.js';
import { PROJECT_ROOT } from '../lib/paths.js';

const SSH_KEYS_DIR = join(PROJECT_ROOT, 'data', 'ssh-keys');
const LINODE_SSH_KEY_NAME = 'linode-key';
export const LINODE_SSH_KEY_PATH = join(SSH_KEYS_DIR, LINODE_SSH_KEY_NAME);
export const LINODE_SSH_PUB_KEY_PATH = join(SSH_KEYS_DIR, `${LINODE_SSH_KEY_NAME}.pub`);

const API_BASE = 'https://api.linode.com/v4';

// Linode instance statuses
export type LinodeStatus =
  | 'running'
  | 'offline'
  | 'booting'
  | 'shutting_down'
  | 'provisioning'
  | 'rebooting';

// Size class presets
export type LinodeSizeClass = 'small' | 'medium' | 'large';

export const LINODE_SIZE_PRESETS: Record<LinodeSizeClass, {
  linodeType: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
}> = {
  small: { linodeType: 'g6-nanode-1', vcpus: 1, memoryMb: 1024, diskGb: 25 },
  medium: { linodeType: 'g6-standard-2', vcpus: 2, memoryMb: 4096, diskGb: 80 },
  large: { linodeType: 'g6-standard-4', vcpus: 4, memoryMb: 8192, diskGb: 160 },
};

// Default image
const DEFAULT_IMAGE = 'linode/ubuntu24.04';

// Available regions
export const LINODE_REGIONS = [
  { id: 'us-east', name: 'Newark, NJ' },
  { id: 'us-central', name: 'Dallas, TX' },
  { id: 'us-west', name: 'Fremont, CA' },
  { id: 'us-southeast', name: 'Atlanta, GA' },
  { id: 'eu-west', name: 'London, UK' },
  { id: 'eu-central', name: 'Frankfurt, DE' },
  { id: 'ap-south', name: 'Singapore' },
  { id: 'ap-northeast', name: 'Tokyo, JP' },
  { id: 'ap-southeast', name: 'Sydney, AU' },
  { id: 'ca-central', name: 'Toronto, CA' },
];

export interface LinodeInstance {
  linodeId: number;
  name: string;
  status: LinodeStatus;
  type: string;
  region: string;
  publicIp?: string;
  privateIp?: string;
  tags: string[];
  created: string;
}

export interface CreateLinodeInstanceRequest {
  name: string;
  sizeClass?: LinodeSizeClass;
  linodeType?: string;
  region?: string;
  image?: string;
  userData?: string;
}

// User data script for instance bootstrap
const DEFAULT_USER_DATA = `#!/bin/bash
# Update and install essentials
apt-get update && apt-get install -y git curl vim

# Signal ready (create marker file)
touch /tmp/handler-ready
`;

export class LinodeService {
  private apiToken: string = '';
  private region: string = 'us-east';
  private initialized: boolean = false;

  // Cache for instances
  private instancesCache: LinodeInstance[] = [];
  private instancesCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 15 * 1000; // 15 seconds

  /**
   * Initialize the Linode service with config
   */
  async initialize(): Promise<void> {
    const config = await getConfig();
    const linode = config.cloudBackends?.linode;

    if (!linode?.apiToken) {
      throw new Error('Linode API token not configured');
    }

    this.apiToken = linode.apiToken;
    this.region = linode.region || 'us-east';
    this.initialized = true;

    console.log('[LinodeService] Initialized with region:', this.region);
  }

  /**
   * Check if the service is initialized and enabled
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await getConfig();
      const linode = config.cloudBackends?.linode;
      return !!(linode?.apiToken && linode?.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Make an authenticated API request to Linode
   */
  private async apiRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    if (!this.initialized || !this.apiToken) {
      await this.initialize();
    }

    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }

    return fetch(url, options);
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const response = await this.apiRequest('GET', '/linode/instances?page_size=1');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: (errorData as { errors?: { reason: string }[] }).errors?.[0]?.reason || `HTTP ${response.status}`,
        };
      }
      return { success: true, message: 'Connection successful' };
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
    return Date.now() - this.instancesCacheTime < LinodeService.CACHE_TTL_MS;
  }

  /**
   * Invalidate the instance cache
   */
  invalidateCache(): void {
    this.instancesCacheTime = 0;
    this.instancesCache = [];
    console.log('[LinodeService] Cache invalidated');
  }

  /**
   * Convert Linode API response to LinodeInstance
   */
  private apiToLinodeInstance(data: Record<string, unknown>): LinodeInstance {
    const ipv4 = data.ipv4 as string[] | undefined;
    return {
      linodeId: data.id as number,
      name: (data.label as string) || '',
      status: (data.status as LinodeStatus) || 'offline',
      type: (data.type as string) || '',
      region: (data.region as string) || '',
      publicIp: ipv4?.[0],
      privateIp: ipv4?.[1],
      tags: (data.tags as string[]) || [],
      created: (data.created as string) || new Date().toISOString(),
    };
  }

  /**
   * List all Handler-managed instances
   */
  async listInstances(forceRefresh: boolean = false): Promise<LinodeInstance[]> {
    if (!forceRefresh && this.isCacheValid() && this.instancesCache.length > 0) {
      console.log('[LinodeService] Returning cached instances');
      return this.instancesCache;
    }

    try {
      const response = await this.apiRequest('GET', '/linode/instances');
      if (!response.ok) {
        throw new Error(`Failed to list instances: HTTP ${response.status}`);
      }

      const result = await response.json() as { data: Record<string, unknown>[] };
      const allInstances = result.data || [];

      // Filter by 'handler' tag
      const instances: LinodeInstance[] = allInstances
        .filter((inst) => {
          const tags = inst.tags as string[] | undefined;
          return tags?.includes('handler');
        })
        .map((inst) => this.apiToLinodeInstance(inst));

      this.instancesCache = instances;
      this.instancesCacheTime = Date.now();
      console.log('[LinodeService] Fetched fresh instances:', instances.length);
      return instances;
    } catch (err) {
      console.error('[LinodeService] Failed to list instances:', err);
      if (this.instancesCache.length > 0) {
        console.log('[LinodeService] Returning stale cache on error');
        return this.instancesCache;
      }
      return [];
    }
  }

  /**
   * Get a specific instance
   */
  async getInstance(linodeId: number): Promise<LinodeInstance | null> {
    try {
      const response = await this.apiRequest('GET', `/linode/instances/${linodeId}`);
      if (!response.ok) return null;
      const data = await response.json() as Record<string, unknown>;
      return this.apiToLinodeInstance(data);
    } catch {
      return null;
    }
  }

  /**
   * Create a new instance
   */
  async createInstance(request: CreateLinodeInstanceRequest): Promise<LinodeInstance> {
    const sizeClass = request.sizeClass || 'small';
    const linodeType = request.linodeType || LINODE_SIZE_PRESETS[sizeClass].linodeType;
    const region = request.region || this.region;
    const image = request.image || DEFAULT_IMAGE;

    // Ensure SSH key exists
    const authorizedKeys = await this.ensureSshKey();

    // Generate root password
    const rootPass = randomBytes(24).toString('base64url');

    // Store root password in config for reference
    const config = await getConfig();
    const linode = config.cloudBackends?.linode;
    if (linode) {
      await setConfig({
        cloudBackends: {
          ...config.cloudBackends,
          linode: {
            ...linode,
            rootPassword: rootPass,
          },
        },
      });
    }

    // Build request body
    const body: Record<string, unknown> = {
      label: request.name,
      type: linodeType,
      region,
      image,
      root_pass: rootPass,
      authorized_keys: [authorizedKeys],
      tags: ['handler'],
      booted: true,
    };

    // Add user data via cloud-init metadata if provided
    const userData = request.userData || DEFAULT_USER_DATA;
    body.metadata = {
      user_data: Buffer.from(userData).toString('base64'),
    };

    console.log('[LinodeService] Creating instance:', request.name);
    const response = await this.apiRequest('POST', '/linode/instances', body);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = (errorData as { errors?: { reason: string }[] }).errors?.[0]?.reason || `HTTP ${response.status}`;
      throw new Error(`Failed to create Linode instance: ${errorMsg}`);
    }

    const data = await response.json() as Record<string, unknown>;
    this.invalidateCache();
    return this.apiToLinodeInstance(data);
  }

  /**
   * Start (boot) a stopped instance
   */
  async startInstance(linodeId: number): Promise<LinodeInstance> {
    const response = await this.apiRequest('POST', `/linode/instances/${linodeId}/boot`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = (errorData as { errors?: { reason: string }[] }).errors?.[0]?.reason || `HTTP ${response.status}`;
      throw new Error(`Failed to boot instance: ${errorMsg}`);
    }

    console.log('[LinodeService] Booting instance:', linodeId);
    this.invalidateCache();

    // Poll for running state
    const instance = await this.getInstance(linodeId);
    if (!instance) {
      throw new Error(`Instance ${linodeId} not found after boot`);
    }
    return instance;
  }

  /**
   * Stop (shutdown) a running instance
   */
  async stopInstance(linodeId: number): Promise<LinodeInstance> {
    const response = await this.apiRequest('POST', `/linode/instances/${linodeId}/shutdown`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = (errorData as { errors?: { reason: string }[] }).errors?.[0]?.reason || `HTTP ${response.status}`;
      throw new Error(`Failed to shutdown instance: ${errorMsg}`);
    }

    console.log('[LinodeService] Shutting down instance:', linodeId);
    this.invalidateCache();

    const instance = await this.getInstance(linodeId);
    if (!instance) {
      throw new Error(`Instance ${linodeId} not found after shutdown`);
    }
    return instance;
  }

  /**
   * Delete an instance
   */
  async deleteInstance(linodeId: number): Promise<void> {
    const response = await this.apiRequest('DELETE', `/linode/instances/${linodeId}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = (errorData as { errors?: { reason: string }[] }).errors?.[0]?.reason || `HTTP ${response.status}`;
      throw new Error(`Failed to delete instance: ${errorMsg}`);
    }

    console.log('[LinodeService] Deleted instance:', linodeId);
    this.invalidateCache();
  }

  /**
   * Ensure SSH key pair exists, return public key string for authorized_keys
   */
  async ensureSshKey(): Promise<string> {
    // If key already exists, read and return the public key
    if (existsSync(LINODE_SSH_KEY_PATH) && existsSync(LINODE_SSH_PUB_KEY_PATH)) {
      const pubKey = await readFile(LINODE_SSH_PUB_KEY_PATH, 'utf-8');
      return pubKey.trim();
    }

    // Generate key pair using ssh-keygen
    await mkdir(SSH_KEYS_DIR, { recursive: true });

    // Remove any existing keys to avoid ssh-keygen prompt
    if (existsSync(LINODE_SSH_KEY_PATH)) {
      execSync(`rm -f "${LINODE_SSH_KEY_PATH}" "${LINODE_SSH_PUB_KEY_PATH}"`);
    }

    execSync(
      `ssh-keygen -t ed25519 -f "${LINODE_SSH_KEY_PATH}" -N "" -C "handler-linode"`,
      { stdio: 'pipe' },
    );

    // Set proper permissions
    execSync(`chmod 600 "${LINODE_SSH_KEY_PATH}"`);

    console.log('[LinodeService] Generated SSH key pair:', LINODE_SSH_KEY_PATH);

    const pubKey = await readFile(LINODE_SSH_PUB_KEY_PATH, 'utf-8');
    return pubKey.trim();
  }

  /**
   * Get the SSH private key contents
   */
  async getSshPrivateKey(): Promise<string | null> {
    if (existsSync(LINODE_SSH_KEY_PATH)) {
      try {
        return await readFile(LINODE_SSH_KEY_PATH, 'utf-8');
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Get the path to the SSH private key file
   */
  getSshKeyPath(): string {
    return LINODE_SSH_KEY_PATH;
  }

  /**
   * Get the current region
   */
  getRegion(): string {
    return this.region;
  }
}

// Singleton instance
let linodeService: LinodeService | null = null;

export function getLinodeService(): LinodeService {
  if (!linodeService) {
    linodeService = new LinodeService();
  }
  return linodeService;
}

export async function initializeLinodeService(): Promise<LinodeService> {
  const service = getLinodeService();
  await service.initialize();
  return service;
}
