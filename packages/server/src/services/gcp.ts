/**
 * GCP Compute Engine Backend Service
 *
 * Integrates with GCP Compute Engine for cloud-based instances as sandboxes.
 * Uses REST API calls with OAuth2 service account authentication (no SDK dependency).
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createSign, generateKeyPairSync } from 'crypto';
import { getConfig, setConfig } from './config.js';
import { PROJECT_ROOT } from '../lib/paths.js';

// Path to store SSH keys
const SSH_KEYS_DIR = join(PROJECT_ROOT, 'data', 'ssh-keys');
const GCP_SSH_KEY_PATH = join(SSH_KEYS_DIR, 'gcp-key');
const GCP_SSH_PUB_KEY_PATH = join(SSH_KEYS_DIR, 'gcp-key.pub');
export { GCP_SSH_KEY_PATH, GCP_SSH_PUB_KEY_PATH };

const API_BASE = 'https://compute.googleapis.com/compute/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_IMAGE = 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64';

// Size class presets
export type GcpSizeClass = 'small' | 'medium' | 'large';

export const GCP_SIZE_PRESETS: Record<GcpSizeClass, {
  machineType: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
}> = {
  small: { machineType: 'e2-micro', vcpus: 2, memoryMb: 1024, diskGb: 10 },
  medium: { machineType: 'e2-medium', vcpus: 2, memoryMb: 4096, diskGb: 20 },
  large: { machineType: 'e2-standard-2', vcpus: 2, memoryMb: 8192, diskGb: 30 },
};

// Available zones
export const GCP_ZONES = [
  { id: 'us-central1-a', name: 'Iowa (us-central1-a)' },
  { id: 'us-east1-b', name: 'South Carolina (us-east1-b)' },
  { id: 'us-west1-a', name: 'Oregon (us-west1-a)' },
  { id: 'europe-west1-b', name: 'Belgium (europe-west1-b)' },
  { id: 'europe-west2-a', name: 'London (europe-west2-a)' },
  { id: 'asia-east1-a', name: 'Taiwan (asia-east1-a)' },
  { id: 'asia-southeast1-a', name: 'Singapore (asia-southeast1-a)' },
  { id: 'australia-southeast1-a', name: 'Sydney (australia-southeast1-a)' },
];

export interface GcpInstance {
  instanceName: string;
  name: string;
  status: string;
  machineType: string;
  publicIp?: string;
  privateIp?: string;
  zone: string;
  creationTimestamp?: string;
  labels: Record<string, string>;
}

export interface CreateGcpInstanceRequest {
  name: string;
  sizeClass?: GcpSizeClass;
  machineType?: string;
  image?: string;
  diskSizeGb?: number;
  zone?: string;
  userData?: string;
}

// Default startup script
const DEFAULT_STARTUP_SCRIPT = `#!/bin/bash
# Update and install essentials
apt-get update && apt-get install -y git curl vim

# Signal ready
touch /tmp/handler-ready
`;

/**
 * Create a signed JWT for service account authentication
 */
function createJwt(serviceAccountEmail: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/compute',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const signInput = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = sign.sign(privateKey, 'base64url');

  return `${signInput}.${signature}`;
}

export class GcpService {
  private projectId: string = '';
  private zone: string = 'us-central1-a';
  private accessToken: string = '';
  private tokenExpiresAt: number = 0;
  private serviceAccountEmail: string = '';
  private privateKey: string = '';
  private initialized: boolean = false;

  // Cache for instances
  private instancesCache: GcpInstance[] = [];
  private instancesCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 15 * 1000; // 15 seconds

  /**
   * Initialize the GCP service with config
   */
  async initialize(): Promise<void> {
    const config = await getConfig();
    const gcp = config.cloudBackends?.gcp;

    if (!gcp?.keyFileJson || !gcp?.projectId) {
      throw new Error('GCP credentials not configured');
    }

    this.projectId = gcp.projectId;
    this.zone = gcp.zone || 'us-central1-a';

    // Parse service account key JSON
    let keyData: { client_email: string; private_key: string };
    try {
      keyData = JSON.parse(gcp.keyFileJson);
    } catch {
      throw new Error('Invalid service account key JSON');
    }

    if (!keyData.client_email || !keyData.private_key) {
      throw new Error('Service account key must contain client_email and private_key');
    }

    this.serviceAccountEmail = keyData.client_email;
    this.privateKey = keyData.private_key;
    this.initialized = true;

    console.log('[GcpService] Initialized with project:', this.projectId, 'zone:', this.zone);
  }

