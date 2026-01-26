/**
 * Unified Volume Service
 *
 * Provides a single API for managing all volume backends:
 * - Docker volumes (directory-based)
 * - VM volumes (ext4 block devices)
 * - Daytona volumes (S3-backed)
 */

import type {
  Volume,
  VolumeBackend,
  VolumeFileInfo,
  CreateVolumeRequest,
  VolumeListFilter,
} from '../../types/volume.js';
import { DockerVolumeAdapter } from './docker-adapter.js';
import { VmVolumeAdapter } from './vm-adapter.js';
import { DaytonaVolumeAdapter } from './daytona-adapter.js';

interface VolumeAdapter {
  backend: VolumeBackend;
  isAvailable(): Promise<boolean>;
  list(): Promise<Volume[]>;
  get(id: string): Promise<Volume | null>;
  create(request: CreateVolumeRequest): Promise<Volume>;
  delete(id: string): Promise<void>;
  listFiles(id: string, path?: string): Promise<VolumeFileInfo[]>;
  uploadFile(id: string, filename: string, content: Buffer, destPath?: string): Promise<void>;
  downloadFile(id: string, filePath: string): Promise<Buffer>;
  deleteFile(id: string, filePath: string): Promise<void>;
}

export class VolumeService {
  private adapters: Map<VolumeBackend, VolumeAdapter> = new Map();
  private initialized = false;

  /**
   * Initialize the volume service with all available adapters
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[VolumeService] Initializing...');

    // Register Docker adapter
    const dockerAdapter = new DockerVolumeAdapter();
    if (await dockerAdapter.isAvailable()) {
      this.adapters.set('docker', dockerAdapter);
      console.log('[VolumeService] Docker volume adapter registered');
    }

    // Register VM adapter
    const vmAdapter = new VmVolumeAdapter();
    if (await vmAdapter.isAvailable()) {
      this.adapters.set('vm', vmAdapter);
      console.log('[VolumeService] VM volume adapter registered');
    }

    // Register Daytona adapter
    const daytonaAdapter = new DaytonaVolumeAdapter();
    if (await daytonaAdapter.isAvailable()) {
      this.adapters.set('daytona', daytonaAdapter);
      console.log('[VolumeService] Daytona volume adapter registered');
    }

    this.initialized = true;
    console.log(`[VolumeService] Initialized with ${this.adapters.size} adapters`);
  }

  /**
   * Get availability status for all backends
   */
  async getBackendStatus(): Promise<Record<VolumeBackend, boolean>> {
    const results: Record<VolumeBackend, boolean> = {
      docker: false,
      vm: false,
      daytona: false,
    };

    for (const [backend, adapter] of this.adapters) {
      try {
        results[backend] = await adapter.isAvailable();
      } catch {
        results[backend] = false;
      }
    }

    return results;
  }

  /**
   * List all volumes from all backends
   */
  async list(filter?: VolumeListFilter): Promise<Volume[]> {
    const backends = filter?.backends || Array.from(this.adapters.keys());
    const results: Volume[] = [];
    const errors: string[] = [];

    // Fetch from all requested backends in parallel
    const promises = backends.map(async (backend) => {
      const adapter = this.adapters.get(backend);
      if (!adapter) {
        return { backend, volumes: [] };
      }

      try {
        const volumes = await adapter.list();
        return { backend, volumes };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${backend}: ${message}`);
        return { backend, volumes: [] };
      }
    });

    const adapterResults = await Promise.all(promises);

    for (const result of adapterResults) {
      results.push(...result.volumes);
    }

    // Apply filters
    let filtered = results;

    // Filter by status
    if (filter?.status && filter.status.length > 0) {
      filtered = filtered.filter((v) => filter.status!.includes(v.status));
    }

    // Filter by search term
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter((v) => v.name.toLowerCase().includes(search));
    }

    // Sort by creation date (newest first)
    filtered.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (errors.length > 0) {
      console.warn('[VolumeService] List errors:', errors);
    }

    return filtered;
  }

  /**
   * Get a specific volume by ID
   */
  async get(id: string): Promise<Volume | null> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      return null;
    }

    return adapter.get(id);
  }

  /**
   * Create a new volume
   */
  async create(request: CreateVolumeRequest): Promise<Volume> {
    // Auto-detect backend if not specified
    let backend = request.backend;

    if (!backend) {
      // Default to Docker for simple volumes, VM for sized volumes
      if (request.sizeGb) {
        backend = this.adapters.has('vm') ? 'vm' : 'docker';
      } else {
        backend = 'docker';
      }
    }

    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.create(request);
  }

  /**
   * Delete a volume
   */
  async delete(id: string): Promise<void> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.delete(id);
  }

  /**
   * List files in a volume
   */
  async listFiles(id: string, path: string = '/'): Promise<VolumeFileInfo[]> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.listFiles(id, path);
  }

  /**
   * Upload a file to a volume
   */
  async uploadFile(id: string, filename: string, content: Buffer, destPath: string = '/'): Promise<void> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.uploadFile(id, filename, content, destPath);
  }

  /**
   * Download a file from a volume
   */
  async downloadFile(id: string, filePath: string): Promise<Buffer> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.downloadFile(id, filePath);
  }

  /**
   * Delete a file from a volume
   */
  async deleteFile(id: string, filePath: string): Promise<void> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.deleteFile(id, filePath);
  }

  /**
   * Determine the backend type from a volume ID
   */
  private getBackendFromId(id: string): VolumeBackend {
    if (id.startsWith('vol-docker-')) {
      return 'docker';
    }
    if (id.startsWith('vol-vm-')) {
      return 'vm';
    }
    if (id.startsWith('vol-daytona-')) {
      return 'daytona';
    }
    // Default to docker for legacy IDs
    return 'docker';
  }

  /**
   * Check if a backend is available
   */
  hasBackend(backend: VolumeBackend): boolean {
    return this.adapters.has(backend);
  }
}

// Singleton instance
let volumeServiceInstance: VolumeService | null = null;

/**
 * Get or create the volume service singleton
 */
export function getVolumeService(): VolumeService {
  if (!volumeServiceInstance) {
    volumeServiceInstance = new VolumeService();
  }
  return volumeServiceInstance;
}

/**
 * Initialize the volume service
 */
export async function initializeVolumeService(): Promise<VolumeService> {
  const service = getVolumeService();
  await service.initialize();
  return service;
}

// Re-export types
export type { VolumeAdapter };
export { DockerVolumeAdapter } from './docker-adapter.js';
export { VmVolumeAdapter } from './vm-adapter.js';
export { DaytonaVolumeAdapter } from './daytona-adapter.js';
