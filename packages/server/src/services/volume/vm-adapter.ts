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
import { getFirecrackerService } from '../firecracker.js';

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

  /**
   * Attach a volume to a VM/sandbox
   * This updates metadata AND configures the actual Firecracker drive
   */
  async attach(id: string, sandboxId: string): Promise<Volume> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');

    // Get volume info
    const vol = service.getVolume(vmVolId);
    if (!vol) throw new Error(`Volume ${id} not found`);

    // Get volume path
    const volumePath = service.getVolumePath(vmVolId);
    if (!volumePath) throw new Error(`Volume ${id} path not found`);

    // Check if this is a Firecracker VM (starts with fc-)
    if (sandboxId.startsWith('fc-')) {
      const firecrackerService = getFirecrackerService();

      // Attach the volume in Firecracker (this will restart the VM if running)
      await firecrackerService.attachVolume(sandboxId, {
        name: vol.name,
        hostPath: volumePath,
        mountPath: vol.mountPath || '/mnt/data',
        readOnly: false,
      });
    }

    // Update volume metadata (track which VM it's attached to)
    // Extract raw VM ID for metadata (fc-xxx -> xxx to match internal storage)
    const rawVmId = sandboxId.replace(/^(fc-|vm-)/, '');
    service.attachVolume(vmVolId, rawVmId);

    const updatedVol = service.getVolume(vmVolId);
    if (!updatedVol) throw new Error(`Volume ${id} not found after attach`);
    return vmVolumeToVolume(updatedVol, service);
  }

  /**
   * Detach a volume from a VM/sandbox
   * This updates metadata AND removes the Firecracker drive configuration
   */
  async detach(id: string): Promise<Volume> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');

    // Get volume info to find which VM it's attached to
    const vol = service.getVolume(vmVolId);
    if (!vol) throw new Error(`Volume ${id} not found`);

    if (!vol.attachedTo) {
      throw new Error(`Volume ${id} is not attached to any VM`);
    }

    // Try to detach from Firecracker
    // The attachedTo field stores the raw VM ID, we need to try with fc- prefix
    const firecrackerService = getFirecrackerService();
    const fcVmId = `fc-${vol.attachedTo}`;

    try {
      const fcVm = firecrackerService.getVm(fcVmId);
      if (fcVm) {
        // It's a Firecracker VM - detach the volume (this will restart the VM if running)
        await firecrackerService.detachVolume(fcVmId, vol.name);
      }
    } catch (error) {
      // VM might not exist anymore or might be a different type - continue with metadata cleanup
      console.warn(`[VmVolumeAdapter] Could not detach from Firecracker VM ${fcVmId}:`, error);
    }

    // Update volume metadata
    service.detachVolume(vmVolId);

    const updatedVol = service.getVolume(vmVolId);
    if (!updatedVol) throw new Error(`Volume ${id} not found after detach`);
    return vmVolumeToVolume(updatedVol, service);
  }
}
