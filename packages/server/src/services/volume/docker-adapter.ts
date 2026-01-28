/**
 * Docker Volume Adapter
 *
 * Wraps Docker volume operations for the unified Volume abstraction.
 */

import type {
  Volume,
  VolumeFileInfo,
  CreateVolumeRequest,
  DockerVolumeMeta,
} from '../../types/volume.js';
import * as docker from '../docker.js';

/**
 * Converts a Docker volume to the unified Volume type
 */
function dockerVolumeToVolume(vol: {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt: string;
  size?: number;
}): Volume {
  const meta: DockerVolumeMeta = {
    type: 'docker',
    driver: vol.driver,
    mountpoint: vol.mountpoint,
  };

  return {
    id: `vol-docker-${vol.name}`,
    name: vol.name,
    backend: 'docker',
    status: 'ready',
    actualSizeMb: vol.size ? Math.round(vol.size / 1024 / 1024) : undefined,
    attachedTo: [], // Docker doesn't track this well, would need to scan containers
    createdAt: vol.createdAt,
    backendMeta: meta,
  };
}

export class DockerVolumeAdapter {
  readonly backend = 'docker' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await docker.listVolumes();
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<Volume[]> {
    const volumes = await docker.listVolumes();
    return volumes.map(dockerVolumeToVolume);
  }

  async get(id: string): Promise<Volume | null> {
    // Extract the volume name from the unified ID
    const name = id.replace(/^vol-docker-/, '');
    const volumes = await docker.listVolumes();
    const vol = volumes.find((v) => v.name === name);
    return vol ? dockerVolumeToVolume(vol) : null;
  }

  async create(request: CreateVolumeRequest): Promise<Volume> {
    await docker.createVolume(request.name);

    // Fetch the created volume to get full info
    const volumes = await docker.listVolumes();
    const vol = volumes.find((v) => v.name === request.name);

    if (!vol) {
      throw new Error('Failed to create volume');
    }

    return dockerVolumeToVolume(vol);
  }

  async delete(id: string): Promise<void> {
    const name = id.replace(/^vol-docker-/, '');
    await docker.removeVolume(name);
  }

  async listFiles(id: string, path: string = '/'): Promise<VolumeFileInfo[]> {
    const name = id.replace(/^vol-docker-/, '');
    const files = await docker.getVolumeFiles(name);

    // Docker getVolumeFiles returns flat file list, convert to VolumeFileInfo
    return files.map((f: string) => ({
      name: f,
      type: 'file' as const,
      size: 0, // Docker doesn't provide individual file sizes in this call
    }));
  }

  async uploadFile(id: string, filename: string, content: Buffer): Promise<void> {
    const name = id.replace(/^vol-docker-/, '');
    await docker.uploadFileToVolume(name, filename, content);
  }

  async downloadFile(id: string, filePath: string): Promise<Buffer> {
    // Docker volume download requires running a container
    // For now, return an error since this is not easily supported
    throw new Error('Direct file download not supported for Docker volumes. Use a container to access files.');
  }

  async deleteFile(id: string, filePath: string): Promise<void> {
    throw new Error('Direct file deletion not supported for Docker volumes. Use a container to delete files.');
  }
}
