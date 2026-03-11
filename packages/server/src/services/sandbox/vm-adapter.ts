/**
 * VM Sandbox Adapter
 *
 * Converts Firecracker VMs to the unified Sandbox abstraction.
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
    default:
      return 'fc';
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
    hypervisor: 'firecracker',
    networkMode: vm.networkMode || 'tap',
    hasSnapshots: true,
    tapDevice: undefined, // Not exposed in VmInfo
    bootTimeMs: undefined,
    volumes: vm.volumes?.map((v) => ({
      id: v.id,
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
    statusMessage: vm.statusMessage,

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
    // Firecracker IDs already include the 'fc-' prefix internally
    const vm = this.firecracker.getVm(id);
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
    // Firecracker IDs already include the 'fc-' prefix internally
    const vm = await this.firecracker.startVm(id);
    return vmToSandbox(vm, 'firecracker');
  }

  async stop(id: string): Promise<Sandbox> {
    // Firecracker IDs already include the 'fc-' prefix internally
    const vm = await this.firecracker.stopVm(id);
    return vmToSandbox(vm, 'firecracker');
  }

  async delete(id: string): Promise<void> {
    // Firecracker IDs already include the 'fc-' prefix internally
    await this.firecracker.deleteVm(id);
  }
}
