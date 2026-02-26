/**
 * VmVolumeService - Standalone VM Volume Management
 *
 * Manages persistent block device volumes that can be attached to VMs.
 * Volumes are stored as ext4 image files and can be attached/detached
 * from VMs independently.
 */

import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { VmVolume, VmVolumeInfo } from '../types/vm.js';
import { DATA_DIR } from '../lib/paths.js';

export class VmVolumeService extends EventEmitter {
  private volumesDir: string;
  private volumes: Map<string, VmVolume> = new Map();
  private initialized: boolean = false;

  constructor(dataDir: string) {
    super();
    this.volumesDir = path.join(dataDir, 'vm-volumes');
  }

  /**
   * Initialize the volume service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[VmVolumeService] Initializing...');

    // Create volumes directory
    if (!fs.existsSync(this.volumesDir)) {
      fs.mkdirSync(this.volumesDir, { recursive: true, mode: 0o700 });
    }

    // Load existing volumes
    await this.loadVolumes();

    this.initialized = true;
    console.log(`[VmVolumeService] Initialized with ${this.volumes.size} volumes`);
  }

  /**
   * Load existing volumes from disk
   */
  private async loadVolumes(): Promise<void> {
    const entries = fs.readdirSync(this.volumesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadataPath = path.join(this.volumesDir, entry.name, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as VmVolume;

            // Update actual size
            const imagePath = path.join(this.volumesDir, entry.name, 'volume.img');
            if (fs.existsSync(imagePath)) {
              const stats = fs.statSync(imagePath);
              metadata.actualSizeMb = Math.round(stats.size / (1024 * 1024));
            }

            this.volumes.set(metadata.id, metadata);
          } catch (error) {
            console.error(`[VmVolumeService] Failed to load volume ${entry.name}:`, error);
          }
        }
      }
    }
  }

  /**
   * Save volume metadata to disk
   */
  private saveVolumeMetadata(volume: VmVolume): void {
    const volumeDir = path.join(this.volumesDir, volume.id);
    if (!fs.existsSync(volumeDir)) {
      fs.mkdirSync(volumeDir, { recursive: true });
    }

    const metadataPath = path.join(volumeDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(volume, null, 2));
  }

  /**
   * Generate a unique volume ID
   */
  private generateVolumeId(): string {
    return 'vol-' + crypto.randomUUID().slice(0, 8);
  }

  /**
   * Create a new volume
   */
  async createVolume(config: {
    name: string;
    sizeGb: number;
    format?: 'ext4' | 'xfs';
    mountPath?: string;
  }): Promise<VmVolumeInfo> {
    console.log(`[VmVolumeService] Creating volume: ${config.name} (${config.sizeGb}GB)`);

    // Check for name uniqueness
    for (const vol of this.volumes.values()) {
      if (vol.name === config.name) {
        throw new Error(`Volume with name '${config.name}' already exists`);
      }
    }

    const id = this.generateVolumeId();
    const format = config.format || 'ext4';
    const volumeDir = path.join(this.volumesDir, id);
    const imagePath = path.join(volumeDir, 'volume.img');

    // Create volume directory
    fs.mkdirSync(volumeDir, { recursive: true });

    try {
      // Create sparse image file
      console.log(`[VmVolumeService] Creating ${config.sizeGb}GB sparse image`);
      execFileSync('truncate', ['-s', `${config.sizeGb}G`, imagePath], { stdio: 'pipe' });

      // Format the image
      console.log(`[VmVolumeService] Formatting as ${format}`);
      if (format === 'ext4') {
        execFileSync('mkfs.ext4', ['-F', '-q', imagePath], { stdio: 'pipe' });
      } else {
        execFileSync('mkfs.xfs', ['-f', '-q', imagePath], { stdio: 'pipe' });
      }

      // Get actual size
      const stats = fs.statSync(imagePath);
      const actualSizeMb = Math.round(stats.size / (1024 * 1024));

      const volume: VmVolume = {
        id,
        name: config.name,
        sizeGb: config.sizeGb,
        actualSizeMb,
        format,
        mountPath: config.mountPath || '/mnt/data',
        createdAt: new Date().toISOString(),
      };

      this.volumes.set(id, volume);
      this.saveVolumeMetadata(volume);

      this.emit('volume:created', volume);
      console.log(`[VmVolumeService] Volume ${id} created (${actualSizeMb}MB actual)`);

      return this.volumeToInfo(volume);
    } catch (error) {
      // Clean up on failure
      if (fs.existsSync(volumeDir)) {
        fs.rmSync(volumeDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Delete a volume
   */
  async deleteVolume(id: string): Promise<void> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    if (volume.attachedTo) {
      throw new Error(`Volume ${id} is attached to VM ${volume.attachedTo}. Detach it first.`);
    }

    console.log(`[VmVolumeService] Deleting volume ${id}`);

    const volumeDir = path.join(this.volumesDir, id);
    if (fs.existsSync(volumeDir)) {
      fs.rmSync(volumeDir, { recursive: true, force: true });
    }

    this.volumes.delete(id);
    this.emit('volume:deleted', { id });
    console.log(`[VmVolumeService] Volume ${id} deleted`);
  }

  /**
   * Get a volume by ID
   */
  getVolume(id: string): VmVolumeInfo | null {
    const volume = this.volumes.get(id);
    return volume ? this.volumeToInfo(volume) : null;
  }

  /**
   * Get a volume by name
   */
  getVolumeByName(name: string): VmVolumeInfo | null {
    for (const volume of this.volumes.values()) {
      if (volume.name === name) {
        return this.volumeToInfo(volume);
      }
    }
    return null;
  }

  /**
   * List all volumes
   */
  listVolumes(): VmVolumeInfo[] {
    return Array.from(this.volumes.values()).map(vol => this.volumeToInfo(vol));
  }

  /**
   * Get the path to a volume's image file
   */
  getVolumePath(id: string): string | null {
    const volume = this.volumes.get(id);
    if (!volume) return null;
    return path.join(this.volumesDir, id, 'volume.img');
  }

  /**
   * Attach a volume to a VM
   */
  attachVolume(volumeId: string, vmId: string, vmName?: string): void {
    const volume = this.volumes.get(volumeId);
    if (!volume) {
      throw new Error(`Volume ${volumeId} not found`);
    }

    if (volume.attachedTo && volume.attachedTo !== vmId) {
      throw new Error(`Volume ${volumeId} is already attached to VM ${volume.attachedTo}`);
    }

    volume.attachedTo = vmId;
    volume.attachedToVmName = vmName;
    volume.lastAttachedAt = new Date().toISOString();
    this.saveVolumeMetadata(volume);

    this.emit('volume:attached', { volumeId, vmId, vmName });
    console.log(`[VmVolumeService] Volume ${volumeId} attached to VM ${vmId} (${vmName || 'unnamed'})`);
  }

  /**
   * Detach a volume from a VM
   */
  detachVolume(volumeId: string, vmId?: string): void {
    const volume = this.volumes.get(volumeId);
    if (!volume) {
      throw new Error(`Volume ${volumeId} not found`);
    }

    if (vmId && volume.attachedTo !== vmId) {
      throw new Error(`Volume ${volumeId} is not attached to VM ${vmId}`);
    }

    const previousVmId = volume.attachedTo;
    volume.attachedTo = undefined;
    this.saveVolumeMetadata(volume);

    this.emit('volume:detached', { volumeId, vmId: previousVmId });
    console.log(`[VmVolumeService] Volume ${volumeId} detached from VM ${previousVmId}`);
  }

  /**
   * Detach all volumes from a VM (called when VM is deleted)
   */
  detachAllFromVm(vmId: string): void {
    for (const volume of this.volumes.values()) {
      if (volume.attachedTo === vmId) {
        volume.attachedTo = undefined;
        this.saveVolumeMetadata(volume);
        console.log(`[VmVolumeService] Volume ${volume.id} detached from deleted VM ${vmId}`);
      }
    }
  }

  /**
   * Get volumes attached to a VM
   */
  getVmVolumes(vmId: string): VmVolumeInfo[] {
    return Array.from(this.volumes.values())
      .filter(vol => vol.attachedTo === vmId)
      .map(vol => this.volumeToInfo(vol));
  }

  /**
   * Resize a volume (can only grow, not shrink)
   */
  async resizeVolume(id: string, newSizeGb: number): Promise<VmVolumeInfo> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    if (volume.attachedTo) {
      throw new Error(`Volume ${id} is attached to VM ${volume.attachedTo}. Detach it first.`);
    }

    if (newSizeGb <= volume.sizeGb) {
      throw new Error(`New size (${newSizeGb}GB) must be larger than current size (${volume.sizeGb}GB)`);
    }

    console.log(`[VmVolumeService] Resizing volume ${id} from ${volume.sizeGb}GB to ${newSizeGb}GB`);

    const imagePath = path.join(this.volumesDir, id, 'volume.img');

    // Extend the image file
    execFileSync('truncate', ['-s', `${newSizeGb}G`, imagePath], { stdio: 'pipe' });

    // Resize the filesystem
    if (volume.format === 'ext4') {
      execFileSync('e2fsck', ['-f', '-y', imagePath], { stdio: 'pipe' });
      execFileSync('resize2fs', [imagePath], { stdio: 'pipe' });
    } else {
      // XFS requires mounting to resize
      throw new Error('XFS resize is not supported for detached volumes');
    }

    volume.sizeGb = newSizeGb;
    const stats = fs.statSync(imagePath);
    volume.actualSizeMb = Math.round(stats.size / (1024 * 1024));
    this.saveVolumeMetadata(volume);

    this.emit('volume:resized', { volumeId: id, newSizeGb });
    console.log(`[VmVolumeService] Volume ${id} resized to ${newSizeGb}GB`);

    return this.volumeToInfo(volume);
  }

  /**
   * List files in a volume using debugfs
   */
  async listFiles(id: string, dirPath: string = '/'): Promise<{ name: string; type: 'file' | 'directory'; size: number }[]> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    if (volume.format !== 'ext4') {
      throw new Error('File listing is only supported for ext4 volumes');
    }

    const imagePath = path.join(this.volumesDir, id, 'volume.img');

    try {
      // Use debugfs to list directory contents
      const result = execFileSync('debugfs', ['-R', `ls -l ${dirPath}`, imagePath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const files: { name: string; type: 'file' | 'directory'; size: number }[] = [];
      const lines = result.trim().split('\n');

      for (const line of lines) {
        // Parse debugfs ls -l output format
        // Example: 12 40755 (2)   0   0    1024 23-Jan-2026 14:30 dirname
        const match = line.match(/^\s*\d+\s+(\d+)\s+\(\d+\)\s+\d+\s+\d+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/);
        if (match) {
          const mode = parseInt(match[1], 8);
          const size = parseInt(match[2], 10);
          const name = match[3].trim();

          if (name === '.' || name === '..') continue;

          const isDir = (mode & 0o40000) !== 0;
          files.push({
            name,
            type: isDir ? 'directory' : 'file',
            size,
          });
        }
      }

      return files;
    } catch (error) {
      console.error(`[VmVolumeService] Failed to list files in volume ${id}:`, error);
      return [];
    }
  }

  /**
   * Upload a file to a volume using debugfs
   */
  async uploadFile(id: string, fileName: string, content: Buffer, destPath: string = '/'): Promise<void> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    if (volume.format !== 'ext4') {
      throw new Error('File upload is only supported for ext4 volumes');
    }

    if (volume.attachedTo) {
      throw new Error(`Volume ${id} is attached to a VM. Detach it first or upload through the VM.`);
    }

    const imagePath = path.join(this.volumesDir, id, 'volume.img');
    const volumeDir = path.join(this.volumesDir, id);
    const tmpFile = path.join(volumeDir, `upload-${Date.now()}-${fileName}`);

    // Write content to temp file
    fs.writeFileSync(tmpFile, content);

    try {
      // Ensure destination directory exists and write file using debugfs
      const destFilePath = destPath === '/' ? `/${fileName}` : `${destPath}/${fileName}`;

      // Create parent directories if needed
      if (destPath !== '/') {
        const parts = destPath.split('/').filter(Boolean);
        let currentPath = '';
        for (const part of parts) {
          currentPath += `/${part}`;
          try {
            execFileSync('debugfs', ['-w', '-R', `mkdir ${currentPath}`, imagePath], { stdio: 'pipe' });
          } catch {
            // Directory may already exist
          }
        }
      }

      // Write the file
      execFileSync('debugfs', ['-w', '-R', `write ${tmpFile} ${destFilePath}`, imagePath], { stdio: 'pipe' });

      console.log(`[VmVolumeService] Uploaded ${fileName} to volume ${id}:${destFilePath}`);

      // Update actual size
      const stats = fs.statSync(imagePath);
      volume.actualSizeMb = Math.round(stats.size / (1024 * 1024));
      this.saveVolumeMetadata(volume);

    } finally {
      // Clean up temp file
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  }

  /**
   * Download a file from a volume using debugfs
   */
  async downloadFile(id: string, filePath: string): Promise<Buffer> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    if (volume.format !== 'ext4') {
      throw new Error('File download is only supported for ext4 volumes');
    }

    const imagePath = path.join(this.volumesDir, id, 'volume.img');
    const volumeDir = path.join(this.volumesDir, id);
    const tmpFile = path.join(volumeDir, `download-${Date.now()}`);

    try {
      // Extract file using debugfs
      execFileSync('debugfs', ['-R', `dump ${filePath} ${tmpFile}`, imagePath], { stdio: 'pipe' });

      const content = fs.readFileSync(tmpFile);
      return content;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  }

  /**
   * Delete a file from a volume using debugfs
   */
  async deleteFile(id: string, filePath: string): Promise<void> {
    const volume = this.volumes.get(id);
    if (!volume) {
      throw new Error(`Volume ${id} not found`);
    }

    if (volume.format !== 'ext4') {
      throw new Error('File deletion is only supported for ext4 volumes');
    }

    if (volume.attachedTo) {
      throw new Error(`Volume ${id} is attached to a VM. Detach it first.`);
    }

    const imagePath = path.join(this.volumesDir, id, 'volume.img');

    // Delete using debugfs rm command
    execFileSync('debugfs', ['-w', '-R', `rm ${filePath}`, imagePath], { stdio: 'pipe' });

    console.log(`[VmVolumeService] Deleted ${filePath} from volume ${id}`);
  }

  /**
   * Convert internal volume to API info
   */
  private volumeToInfo(volume: VmVolume): VmVolumeInfo {
    return {
      id: volume.id,
      name: volume.name,
      sizeGb: volume.sizeGb,
      actualSizeMb: volume.actualSizeMb,
      format: volume.format,
      mountPath: volume.mountPath,
      attachedTo: volume.attachedTo,
      attachedToVmName: volume.attachedToVmName,
      createdAt: volume.createdAt,
      lastAttachedAt: volume.lastAttachedAt,
    };
  }
}

// Singleton instance
let vmVolumeService: VmVolumeService | null = null;

export function getVmVolumeService(dataDir?: string): VmVolumeService {
  if (!vmVolumeService) {
    if (!dataDir) {
      dataDir = DATA_DIR;
    }
    vmVolumeService = new VmVolumeService(dataDir);
  }
  return vmVolumeService;
}

export async function initializeVmVolumeService(dataDir?: string): Promise<VmVolumeService> {
  const service = getVmVolumeService(dataDir);
  await service.initialize();
  return service;
}

/**
 * Reset the VM volume service singleton so it gets re-created
 * with the new data directory on next access.
 */
export function resetVmVolumeService(): void {
  vmVolumeService = null;
}
