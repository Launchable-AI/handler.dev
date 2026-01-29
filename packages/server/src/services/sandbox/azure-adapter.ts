/**
 * Azure Sandbox Adapter
 *
 * Converts Azure VMs to the unified Sandbox abstraction.
 */

import type { SandboxAdapter } from './types.js';
import type {
  Sandbox,
  SandboxStatus,
  AzureMeta,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import {
  AzureService,
  type AzureInstance,
  type AzurePowerState,
  AZURE_SIZE_PRESETS,
  AZURE_SSH_KEY_PATH,
  type AzureSizeClass,
} from '../azure.js';

/**
 * Maps Azure power state to unified SandboxStatus
 */
function mapAzurePowerState(state: AzurePowerState): SandboxStatus {
  switch (state) {
    case 'PowerState/running':
      return 'running';
    case 'PowerState/starting':
      return 'starting';
    case 'PowerState/stopping':
    case 'PowerState/deallocating':
      return 'stopping';
    case 'PowerState/stopped':
    case 'PowerState/deallocated':
      return 'stopped';
    case 'PowerState/unknown':
    default:
      return 'stopped';
  }
}

/**
 * Converts an Azure instance to Sandbox
 */
function instanceToSandbox(instance: AzureInstance): Sandbox {
  const sizeClass = (instance.tags['caisson:sizeClass'] || 'small') as AzureSizeClass;
  const preset = AZURE_SIZE_PRESETS[sizeClass] || AZURE_SIZE_PRESETS.small;

  const meta: AzureMeta = {
    type: 'azure',
    vmId: instance.vmId,
    vmSize: instance.vmSize,
    resourceGroup: instance.resourceGroup,
    region: instance.location,
    publicIp: instance.publicIp,
    privateIp: instance.privateIp,
    provisioningState: instance.provisioningState,
    powerState: instance.powerState,
    subscriptionId: instance.subscriptionId,
  };

  return {
    id: `azure-${instance.vmName}`,
    name: instance.name,
    backend: 'azure',
    status: mapAzurePowerState(instance.powerState),
    error: undefined,

    // Resources (from size preset or defaults)
    vcpus: preset.vcpus,
    memoryMb: preset.memoryMb,
    diskGb: preset.diskGb,

    // Network - Azure VMs don't expose internal port mappings
    ports: [],
    guestIp: instance.publicIp || instance.privateIp,

    // Access - Azure uses SSH
    terminalType: 'ssh',
    sshHost: instance.publicIp,
    sshPort: 22,
    sshUser: 'azureuser',
    sshCommand: instance.publicIp
      ? `ssh -i ${AZURE_SSH_KEY_PATH} azureuser@${instance.publicIp}`
      : undefined,

    // Metadata
    image: `azure-${sizeClass} (${instance.vmSize})`,
    createdAt: new Date().toISOString(),
    startedAt: instance.powerState === 'PowerState/running' ? new Date().toISOString() : undefined,

    backendMeta: meta,
  };
}

export class AzureAdapter implements SandboxAdapter {
  readonly backend = 'azure' as const;

  constructor(private azure: AzureService) {}

  async isAvailable(): Promise<boolean> {
    return this.azure.isAvailable();
  }

  async list(): Promise<Sandbox[]> {
    try {
      const instances = await this.azure.listInstances();
      return instances.map((instance) => instanceToSandbox(instance));
    } catch (error) {
      console.error('[AzureAdapter] Failed to list instances:', error);
      return [];
    }
  }

  async get(id: string): Promise<Sandbox | null> {
    // Strip the 'azure-' prefix to get the VM name
    const vmName = id.startsWith('azure-') ? id.slice(6) : id;

    try {
      const instance = await this.azure.getInstance(vmName);
      if (!instance) return null;
      return instanceToSandbox(instance);
    } catch {
      return null;
    }
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    // Determine size class from resources or options
    let sizeClass: AzureSizeClass = 'small';

    if (request.azureOptions?.sizeClass) {
      sizeClass = request.azureOptions.sizeClass;
    } else if (request.vcpus && request.memoryMb) {
      // Infer size class from resources
      if (request.vcpus >= 4 || request.memoryMb >= 8192) {
        sizeClass = 'large';
      } else if (request.vcpus >= 2 || request.memoryMb >= 4096) {
        sizeClass = 'medium';
      }
    }

    const instance = await this.azure.createInstance({
      name: request.name,
      sizeClass,
      vmSize: request.azureOptions?.vmSize,
      resourceGroup: request.azureOptions?.resourceGroup,
    });

    return instanceToSandbox(instance);
  }

  async start(id: string): Promise<Sandbox> {
    const vmName = id.startsWith('azure-') ? id.slice(6) : id;
    const instance = await this.azure.startInstance(vmName);
    return instanceToSandbox(instance);
  }

  async stop(id: string): Promise<Sandbox> {
    const vmName = id.startsWith('azure-') ? id.slice(6) : id;
    const instance = await this.azure.stopInstance(vmName);
    return instanceToSandbox(instance);
  }

  async delete(id: string): Promise<void> {
    const vmName = id.startsWith('azure-') ? id.slice(6) : id;
    await this.azure.terminateInstance(vmName);
  }
}