  /**
   * Check if the service is initialized and enabled
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await getConfig();
      const gcp = config.cloudBackends?.gcp;
      return !!(gcp?.keyFileJson && gcp?.projectId && gcp?.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Get a valid OAuth2 access token, refreshing if needed
   */
  private async getAccessToken(): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const jwt = createJwt(this.serviceAccountEmail, this.privateKey);

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get access token: ${response.status} ${text}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    return this.accessToken;
  }

  /**
   * Make an authenticated API request
   */
  private async apiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const token = await this.getAccessToken();
    const url = `${API_BASE}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json() as Record<string, unknown>;

    return { ok: response.ok, status: response.status, data };
  }

  /**
   * Wait for a zone operation to complete
   */
  private async waitForOperation(operationName: string, maxWaitMs: number = 300000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const result = await this.apiRequest(
        'GET',
        `/projects/${this.projectId}/zones/${this.zone}/operations/${operationName}`,
      );

      const status = result.data.status as string;
      if (status === 'DONE') {
        if (result.data.error) {
          const errors = (result.data.error as { errors?: Array<{ message: string }> }).errors;
          throw new Error(`Operation failed: ${errors?.[0]?.message || 'Unknown error'}`);
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Operation ${operationName} timed out`);
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const result = await this.apiRequest(
        'GET',
        `/projects/${this.projectId}/zones/${this.zone}/instances?maxResults=1`,
      );

      if (result.ok) {
        return { success: true, message: 'Connection successful' };
      }
      return { success: false, error: `API returned ${result.status}` };
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
    return Date.now() - this.instancesCacheTime < GcpService.CACHE_TTL_MS;
  }

  /**
   * Invalidate the instance cache
   */
  invalidateCache(): void {
    this.instancesCacheTime = 0;
    this.instancesCache = [];
    console.log('[GcpService] Cache invalidated');
  }

  /**
   * Parse a GCE instance resource into GcpInstance
   */
  private parseInstance(instance: Record<string, unknown>): GcpInstance {
    const labels = (instance.labels as Record<string, string>) || {};
    const networkInterfaces = instance.networkInterfaces as Array<{
      networkIP?: string;
      accessConfigs?: Array<{ natIP?: string }>;
    }> | undefined;

    let publicIp: string | undefined;
    let privateIp: string | undefined;
    if (networkInterfaces?.[0]) {
      privateIp = networkInterfaces[0].networkIP;
      publicIp = networkInterfaces[0].accessConfigs?.[0]?.natIP;
    }

    // Extract machine type short name from full URL
    const machineTypeUrl = instance.machineType as string || '';
    const machineType = machineTypeUrl.split('/').pop() || machineTypeUrl;

    // Extract zone short name from full URL
    const zoneUrl = instance.zone as string || '';
    const zone = zoneUrl.split('/').pop() || zoneUrl;

    return {
      instanceName: instance.name as string || '',
      name: labels['handler-name'] || instance.name as string || '',
      status: instance.status as string || 'UNKNOWN',
      machineType,
      publicIp,
      privateIp,
      zone,
      creationTimestamp: instance.creationTimestamp as string | undefined,
      labels,
    };
  }

  /**
   * List all Handler-managed instances
   */
  async listInstances(forceRefresh: boolean = false): Promise<GcpInstance[]> {
    if (!forceRefresh && this.isCacheValid() && this.instancesCache.length > 0) {
      console.log('[GcpService] Returning cached instances');
      return this.instancesCache;
    }

    try {
      const filter = encodeURIComponent('labels.handler=true');
      const result = await this.apiRequest(
        'GET',
        `/projects/${this.projectId}/zones/${this.zone}/instances?filter=${filter}`,
      );

      if (!result.ok) {
        console.error('[GcpService] Failed to list instances:', result.data);
        return this.instancesCache.length > 0 ? this.instancesCache : [];
      }

      const items = (result.data.items as Array<Record<string, unknown>>) || [];
      const instances = items.map((item) => this.parseInstance(item));

      this.instancesCache = instances;
      this.instancesCacheTime = Date.now();
      console.log('[GcpService] Fetched fresh instances:', instances.length);
      return instances;
    } catch (err) {
      console.error('[GcpService] Failed to list instances:', err);
      if (this.instancesCache.length > 0) {
        console.log('[GcpService] Returning stale cache on error');
        return this.instancesCache;
      }
      return [];
    }
  }

  /**
   * Get a specific instance
   */
  async getInstance(instanceName: string): Promise<GcpInstance | null> {
    try {
      const result = await this.apiRequest(
        'GET',
        `/projects/${this.projectId}/zones/${this.zone}/instances/${instanceName}`,
      );

      if (!result.ok) return null;
      return this.parseInstance(result.data);
    } catch {
      return null;
    }
  }

  /**
   * Ensure SSH key pair exists for GCP instances
   */
  async ensureSshKeyPair(): Promise<{ publicKey: string }> {
    // If keys already exist, read and return
    if (existsSync(GCP_SSH_KEY_PATH) && existsSync(GCP_SSH_PUB_KEY_PATH)) {
      const publicKey = await readFile(GCP_SSH_PUB_KEY_PATH, 'utf-8');
      return { publicKey: publicKey.trim() };
    }

    // Generate ed25519 key pair
    console.log('[GcpService] Generating SSH key pair');
    await mkdir(SSH_KEYS_DIR, { recursive: true });

    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Convert PEM public key to OpenSSH format
    // Extract the raw key bytes from the PEM SPKI format
    const pubPemBody = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    const pubDer = Buffer.from(pubPemBody, 'base64');
    // Ed25519 SPKI DER has a 12-byte header, raw key is the last 32 bytes
    const rawPubKey = pubDer.subarray(pubDer.length - 32);

    // Build OpenSSH format: string "ssh-ed25519" + string <32 bytes>
    const keyType = Buffer.from('ssh-ed25519');
    const keyTypeLen = Buffer.alloc(4);
    keyTypeLen.writeUInt32BE(keyType.length);
    const keyDataLen = Buffer.alloc(4);
    keyDataLen.writeUInt32BE(rawPubKey.length);
    const sshPubKeyBlob = Buffer.concat([keyTypeLen, keyType, keyDataLen, rawPubKey]);
    const sshPubKey = `ssh-ed25519 ${sshPubKeyBlob.toString('base64')} handler`;

    // Write private key in OpenSSH PEM format
    await writeFile(GCP_SSH_KEY_PATH, privateKey, { mode: 0o600 });
    await writeFile(GCP_SSH_PUB_KEY_PATH, sshPubKey + '\n', { mode: 0o644 });

    console.log('[GcpService] SSH key pair saved to:', GCP_SSH_KEY_PATH);
    return { publicKey: sshPubKey };
  }

  /**
   * Create a new instance
   */
  async createInstance(request: CreateGcpInstanceRequest): Promise<GcpInstance> {
    const sizeClass = request.sizeClass || 'small';
    const preset = GCP_SIZE_PRESETS[sizeClass];
    const machineType = request.machineType || preset.machineType;
    const diskSizeGb = request.diskSizeGb || preset.diskGb;
    const zone = request.zone || this.zone;
    const image = request.image || DEFAULT_IMAGE;

    // Ensure SSH key exists
    const { publicKey } = await this.ensureSshKeyPair();

    // Sanitize name for GCE (lowercase, hyphens, max 63 chars)
    const instanceName = request.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63);

    const body: Record<string, unknown> = {
      name: instanceName,
      machineType: `zones/${zone}/machineTypes/${machineType}`,
      labels: {
        'handler': 'true',
        'handler-name': request.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 63),
        'handler-size-class': sizeClass,
      },
      disks: [
        {
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceImage: image,
            diskSizeGb: diskSizeGb,
            diskType: `zones/${zone}/diskTypes/pd-standard`,
          },
        },
      ],
      networkInterfaces: [
        {
          network: 'global/networks/default',
          accessConfigs: [
            {
              name: 'External NAT',
              type: 'ONE_TO_ONE_NAT',
            },
          ],
        },
      ],
      metadata: {
        items: [
          {
            key: 'ssh-keys',
            value: `handler:${publicKey}`,
          },
          {
            key: 'startup-script',
            value: request.userData || DEFAULT_STARTUP_SCRIPT,
          },
        ],
      },
      tags: {
        items: ['handler', 'ssh-server'],
      },
    };

    console.log('[GcpService] Creating instance:', instanceName);
    const result = await this.apiRequest(
      'POST',
      `/projects/${this.projectId}/zones/${zone}/instances`,
      body,
    );

    if (!result.ok) {
      const errorMsg = (result.data.error as { message?: string })?.message || JSON.stringify(result.data);
      throw new Error(`Failed to create instance: ${errorMsg}`);
    }

    // Wait for the operation to complete
    const operationName = result.data.name as string;
    await this.waitForOperation(operationName);

    this.invalidateCache();

    // Fetch and return the created instance
    const instance = await this.getInstance(instanceName);
    if (!instance) {
      throw new Error(`Instance ${instanceName} not found after creation`);
    }
    return instance;
  }

  /**
   * Start a stopped instance
   */
  async startInstance(instanceName: string): Promise<GcpInstance> {
    const result = await this.apiRequest(
      'POST',
      `/projects/${this.projectId}/zones/${this.zone}/instances/${instanceName}/start`,
    );

    if (!result.ok) {
      throw new Error(`Failed to start instance: ${JSON.stringify(result.data)}`);
    }

    const operationName = result.data.name as string;
    await this.waitForOperation(operationName);

    this.invalidateCache();
    const instance = await this.getInstance(instanceName);
    if (!instance) {
      throw new Error(`Instance ${instanceName} not found after start`);
    }
    return instance;
  }

  /**
   * Stop a running instance
   */
  async stopInstance(instanceName: string): Promise<GcpInstance> {
    const result = await this.apiRequest(
      'POST',
      `/projects/${this.projectId}/zones/${this.zone}/instances/${instanceName}/stop`,
    );

    if (!result.ok) {
      throw new Error(`Failed to stop instance: ${JSON.stringify(result.data)}`);
    }

    const operationName = result.data.name as string;
    await this.waitForOperation(operationName);

    this.invalidateCache();
    const instance = await this.getInstance(instanceName);
    if (!instance) {
      throw new Error(`Instance ${instanceName} not found after stop`);
    }
    return instance;
  }

  /**
   * Delete an instance
   */
  async deleteInstance(instanceName: string): Promise<void> {
    const result = await this.apiRequest(
      'DELETE',
      `/projects/${this.projectId}/zones/${this.zone}/instances/${instanceName}`,
    );

    if (!result.ok) {
      throw new Error(`Failed to delete instance: ${JSON.stringify(result.data)}`);
    }

    const operationName = result.data.name as string;
    await this.waitForOperation(operationName);

    console.log('[GcpService] Deleted instance:', instanceName);
    this.invalidateCache();
  }

  /**
   * Get SSH private key
   */
  async getSshPrivateKey(): Promise<string | null> {
    if (existsSync(GCP_SSH_KEY_PATH)) {
      try {
        return await readFile(GCP_SSH_KEY_PATH, 'utf-8');
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
    return GCP_SSH_KEY_PATH;
  }

  /**
   * Get the current zone
   */
  getZone(): string {
    return this.zone;
  }

  /**
   * Get the current project ID
   */
  getProjectId(): string {
    return this.projectId;
  }
}

// Singleton instance
let gcpService: GcpService | null = null;

export function getGcpService(): GcpService {
  if (!gcpService) {
    gcpService = new GcpService();
  }
  return gcpService;
}

export async function initializeGcpService(): Promise<GcpService> {
  const service = getGcpService();
  await service.initialize();
  return service;
}
