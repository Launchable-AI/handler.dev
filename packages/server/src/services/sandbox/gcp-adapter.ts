/**
 * GCP Sandbox Adapter
 *
 * Converts GCP Compute Engine instances to the unified Sandbox abstraction.
 */

import type { SandboxAdapter } from './types.js';
import type {
  Sandbox,
  SandboxStatus,
  GcpMeta,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import {
  GcpService,
  type GcpInstance,
  GCP_SIZE_PRESETS,
  GCP_SSH_KEY_PATH,
  type GcpSizeClass,
} from '../gcp.js';

/**
 * Maps GCP instance status to unified SandboxStatus
 */
function mapGcpStatus(status: string): SandboxStatus {
  switch (status) {
    case 'PROVISIONING':
    case 'STAGING':
      return 'creating';
    case 'RUNNING':
      return 'running';
    case 'STOPPING':
      return 'stopping';
    case 'TERMINATED':
    case 'STOPPED':
    case 'SUSPENDED':
      return 'stopped';
    default:
      return 'stopped';
  }
}

/**
 * Converts a GCP instance to Sandbox
 */
function instanceToSandbox(instance: GcpInstance, projectId: string): Sandbox {
  const sizeClass = (instance.labels['caisson-size-class'] || 'small') as GcpSizeClass;
  const preset = GCP_SIZE_PRESETS[sizeClass] || GCP_SIZE_PRESETS.small;

  const meta: GcpMeta = {
    type: 'gcp',
    instanceName: instance.instanceName,
    machineType: instance.machineType,
    zone: instance.zone,
    projectId,
    publicIp: instance.publicIp,
    privateIp: instance.privateIp,
    gcpStatus: instance.status,
    creationTimestamp: instance.creationTimestamp,
  };

  return {
    id: `gcp-${instance.instanceName}`,
    name: instance.name,
    backend: 'gcp',
    status: mapGcpStatus(instance.status),
    error: undefined,

    // Resources
    vcpus: preset.vcpus,
    memoryMb: preset.memoryMb,
    diskGb: preset.diskGb,

    // Network
    ports: [],
    guestIp: instance.publicIp || instance.privateIp,

    // Access
    terminalType: 'ssh',
    sshHost: instance.publicIp,
    sshPort: 22,
    sshUser: 'caisson',
    sshCommand: instance.publicIp
      ? `ssh -i ${GCP_SSH_KEY_PATH} caisson@${instance.publicIp}`
      : undefined,

    // Metadata
    image: `gcp-${sizeClass} (${instance.machineType})`,
    createdAt: instance.creationTimestamp || new Date().toISOString(),
    startedAt: instance.status === 'RUNNING' ? instance.creationTimestamp : undefined,

    backendMeta: meta,
  };
}

export class GcpAdapter implements SandboxAdapter {
  readonly backend = 'gcp' as const;

  constructor(private gcp: GcpService) {}

  async isAvailable(): Promise<boolean> {
    return this.gcp.isAvailable();
  }

  async list(): Promise<Sandbox[]> {
    try {
      const instances = await this.gcp.listInstances();
      const projectId = this.gcp.getProjectId();
      return instances.map((instance) => instanceToSandbox(instance, projectId));
    } catch (error) {
      console.error('[GcpAdapter] Failed to list instances:', error);
      return [];
    }
  }

  async get(id: string): Promise<Sandbox | null> {
    const instanceName = id.startsWith('gcp-') ? id.slice(4) : id;

    try {
      const instance = await this.gcp.getInstance(instanceName);
      if (!instance) return null;
      const projectId = this.gcp.getProjectId();
      return instanceToSandbox(instance, projectId);
    } catch {
      return null;
    }
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    let sizeClass: GcpSizeClass = 'small';

    if (request.gcpOptions?.sizeClass) {
      sizeClass = request.gcpOptions.sizeClass;
    } else if (request.vcpus && request.memoryMb) {
      if (request.vcpus >= 4 || request.memoryMb >= 8192) {
        sizeClass = 'large';
      } else if (request.vcpus >= 2 || request.memoryMb >= 4096) {
        sizeClass = 'medium';
      }
    }

    const instance = await this.gcp.createInstance({
      name: request.name,
      sizeClass,
      machineType: request.gcpOptions?.machineType,
      diskSizeGb: request.diskGb,
      zone: request.gcpOptions?.zone,
    });

    const projectId = this.gcp.getProjectId();
    return instanceToSandbox(instance, projectId);
  }

  async start(id: string): Promise<Sandbox> {
    const instanceName = id.startsWith('gcp-') ? id.slice(4) : id;
    const instance = await this.gcp.startInstance(instanceName);
    const projectId = this.gcp.getProjectId();
    return instanceToSandbox(instance, projectId);
  }

  async stop(id: string): Promise<Sandbox> {
    const instanceName = id.startsWith('gcp-') ? id.slice(4) : id;
    const instance = await this.gcp.stopInstance(instanceName);
    const projectId = this.gcp.getProjectId();
    return instanceToSandbox(instance, projectId);
  }

  async delete(id: string): Promise<void> {
    const instanceName = id.startsWith('gcp-') ? id.slice(4) : id;
    await this.gcp.deleteInstance(instanceName);
  }
}
