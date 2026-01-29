/**
 * Linode Sandbox Adapter
 *
 * Converts Linode instances to the unified Sandbox abstraction.
 */

import type { SandboxAdapter } from './types.js';
import type {
  Sandbox,
  SandboxStatus,
  LinodeMeta,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import {
  LinodeService,
  type LinodeInstance,
  type LinodeStatus,
  LINODE_SIZE_PRESETS,
  LINODE_SSH_KEY_PATH,
  type LinodeSizeClass,
} from '../linode.js';

/**
 * Maps Linode instance status to unified SandboxStatus
 */
function mapLinodeStatus(status: LinodeStatus): SandboxStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'offline':
      return 'stopped';
    case 'booting':
      return 'starting';
    case 'shutting_down':
      return 'stopping';
    case 'provisioning':
      return 'creating';
    case 'rebooting':
      return 'starting';
    default:
      return 'stopped';
  }
}

/**
 * Converts a Linode instance to Sandbox
 */
function instanceToSandbox(instance: LinodeInstance, region: string): Sandbox {
  // Determine size class from linode type
  let sizeClass: LinodeSizeClass = 'small';
  for (const [key, preset] of Object.entries(LINODE_SIZE_PRESETS)) {
    if (preset.linodeType === instance.type) {
      sizeClass = key as LinodeSizeClass;
      break;
    }
  }
  const preset = LINODE_SIZE_PRESETS[sizeClass] || LINODE_SIZE_PRESETS.small;

  const meta: LinodeMeta = {
    type: 'linode',
    linodeId: instance.linodeId,
    linodeType: instance.type,
    region: instance.region,
    publicIp: instance.publicIp,
    privateIp: instance.privateIp,
    linodeStatus: instance.status,
  };

  return {
    id: `linode-${instance.linodeId}`,
    name: instance.name,
    backend: 'linode',
    status: mapLinodeStatus(instance.status),
    error: undefined,

    // Resources
    vcpus: preset.vcpus,
    memoryMb: preset.memoryMb,
    diskGb: preset.diskGb,

    // Network
    ports: [],
    guestIp: instance.publicIp || instance.privateIp,

    // Access - Linode uses SSH as root
    terminalType: 'ssh',
    sshHost: instance.publicIp,
    sshPort: 22,
    sshUser: 'root',
    sshCommand: instance.publicIp
      ? `ssh -i ${LINODE_SSH_KEY_PATH} root@${instance.publicIp}`
      : undefined,

    // Metadata
    image: `linode-${sizeClass} (${instance.type})`,
    createdAt: instance.created || new Date().toISOString(),
    startedAt: instance.status === 'running' ? instance.created : undefined,

    backendMeta: meta,
  };
}

export class LinodeAdapter implements SandboxAdapter {
  readonly backend = 'linode' as const;

  constructor(private linode: LinodeService) {}

  async isAvailable(): Promise<boolean> {
    return this.linode.isAvailable();
  }

  async list(): Promise<Sandbox[]> {
    try {
      const instances = await this.linode.listInstances();
      const region = this.linode.getRegion();
      return instances.map((instance) => instanceToSandbox(instance, region));
    } catch (error) {
      console.error('[LinodeAdapter] Failed to list instances:', error);
      return [];
    }
  }

  async get(id: string): Promise<Sandbox | null> {
    // Strip the 'linode-' prefix to get the linode ID
    const linodeIdStr = id.startsWith('linode-') ? id.slice(7) : id;
    const linodeId = parseInt(linodeIdStr, 10);

    if (isNaN(linodeId)) return null;

    try {
      const instance = await this.linode.getInstance(linodeId);
      if (!instance) return null;
      const region = this.linode.getRegion();
      return instanceToSandbox(instance, region);
    } catch {
      return null;
    }
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    let sizeClass: LinodeSizeClass = 'small';

    if (request.linodeOptions?.sizeClass) {
      sizeClass = request.linodeOptions.sizeClass as LinodeSizeClass;
    } else if (request.vcpus && request.memoryMb) {
      if (request.vcpus >= 4 || request.memoryMb >= 8192) {
        sizeClass = 'large';
      } else if (request.vcpus >= 2 || request.memoryMb >= 4096) {
        sizeClass = 'medium';
      }
    }

    const instance = await this.linode.createInstance({
      name: request.name,
      sizeClass,
      linodeType: request.linodeOptions?.linodeType,
      region: request.linodeOptions?.region,
    });

    const region = this.linode.getRegion();
    return instanceToSandbox(instance, region);
  }

  async start(id: string): Promise<Sandbox> {
    const linodeIdStr = id.startsWith('linode-') ? id.slice(7) : id;
    const linodeId = parseInt(linodeIdStr, 10);
    const instance = await this.linode.startInstance(linodeId);
    const region = this.linode.getRegion();
    return instanceToSandbox(instance, region);
  }

  async stop(id: string): Promise<Sandbox> {
    const linodeIdStr = id.startsWith('linode-') ? id.slice(7) : id;
    const linodeId = parseInt(linodeIdStr, 10);
    const instance = await this.linode.stopInstance(linodeId);
    const region = this.linode.getRegion();
    return instanceToSandbox(instance, region);
  }

  async delete(id: string): Promise<void> {
    const linodeIdStr = id.startsWith('linode-') ? id.slice(7) : id;
    const linodeId = parseInt(linodeIdStr, 10);
    await this.linode.deleteInstance(linodeId);
  }
}
