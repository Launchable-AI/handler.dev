/**
 * VM Sandbox Adapter
 *
 * Converts Cloud-Hypervisor and Firecracker VMs to the unified Sandbox abstraction.
 */

import type { SandboxAdapter } from './types.js';
import type {
  Sandbox,
  SandboxBackend,
  SandboxStatus,
  VmMeta,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import type { VmInfo, VmStatus, HypervisorType } from '../../types/vm.js';
import { CloudHypervisorService } from '../hypervisor.js';
import { FirecrackerService } from '../firecracker.js';

/**
 * Maps VM status to unified SandboxStatus
 */
function mapVmStatus(status: VmStatus): SandboxStatus {
  switch (status) {
    case 'creating':
      return 'creating';
    case 'booting':
      return 'starting';
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'stopped':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return 'stopped';
  }
}

/**
 * Generates a sandbox ID prefix based on hypervisor type
 */
function getIdPrefix(hypervisor: HypervisorType): string {
  switch (hypervisor) {
    case 'firecracker':
      return 'fc';
    case 'cloud-hypervisor':
    default:
      return 'vm';
  }
}

/**
 * Converts a VmInfo to Sandbox
 */
function vmToSandbox(vm: VmInfo, hypervisorType: HypervisorType): Sandbox {
  const prefix = getIdPrefix(hypervisorType);
  // Use existing ID if it already has the correct prefix
  const id = vm.id.startsWith(`${prefix}-`) ? vm.id : `${prefix}-${vm.id}`;

  const meta: VmMeta = {
    type: 'vm',
    hypervisor: hypervisorType === 'daytona' ? 'cloud-hypervisor' : hypervisorType,
    networkMode: vm.networkMode || 'tap',
    hasSnapshots: true, // Both CH and FC support snapshots
    tapDevice: undefined, // Not exposed in VmInfo
    bootTimeMs: undefined,
    volumes: vm.volumes?.map((v) => ({
      name: v.name,
      mountPath: v.mountPath,
      sizeGb: 10, // Default, not exposed in VmInfo
    })),
  };

  return {
    id,
    name: vm.name,
    backend: hypervisorType === 'daytona' ? 'daytona' : hypervisorType,
    status: mapVmStatus(vm.status),
    error: vm.error,

    // Resources
    vcpus: vm.vcpus,
    memoryMb: vm.memoryMb,
    diskGb: vm.diskGb,

    // Network
    ports: vm.ports.map((p) => ({
      container: p.container,
      host: p.host,
      protocol: p.protocol,
    })),
    guestIp: vm.guestIp,

    // Access - VMs always use SSH
    terminalType: 'ssh',
    sshHost: vm.sshHost,
    sshPort: vm.sshPort,
    sshUser: vm.sshUser || 'agent',
    sshCommand: vm.sshCommand,

    // Metadata
    image: vm.image,
    createdAt: vm.createdAt,
    startedAt: vm.startedAt,

    backendMeta: meta,
  };
}

/**
 * Adapter for Cloud-Hypervisor VMs
 */
export class CloudHypervisorAdapter implements SandboxAdapter {
  readonly backend = 'cloud-hypervisor' as const;

  constructor(private hypervisor: CloudHypervisorService) {}

  async isAvailable(): Promise<boolean> {
    try {
      const fs = await import('fs');
      const { execSync } = await import('child_process');

      // Check common cloud-hypervisor binary locations
      const paths = ['/usr/bin/cloud-hypervisor', '/usr/local/bin/cloud-hypervisor'];
      for (const path of paths) {
        if (fs.existsSync(path)) {
          return true;
        }
      }

      // Try 'which cloud-hypervisor' as fallback
      try {
        const result = execSync('which cloud-hypervisor', { encoding: 'utf-8' }).trim();
        return !!result;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  async list(): Promise<Sandbox[]> {
    const vms = this.hypervisor.listVms();
    // Filter to only cloud-hypervisor VMs (exclude firecracker and daytona)
    return vms
      .filter((vm) => vm.hypervisor === 'cloud-hypervisor')
      .map((vm) => vmToSandbox(vm, 'cloud-hypervisor'));
  }

  async get(id: string): Promise<Sandbox | null> {
    // Strip the 'vm-' prefix to get the VM ID
    const vmId = id.startsWith('vm-') ? id.slice(3) : id;
    const vm = this.hypervisor.getVm(vmId);
    return vm ? vmToSandbox(vm, 'cloud-hypervisor') : null;
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    const vm = await this.hypervisor.createVm({
      name: request.name,
      baseImage: request.image,
      vcpus: request.vcpus,
      memoryMb: request.memoryMb,
      diskGb: request.diskGb,
      portMappings: request.ports?.map((p) => ({
        container: p.container,
        host: p.host,
        protocol: (p.protocol as 'tcp' | 'udp') || 'tcp',
      })),
      volumes: request.vmOptions?.volumes?.map((v) => ({
        name: v.id,
        hostPath: '', // Will be resolved by service
        mountPath: v.mountPath,
      })),
      networkMode: request.vmOptions?.networkMode === 'nat' ? 'user' : 'tap',
      autoStart: true,
    });

    return vmToSandbox(vm, 'cloud-hypervisor');
  }

  async start(id: string): Promise<Sandbox> {
    const vmId = id.startsWith('vm-') ? id.slice(3) : id;
    const vm = await this.hypervisor.startVm(vmId);
    return vmToSandbox(vm, 'cloud-hypervisor');
  }

  async stop(id: string): Promise<Sandbox> {
    const vmId = id.startsWith('vm-') ? id.slice(3) : id;
    const vm = await this.hypervisor.stopVm(vmId);
    return vmToSandbox(vm, 'cloud-hypervisor');
  }

  async delete(id: string): Promise<void> {
    const vmId = id.startsWith('vm-') ? id.slice(3) : id;
    await this.hypervisor.deleteVm(vmId);
  }
}

/**
 * Adapter for Firecracker VMs
 */
export class FirecrackerAdapter implements SandboxAdapter {
  readonly backend = 'firecracker' as const;

  constructor(private firecracker: FirecrackerService) {}

  async isAvailable(): Promise<boolean> {
    try {
      const fs = await import('fs');
      const { execSync } = await import('child_process');

      // Check common firecracker binary locations
      const paths = ['/usr/bin/firecracker', '/usr/local/bin/firecracker'];
      for (const path of paths) {
        if (fs.existsSync(path)) {
          return true;
        }
      }

      // Try 'which firecracker' as fallback
      try {
        const result = execSync('which firecracker', { encoding: 'utf-8' }).trim();
        return !!result;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  async list(): Promise<Sandbox[]> {
    const vms = this.firecracker.listVms();
    return vms.map((vm) => vmToSandbox(vm, 'firecracker'));
  }

  async get(id: string): Promise<Sandbox | null> {
    // Strip the 'fc-' prefix to get the VM ID
    const vmId = id.startsWith('fc-') ? id.slice(3) : id;
    const vm = this.firecracker.getVm(vmId);
    return vm ? vmToSandbox(vm, 'firecracker') : null;
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    const vm = await this.firecracker.createVm({
      name: request.name,
      baseImage: request.image,
      vcpus: request.vcpus,
      memoryMb: request.memoryMb,
      diskGb: request.diskGb,
      portMappings: request.ports?.map((p) => ({
        container: p.container,
        host: p.host,
        protocol: (p.protocol as 'tcp' | 'udp') || 'tcp',
      })),
      autoStart: true,
    });

    return vmToSandbox(vm, 'firecracker');
  }

  async start(id: string): Promise<Sandbox> {
    const vmId = id.startsWith('fc-') ? id.slice(3) : id;
    const vm = await this.firecracker.startVm(vmId);
    return vmToSandbox(vm, 'firecracker');
  }

  async stop(id: string): Promise<Sandbox> {
    const vmId = id.startsWith('fc-') ? id.slice(3) : id;
    const vm = await this.firecracker.stopVm(vmId);
    return vmToSandbox(vm, 'firecracker');
  }

  async delete(id: string): Promise<void> {
    const vmId = id.startsWith('fc-') ? id.slice(3) : id;
    await this.firecracker.deleteVm(vmId);
  }
}
