/**
 * DigitalOcean Backend Service
 *
 * Integrates with DigitalOcean Droplets as sandboxes via the REST API.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getConfig, setConfig } from './config.js';

// Path to store SSH keys
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const SSH_KEYS_DIR = join(PROJECT_ROOT, 'data', 'ssh-keys');
const DO_SSH_KEY_PATH = join(SSH_KEYS_DIR, 'digitalocean-key');
const DO_SSH_PUB_KEY_PATH = join(SSH_KEYS_DIR, 'digitalocean-key.pub');

const API_BASE = 'https://api.digitalocean.com/v2';
const DEFAULT_IMAGE = 'ubuntu-24-04-x64';

// Size class presets
export type DigitalOceanSizeClass = 'small' | 'medium' | 'large';

export const DO_SIZE_PRESETS: Record<DigitalOceanSizeClass, {
  sizeSlug: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
}> = {
  small: { sizeSlug: 's-1vcpu-1gb', vcpus: 1, memoryMb: 1024, diskGb: 25 },
  medium: { sizeSlug: 's-2vcpu-4gb', vcpus: 2, memoryMb: 4096, diskGb: 80 },
  large: { sizeSlug: 's-4vcpu-8gb', vcpus: 4, memoryMb: 8192, diskGb: 160 },
};

// Available regions
export const DO_REGIONS = [
  { id: 'nyc1', name: 'New York 1' },
  { id: 'nyc3', name: 'New York 3' },
  { id: 'sfo3', name: 'San Francisco 3' },
  { id: 'ams3', name: 'Amsterdam 3' },
  { id: 'sgp1', name: 'Singapore 1' },
  { id: 'lon1', name: 'London 1' },
  { id: 'fra1', name: 'Frankfurt 1' },
  { id: 'blr1', name: 'Bangalore 1' },
  { id: 'syd1', name: 'Sydney 1' },
  { id: 'tor1', name: 'Toronto 1' },
];

export interface DigitalOceanDroplet {
  dropletId: number;
  name: string;
  status: 'new' | 'active' | 'off' | 'archive';
  sizeSlug: string;
  region: string;
  publicIp?: string;
  privateIp?: string;
  tags: string[];
  createdAt: string;
}

// Cloud-init user data script for droplet bootstrap
const DEFAULT_USER_DATA = `#!/bin/bash
# Update and install essentials
apt-get update && apt-get install -y git curl vim

# Signal ready (create marker file)
touch /tmp/handler-ready
`;

export class DigitalOceanService {
  private apiToken: string = '';
  private region: string = 'nyc1';
  private initialized: boolean = false;

  // Cache for droplets
  private dropletsCache: DigitalOceanDroplet[] = [];
  private dropletsCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 15 * 1000; // 15 seconds

  /**
   * Make an authenticated API request to DigitalOcean
   */
  private async apiRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    return response;
  }

  /**
   * Initialize the DigitalOcean service with config
   */
  async initialize(): Promise<void> {
    const config = await getConfig();
    const doConfig = config.cloudBackends?.digitalocean;

    if (!doConfig?.apiToken) {
      throw new Error('DigitalOcean API token not configured');
    }

    this.apiToken = doConfig.apiToken;
    this.region = doConfig.region || 'nyc1';
    this.initialized = true;

    console.log('[DigitalOceanService] Initialized with region:', this.region);
  }

  /**
   * Check if the service is initialized and enabled
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await getConfig();
      const doConfig = config.cloudBackends?.digitalocean;
      return !!(doConfig?.apiToken && doConfig?.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Ensure initialized before making requests
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      await this.ensureInitialized();
      const response = await this.apiRequest('GET', '/account');

      if (!response.ok) {
        const errorData = await response.json() as { id?: string; message?: string };
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}`,
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
    return Date.now() - this.dropletsCacheTime < DigitalOceanService.CACHE_TTL_MS;
  }

  /**
   * Invalidate the droplet cache
   */
  invalidateCache(): void {
    this.dropletsCacheTime = 0;
    this.dropletsCache = [];
    console.log('[DigitalOceanService] Cache invalidated');
  }

  /**
   * Convert API droplet response to DigitalOceanDroplet
   */
  private apiDropletToDroplet(droplet: any): DigitalOceanDroplet {
    let publicIp: string | undefined;
    let privateIp: string | undefined;

    if (droplet.networks) {
      for (const net of droplet.networks.v4 || []) {
        if (net.type === 'public') {
          publicIp = net.ip_address;
        } else if (net.type === 'private') {
          privateIp = net.ip_address;
        }
      }
    }

    return {
      dropletId: droplet.id,
      name: droplet.name,
      status: droplet.status,
      sizeSlug: droplet.size_slug || droplet.size?.slug || '',
      region: droplet.region?.slug || '',
      publicIp,
      privateIp,
      tags: droplet.tags || [],
      createdAt: droplet.created_at,
    };
  }

  /**
   * List all Handler-managed droplets
   */
  async listDroplets(forceRefresh: boolean = false): Promise<DigitalOceanDroplet[]> {
    if (!forceRefresh && this.isCacheValid() && this.dropletsCache.length > 0) {
      console.log('[DigitalOceanService] Returning cached droplets');
      return this.dropletsCache;
    }

    try {
      await this.ensureInitialized();
      const response = await this.apiRequest('GET', '/droplets?tag_name=handler');

      if (!response.ok) {
        throw new Error(`Failed to list droplets: HTTP ${response.status}`);
      }

      const data = await response.json() as { droplets: any[] };
      const droplets = (data.droplets || []).map((d: any) => this.apiDropletToDroplet(d));

      this.dropletsCache = droplets;
      this.dropletsCacheTime = Date.now();
      console.log('[DigitalOceanService] Fetched fresh droplets:', droplets.length);
      return droplets;
    } catch (err) {
      console.error('[DigitalOceanService] Failed to list droplets:', err);
      if (this.dropletsCache.length > 0) {
        console.log('[DigitalOceanService] Returning stale cache on error');
        return this.dropletsCache;
      }
      return [];
    }
  }

  /**
   * Get a specific droplet
   */
  async getDroplet(dropletId: number): Promise<DigitalOceanDroplet | null> {
    try {
      await this.ensureInitialized();
      const response = await this.apiRequest('GET', `/droplets/${dropletId}`);

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { droplet: any };
      return this.apiDropletToDroplet(data.droplet);
    } catch {
      return null;
    }
  }

  /**
   * Create a new droplet
   */
  async createDroplet(request: {
    name: string;
    sizeClass?: DigitalOceanSizeClass;
    sizeSlug?: string;
    region?: string;
    image?: string;
    userData?: string;
  }): Promise<DigitalOceanDroplet> {
    await this.ensureInitialized();

    const sizeClass = request.sizeClass || 'small';
    const sizeSlug = request.sizeSlug || DO_SIZE_PRESETS[sizeClass].sizeSlug;
    const region = request.region || this.region;
    const image = request.image || DEFAULT_IMAGE;

    // Ensure SSH key exists in DO
    const sshKeyId = await this.ensureSshKey();

    const body: any = {
      name: request.name,
      region,
      size: sizeSlug,
      image,
      ssh_keys: [sshKeyId],
      tags: ['handler'],
      user_data: request.userData || DEFAULT_USER_DATA,
    };

    console.log('[DigitalOceanService] Creating droplet:', request.name);
    const response = await this.apiRequest('POST', '/droplets', body);

    if (!response.ok) {
      const errorData = await response.json() as { message?: string };
      throw new Error(`Failed to create droplet: ${errorData.message || `HTTP ${response.status}`}`);
    }

    const data = await response.json() as { droplet: any };
    this.invalidateCache();

    return this.apiDropletToDroplet(data.droplet);
  }

  /**
   * Start (power on) a droplet
   */
  async startDroplet(dropletId: number): Promise<void> {
    await this.ensureInitialized();
    const response = await this.apiRequest('POST', `/droplets/${dropletId}/actions`, {
      type: 'power_on',
    });

    if (!response.ok) {
      throw new Error(`Failed to start droplet: HTTP ${response.status}`);
    }

    console.log('[DigitalOceanService] Starting droplet:', dropletId);
    this.invalidateCache();
  }

  /**
   * Stop (shutdown) a droplet
   */
  async stopDroplet(dropletId: number): Promise<void> {
    await this.ensureInitialized();
    const response = await this.apiRequest('POST', `/droplets/${dropletId}/actions`, {
      type: 'shutdown',
    });

    if (!response.ok) {
      // If graceful shutdown fails, try power off
      const powerOffResponse = await this.apiRequest('POST', `/droplets/${dropletId}/actions`, {
        type: 'power_off',
      });
      if (!powerOffResponse.ok) {
        throw new Error(`Failed to stop droplet: HTTP ${powerOffResponse.status}`);
      }
    }

    console.log('[DigitalOceanService] Stopping droplet:', dropletId);
    this.invalidateCache();
  }

  /**
   * Delete a droplet
   */
  async deleteDroplet(dropletId: number): Promise<void> {
    await this.ensureInitialized();
    const response = await this.apiRequest('DELETE', `/droplets/${dropletId}`);

    if (!response.ok) {
      throw new Error(`Failed to delete droplet: HTTP ${response.status}`);
    }

    console.log('[DigitalOceanService] Deleted droplet:', dropletId);
    this.invalidateCache();
  }

  /**
   * Ensure SSH key exists in DigitalOcean and locally
   */
  async ensureSshKey(): Promise<number> {
    const config = await getConfig();
    const doConfig = config.cloudBackends?.digitalocean;

    // If we already have a key ID stored, verify it still exists in DO
    if (doConfig?.sshKeyId && existsSync(DO_SSH_KEY_PATH)) {
      try {
        const response = await this.apiRequest('GET', `/account/keys/${doConfig.sshKeyId}`);
        if (response.ok) {
          return doConfig.sshKeyId;
        }
      } catch {
        // Key no longer exists in DO, will recreate
      }
    }

    // Generate local keypair if not exists
    if (!existsSync(DO_SSH_KEY_PATH)) {
      console.log('[DigitalOceanService] Generating SSH keypair');
      await mkdir(SSH_KEYS_DIR, { recursive: true });
      execSync(
        `ssh-keygen -t ed25519 -f "${DO_SSH_KEY_PATH}" -N "" -C "handler-digitalocean"`,
        { stdio: 'pipe' },
      );
    }

    // Read the public key
    const publicKey = await readFile(DO_SSH_PUB_KEY_PATH, 'utf-8');

    // Upload to DigitalOcean
    const response = await this.apiRequest('POST', '/account/keys', {
      name: 'handler-key',
      public_key: publicKey.trim(),
    });

    if (!response.ok) {
      // Key might already exist with same fingerprint, try to find it
      const listResponse = await this.apiRequest('GET', '/account/keys?per_page=200');
      if (listResponse.ok) {
        const data = await listResponse.json() as { ssh_keys: any[] };
        for (const key of data.ssh_keys || []) {
          if (key.name === 'handler-key') {
            await this.saveSshKeyId(key.id);
            return key.id;
          }
        }
      }
      throw new Error('Failed to upload SSH key to DigitalOcean');
    }

    const data = await response.json() as { ssh_key: { id: number } };
    const keyId = data.ssh_key.id;

    await this.saveSshKeyId(keyId);
    console.log('[DigitalOceanService] SSH key uploaded with ID:', keyId);

    return keyId;
  }

  /**
   * Save SSH key ID to config
   */
  private async saveSshKeyId(keyId: number): Promise<void> {
    const config = await getConfig();
    const doConfig = config.cloudBackends?.digitalocean;

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        digitalocean: {
          ...doConfig!,
          sshKeyId: keyId,
          sshPrivateKey: undefined,
          sshPublicKey: undefined,
        },
      },
    });
  }

  /**
   * Get the SSH private key
   */
  async getSshPrivateKey(): Promise<string | null> {
    if (existsSync(DO_SSH_KEY_PATH)) {
      try {
        return await readFile(DO_SSH_KEY_PATH, 'utf-8');
      } catch {
        // Fall through
      }
    }

    // Fallback to config for backwards compatibility
    const config = await getConfig();
    const keyFromConfig = config.cloudBackends?.digitalocean?.sshPrivateKey;

    if (keyFromConfig && !existsSync(DO_SSH_KEY_PATH)) {
      try {
        await mkdir(SSH_KEYS_DIR, { recursive: true });
        await writeFile(DO_SSH_KEY_PATH, keyFromConfig, { mode: 0o600 });
        console.log('[DigitalOceanService] Migrated SSH key to file:', DO_SSH_KEY_PATH);
      } catch (err) {
        console.error('[DigitalOceanService] Failed to migrate SSH key to file:', err);
      }
    }

    return keyFromConfig || null;
  }

  /**
   * Get the path to the SSH private key file
   */
  getSshKeyPath(): string {
    return DO_SSH_KEY_PATH;
  }

  /**
   * Get the current region
   */
  getRegion(): string {
    return this.region;
  }
}

// Singleton instance
let digitalOceanService: DigitalOceanService | null = null;

export function getDigitalOceanService(): DigitalOceanService {
  if (!digitalOceanService) {
    digitalOceanService = new DigitalOceanService();
  }
  return digitalOceanService;
}

export async function initializeDigitalOceanService(): Promise<DigitalOceanService> {
  const service = getDigitalOceanService();
  await service.initialize();
  return service;
}
