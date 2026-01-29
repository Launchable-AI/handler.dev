/**
 * DigitalOcean Sandbox Adapter
 *
 * Converts DigitalOcean Droplets to the unified Sandbox abstraction.
 */

import type { SandboxAdapter } from './types.js';
import type {
  Sandbox,
  SandboxStatus,
  DigitalOceanMeta,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import {
  DigitalOceanService,
  type DigitalOceanDroplet,
  type DigitalOceanSizeClass,
  DO_SIZE_PRESETS,
} from '../digitalocean.js';

/**
 * Maps DigitalOcean droplet status to unified SandboxStatus
 */
function mapDoStatus(status: string): SandboxStatus {
  switch (status) {
    case 'new':
      return 'creating';
    case 'active':
      return 'running';
    case 'off':
      return 'stopped';
    case 'archive':
      return 'stopped';
    default:
      return 'stopped';
  }
}

/**
 * Infer size class from size slug
 */
function inferSizeClass(sizeSlug: string): DigitalOceanSizeClass {
  for (const [key, preset] of Object.entries(DO_SIZE_PRESETS)) {
    if (preset.sizeSlug === sizeSlug) {
      return key as DigitalOceanSizeClass;
    }
  }
  return 'small';
}

/**
 * Converts a DigitalOcean droplet to Sandbox
 */
function dropletToSandbox(droplet: DigitalOceanDroplet, sshKeyPath: string): Sandbox {
  const sizeClass = inferSizeClass(droplet.sizeSlug);
  const preset = DO_SIZE_PRESETS[sizeClass] || DO_SIZE_PRESETS.small;

  const meta: DigitalOceanMeta = {
    type: 'digitalocean',
    dropletId: droplet.dropletId,
    sizeSlug: droplet.sizeSlug,
    region: droplet.region,
    publicIp: droplet.publicIp,
    privateIp: droplet.privateIp,
    doStatus: droplet.status,
  };

  return {
    id: `do-${droplet.dropletId}`,
    name: droplet.name,
    backend: 'digitalocean',
    status: mapDoStatus(droplet.status),
    error: undefined,

    // Resources
    vcpus: preset.vcpus,
    memoryMb: preset.memoryMb,
    diskGb: preset.diskGb,

    // Network
    ports: [],
    guestIp: droplet.publicIp || droplet.privateIp,

    // Access - DigitalOcean uses SSH as root
    terminalType: 'ssh',
    sshHost: droplet.publicIp,
    sshPort: 22,
    sshUser: 'root',
    sshCommand: droplet.publicIp
      ? `ssh -i ${sshKeyPath} root@${droplet.publicIp}`
      : undefined,

    // Metadata
    image: `digitalocean-${sizeClass} (${droplet.sizeSlug})`,
    createdAt: droplet.createdAt || new Date().toISOString(),
    startedAt: droplet.status === 'active' ? droplet.createdAt : undefined,

    backendMeta: meta,
  };
}

export class DigitalOceanAdapter implements SandboxAdapter {
  readonly backend = 'digitalocean' as const;

  constructor(private doService: DigitalOceanService) {}

  async isAvailable(): Promise<boolean> {
    return this.doService.isAvailable();
  }

  async list(): Promise<Sandbox[]> {
    try {
      const droplets = await this.doService.listDroplets();
      const sshKeyPath = this.doService.getSshKeyPath();
      return droplets.map((droplet) => dropletToSandbox(droplet, sshKeyPath));
    } catch (error) {
      console.error('[DigitalOceanAdapter] Failed to list droplets:', error);
      return [];
    }
  }

  async get(id: string): Promise<Sandbox | null> {
    // Strip the 'do-' prefix to get the droplet ID
    const dropletIdStr = id.startsWith('do-') ? id.slice(3) : id;
    const dropletId = parseInt(dropletIdStr, 10);

    if (isNaN(dropletId)) return null;

    try {
      const droplet = await this.doService.getDroplet(dropletId);
      if (!droplet) return null;
      const sshKeyPath = this.doService.getSshKeyPath();
      return dropletToSandbox(droplet, sshKeyPath);
    } catch {
      return null;
    }
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    // Determine size class from resources or options
    let sizeClass: DigitalOceanSizeClass = 'small';

    if (request.digitaloceanOptions?.sizeClass) {
      sizeClass = request.digitaloceanOptions.sizeClass;
    } else if (request.vcpus && request.memoryMb) {
      if (request.vcpus >= 4 || request.memoryMb >= 8192) {
        sizeClass = 'large';
      } else if (request.vcpus >= 2 || request.memoryMb >= 4096) {
        sizeClass = 'medium';
      }
    }

    const droplet = await this.doService.createDroplet({
      name: request.name,
      sizeClass,
      sizeSlug: request.digitaloceanOptions?.sizeSlug,
      region: request.digitaloceanOptions?.region,
    });

    const sshKeyPath = this.doService.getSshKeyPath();
    return dropletToSandbox(droplet, sshKeyPath);
  }

  async start(id: string): Promise<Sandbox> {
    const dropletIdStr = id.startsWith('do-') ? id.slice(3) : id;
    const dropletId = parseInt(dropletIdStr, 10);
    await this.doService.startDroplet(dropletId);
    const droplet = await this.doService.getDroplet(dropletId);
    if (!droplet) {
      throw new Error(`Droplet ${dropletId} not found after start`);
    }
    const sshKeyPath = this.doService.getSshKeyPath();
    return dropletToSandbox(droplet, sshKeyPath);
  }

  async stop(id: string): Promise<Sandbox> {
    const dropletIdStr = id.startsWith('do-') ? id.slice(3) : id;
    const dropletId = parseInt(dropletIdStr, 10);
    await this.doService.stopDroplet(dropletId);
    const droplet = await this.doService.getDroplet(dropletId);
    if (!droplet) {
      throw new Error(`Droplet ${dropletId} not found after stop`);
    }
    const sshKeyPath = this.doService.getSshKeyPath();
    return dropletToSandbox(droplet, sshKeyPath);
  }

  async delete(id: string): Promise<void> {
    const dropletIdStr = id.startsWith('do-') ? id.slice(3) : id;
    const dropletId = parseInt(dropletIdStr, 10);
    await this.doService.deleteDroplet(dropletId);
  }
}
