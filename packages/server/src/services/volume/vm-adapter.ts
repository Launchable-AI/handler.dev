/**
 * VM Volume Adapter
 *
 * Wraps VM volume operations for the unified Volume abstraction.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
 * If the volume is attached to a VM but has no stored name, attempts to look it up
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
  volumeService: VmVolumeService,
  vmNameLookup?: (rawVmId: string) => string | undefined
): Volume {
  const meta: VmVolumeMeta = {
    type: 'vm',
    format: vol.format,
    devicePath: volumeService.getVolumePath(vol.id) || '',
    lastAttachedAt: vol.lastAttachedAt,
  };

  // Try to get VM name: first from stored metadata, then via lookup
  let sandboxName = vol.attachedToVmName;
  if (vol.attachedTo && !sandboxName && vmNameLookup) {
    sandboxName = vmNameLookup(vol.attachedTo);
  }

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
          sandboxName: sandboxName || vol.attachedTo,
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

  /**
   * Create a VM name lookup function using the Firecracker service
   * This allows us to resolve VM names for volumes that were attached
   * before we started storing the name
   */
  private createVmNameLookup(): (rawVmId: string) => string | undefined {
    return (rawVmId: string) => {
      try {
        const firecrackerService = getFirecrackerService();
        const fcVm = firecrackerService.getVm(`fc-${rawVmId}`);
        return fcVm?.name;
      } catch {
        return undefined;
      }
    };
  }

  async list(): Promise<Volume[]> {
    const service = await this.ensureInitialized();
    const volumes = service.listVolumes();
    const vmNameLookup = this.createVmNameLookup();
    return volumes.map((vol) => vmVolumeToVolume(vol, service, vmNameLookup));
  }

  async get(id: string): Promise<Volume | null> {
    const service = await this.ensureInitialized();
    // Extract the VM volume ID from the unified ID
    const vmVolId = id.replace(/^vol-vm-/, '');
    const vol = service.getVolume(vmVolId);
    const vmNameLookup = this.createVmNameLookup();
    return vol ? vmVolumeToVolume(vol, service, vmNameLookup) : null;
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

  async listFiles(id: string, dirPath: string = '/'): Promise<VolumeFileInfo[]> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');

    // Get the volume to check if it's attached
    const vol = service.getVolume(vmVolId);
    if (!vol) {
      throw new Error(`Volume ${id} not found`);
    }

    // If volume is attached, try to list via SSH
    if (vol.attachedTo) {
      const files = await this.listFilesViaSsh(vol.attachedTo, vol.mountPath || '/mnt/data', dirPath);
      if (files !== null) {
        return files;
      }
      // If SSH failed, return empty list with a message (VM not running)
      return [];
    }

    // Volume not attached, use debugfs
    const files = await service.listFiles(vmVolId, dirPath);
    return files;
  }

  /**
   * List files in an attached volume via SSH
   * @returns file list if successful, null if VM is not running/accessible
   */
  private async listFilesViaSsh(rawVmId: string, mountPath: string, dirPath: string): Promise<VolumeFileInfo[] | null> {
    try {
      const firecrackerService = getFirecrackerService();
      const fcVmId = `fc-${rawVmId}`;
      const vm = firecrackerService.getVm(fcVmId);

      if (!vm || vm.status !== 'running') {
        return null;
      }

      const guestIp = vm.guestIp;
      if (!guestIp) {
        return null;
      }

      const dataDir = firecrackerService.getDataDir();
      const sshKeyPath = path.join(dataDir, 'ssh-keys', 'id_ed25519');

      if (!fs.existsSync(sshKeyPath)) {
        return null;
      }

      // Build remote path
      const remotePath = dirPath === '/' ? mountPath : `${mountPath}${dirPath}`;

      // List files with details using ls -la
      const lsCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o IdentitiesOnly=yes agent@${guestIp} 'ls -la "${remotePath}" 2>/dev/null || echo ""'`;

      const result = execSync(lsCmd, { encoding: 'utf-8', timeout: 10000 });

      const files: VolumeFileInfo[] = [];
      const lines = result.trim().split('\n');

      for (const line of lines) {
        // Parse ls -la output: drwxr-xr-x 2 agent agent 4096 Jan 27 10:00 dirname
        const match = line.match(/^([d-])[rwx-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(.+)$/);
        if (match) {
          const isDir = match[1] === 'd';
          const size = parseInt(match[2], 10);
          const name = match[3].trim();

          if (name === '.' || name === '..') continue;

          files.push({
            name,
            type: isDir ? 'directory' : 'file',
            size,
          });
        }
      }

      return files;
    } catch (error) {
      console.warn('[VmVolumeAdapter] SSH listFiles failed:', error);
      return null;
    }
  }

  async uploadFile(id: string, filename: string, content: Buffer, destPath: string = '/'): Promise<void> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');

    // Get the volume to check if it's attached
    const vol = service.getVolume(vmVolId);
    if (!vol) {
      throw new Error(`Volume ${id} not found`);
    }

    // If volume is attached, try to upload via SSH
    if (vol.attachedTo) {
      const uploaded = await this.uploadViaSsh(vol.attachedTo, vol.mountPath || '/mnt/data', filename, content, destPath);
      if (uploaded) {
        return;
      }
      // If SSH upload failed (VM not running), throw helpful error
      throw new Error(`Volume ${id} is attached to a VM. Either detach it first, or ensure the VM is running to upload via SSH.`);
    }

    // Volume not attached, use debugfs
    await service.uploadFile(vmVolId, filename, content, destPath);
  }

  /**
   * Upload a file to an attached volume via SSH
   * @returns true if upload succeeded, false if VM is not running/accessible
   */
  private async uploadViaSsh(rawVmId: string, mountPath: string, filename: string, content: Buffer, destPath: string): Promise<boolean> {
    try {
      const firecrackerService = getFirecrackerService();
      const fcVmId = `fc-${rawVmId}`;
      const vm = firecrackerService.getVm(fcVmId);

      if (!vm || vm.status !== 'running') {
        return false;
      }

      // Get VM's SSH connection info
      const guestIp = vm.guestIp;
      if (!guestIp) {
        return false;
      }

      // Get SSH key path
      const dataDir = firecrackerService.getDataDir();
      const sshKeyPath = path.join(dataDir, 'ssh-keys', 'id_ed25519');

      if (!fs.existsSync(sshKeyPath)) {
        console.warn('[VmVolumeAdapter] SSH key not found:', sshKeyPath);
        return false;
      }

      // Write content to temp file
      const tmpFile = `/tmp/vol-upload-${Date.now()}-${filename}`;
      fs.writeFileSync(tmpFile, content);

      try {
        // Build destination path
        const remotePath = destPath === '/'
          ? `${mountPath}/${filename}`
          : `${mountPath}${destPath}/${filename}`;

        // Ensure remote directory exists
        const remoteDir = path.dirname(remotePath);
        const mkdirCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o IdentitiesOnly=yes agent@${guestIp} 'mkdir -p "${remoteDir}"'`;
        execSync(mkdirCmd, { stdio: 'pipe', timeout: 10000 });

        // Upload file via SCP
        const scpCmd = `scp -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o IdentitiesOnly=yes "${tmpFile}" agent@${guestIp}:"${remotePath}"`;
        execSync(scpCmd, { stdio: 'pipe', timeout: 60000 });

        console.log(`[VmVolumeAdapter] Uploaded ${filename} to VM ${fcVmId} at ${remotePath} via SSH`);
        return true;
      } finally {
        // Clean up temp file
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    } catch (error) {
      console.warn('[VmVolumeAdapter] SSH upload failed:', error);
      return false;
    }
  }

  async downloadFile(id: string, filePath: string): Promise<Buffer> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');

    // Get the volume to check if it's attached
    const vol = service.getVolume(vmVolId);
    if (!vol) {
      throw new Error(`Volume ${id} not found`);
    }

    // If volume is attached, try to download via SSH
    if (vol.attachedTo) {
      const content = await this.downloadViaSsh(vol.attachedTo, vol.mountPath || '/mnt/data', filePath);
      if (content !== null) {
        return content;
      }
      throw new Error(`Volume ${id} is attached to a VM. Either detach it first, or ensure the VM is running to download via SSH.`);
    }

    return service.downloadFile(vmVolId, filePath);
  }

  /**
   * Download a file from an attached volume via SSH
   * @returns file content if successful, null if VM is not running/accessible
   */
  private async downloadViaSsh(rawVmId: string, mountPath: string, filePath: string): Promise<Buffer | null> {
    try {
      const firecrackerService = getFirecrackerService();
      const fcVmId = `fc-${rawVmId}`;
      const vm = firecrackerService.getVm(fcVmId);

      if (!vm || vm.status !== 'running') {
        return null;
      }

      const guestIp = vm.guestIp;
      if (!guestIp) {
        return null;
      }

      const dataDir = firecrackerService.getDataDir();
      const sshKeyPath = path.join(dataDir, 'ssh-keys', 'id_ed25519');

      if (!fs.existsSync(sshKeyPath)) {
        return null;
      }

      // Build remote path
      const remotePath = `${mountPath}${filePath}`;
      const tmpFile = `/tmp/vol-download-${Date.now()}`;

      try {
        // Download file via SCP
        const scpCmd = `scp -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o IdentitiesOnly=yes agent@${guestIp}:"${remotePath}" "${tmpFile}"`;
        execSync(scpCmd, { stdio: 'pipe', timeout: 60000 });

        const content = fs.readFileSync(tmpFile);
        return content;
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    } catch (error) {
      console.warn('[VmVolumeAdapter] SSH download failed:', error);
      return null;
    }
  }

  async deleteFile(id: string, filePath: string): Promise<void> {
    const service = await this.ensureInitialized();
    const vmVolId = id.replace(/^vol-vm-/, '');

    // Get the volume to check if it's attached
    const vol = service.getVolume(vmVolId);
    if (!vol) {
      throw new Error(`Volume ${id} not found`);
    }

    // If volume is attached, try to delete via SSH
    if (vol.attachedTo) {
      const deleted = await this.deleteViaSsh(vol.attachedTo, vol.mountPath || '/mnt/data', filePath);
      if (deleted) {
        return;
      }
      throw new Error(`Volume ${id} is attached to a VM. Either detach it first, or ensure the VM is running to delete via SSH.`);
    }

    await service.deleteFile(vmVolId, filePath);
  }

  /**
   * Delete a file from an attached volume via SSH
   * @returns true if successful, false if VM is not running/accessible
   */
  private async deleteViaSsh(rawVmId: string, mountPath: string, filePath: string): Promise<boolean> {
    try {
      const firecrackerService = getFirecrackerService();
      const fcVmId = `fc-${rawVmId}`;
      const vm = firecrackerService.getVm(fcVmId);

      if (!vm || vm.status !== 'running') {
        return false;
      }

      const guestIp = vm.guestIp;
      if (!guestIp) {
        return false;
      }

      const dataDir = firecrackerService.getDataDir();
      const sshKeyPath = path.join(dataDir, 'ssh-keys', 'id_ed25519');

      if (!fs.existsSync(sshKeyPath)) {
        return false;
      }

      // Build remote path
      const remotePath = `${mountPath}${filePath}`;

      // Delete file via SSH
      const rmCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o IdentitiesOnly=yes agent@${guestIp} 'rm -f "${remotePath}"'`;
      execSync(rmCmd, { stdio: 'pipe', timeout: 10000 });

      console.log(`[VmVolumeAdapter] Deleted ${filePath} from VM ${fcVmId} via SSH`);
      return true;
    } catch (error) {
      console.warn('[VmVolumeAdapter] SSH delete failed:', error);
      return false;
    }
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

    let vmName: string | undefined;

    // Check if this is a Firecracker VM (starts with fc-)
    if (sandboxId.startsWith('fc-')) {
      const firecrackerService = getFirecrackerService();

      // Get VM name for metadata
      const vm = firecrackerService.getVm(sandboxId);
      vmName = vm?.name;

      // Attach the volume in Firecracker (this will restart the VM if running)
      await firecrackerService.attachVolume(sandboxId, {
        id: vmVolId,
        name: vol.name,
        hostPath: volumePath,
        mountPath: vol.mountPath || '/mnt/data',
        readOnly: false,
      });
    }

    // Update volume metadata (track which VM it's attached to)
    // Extract raw VM ID for metadata (fc-xxx -> xxx to match internal storage)
    const rawVmId = sandboxId.replace(/^(fc-|vm-)/, '');
    service.attachVolume(vmVolId, rawVmId, vmName);

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
