/**
 * VM Volume Adapter
 *
 * Wraps VM volume operations for the unified Volume abstraction.
 */

import type {
  Volume,
  VolumeFileInfo,
  CreateVolumeRequest,
  VmVolumeMeta,
} from '../../types/volume.js';
import { getVmVolumeService, initializeVmVolumeService, VmVolumeService } from '../vm-volumes.js';

/**
 * Converts a VM volume to the unified Volume type
 */
function vmVolumeToVolume(
  vol: {
    id: string;
    name: string;
    sizeGb: number;
    actualSizeMb: number;
    format: 'ext4' | 'xfs';
    mountPath?: string;
    attachedTo?: string;
    attachedToVmName?: string;
    createdAt: string;
    lastAttachedAt?: string;
  },
  volumeService: VmVolumeService
): Volume {
  const meta: VmVolumeMeta = {
    type: 'vm',
    format: vol.format,
    devicePath: volumeService.getVolumePath(vol.id) || '',
    lastAttachedAt: vol.lastAttachedAt,
  };

  return {
    id: `vol-vm-${vol.id}`,
    name: vol.name,
    backend: 'vm',
    status: vol.attachedTo ? 'attached' : 'ready',
    sizeGb: vol.sizeGb,
    actualSizeMb: vol.actualSizeMb,
    mountPath: vol.mountPath,
    attachedTo: vol.attachedTo
      ? [{
          sandboxId: vol.attachedTo,
          sandboxName: vol.attachedToVmName || vol.attachedTo,
          mountPath: vol.mountPath || '/mnt/data',
        }]
      : [],
    createdAt: vol.createdAt,
    backendMeta: meta,
  };
}

export class VmVolumeAdapter {
  readonly backend = 'vm' as const;
  private volumeService: VmVolumeService | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return true;
    } catch {
      return false;
    }
  }

  private async ensureInitialized(): Promise<VmVolumeService> {
    if (!this.volumeService) {
      this.volumeService = await initializeVmVolumeService();
    }
    return this.volumeService;
  }

  async list(): Promise<Volume[]> {
    const service = await this.ensureInitialized();
    const volumes = service.listVolumes();
    return volumes.map((vol) => vmVolumeToVolume(vol, service));
  }

  async get(id: string): Promise<Volume | null> {
    const service = await this.ensureInitialized();
    // Extract the VM volume ID from the unified ID
    const vmVolId = id.replace(/^vol-vm-/, '');
    const vol = service.getVolume(vmVolId);
    return vol ? vmVolumeToVolume(vol, service) : null;
  }

  async create(request: CreateVolumeRequest): Promise<Volume> {
    const service = await this.ensureInitialized();

    const vol = await service.createVolume({
      name: request.name,
      sizeGb: request.sizeGb || 10,
      format: request.format || 'ext4',
      mountPath: request.mountPath,
    });

    return vmVolumeToVolume(vol, service);
  }

  async delete(id: string): Promise<void> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');
    await service.deleteVolume(vmVolId);
  }

  async listFiles(id: string, path: string = '/'): Promise<VolumeFileInfo[]> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');
    const files = await service.listFiles(vmVolId, path);
    return files;
  }

  async uploadFile(id: string, filename: string, content: Buffer, destPath: string = '/'): Promise<void> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');
    await service.uploadFile(vmVolId, filename, content, destPath);
  }

  async downloadFile(id: string, filePath: string): Promise<Buffer> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');
    return service.downloadFile(vmVolId, filePath);
  }

  async deleteFile(id: string, filePath: string): Promise<void> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');
    await service.deleteFile(vmVolId, filePath);
  }
}
