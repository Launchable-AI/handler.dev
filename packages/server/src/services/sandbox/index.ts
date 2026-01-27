/**
 * Sandbox Service
 *
 * Unified service for managing all compute environments (Docker, VMs, Daytona)
 * through a single API. Routes requests to the appropriate backend adapter.
 */

import type { SandboxAdapter, AdapterResult } from './types.js';
import type {
  Sandbox,
  SandboxBackend,
  SandboxListFilter,
  SandboxListResponse,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import { DockerAdapter } from './docker-adapter.js';
import { CloudHypervisorAdapter, FirecrackerAdapter } from './vm-adapter.js';
import { DaytonaAdapter } from './daytona-adapter.js';
import { CloudHypervisorService } from '../hypervisor.js';
import { FirecrackerService } from '../firecracker.js';
import { DaytonaService } from '../daytona.js';

export class SandboxService {
  private adapters: Map<SandboxBackend, SandboxAdapter> = new Map();
  private initialized = false;

  // Service instances (lazily initialized)
  private hypervisorService: CloudHypervisorService | null = null;
  private firecrackerService: FirecrackerService | null = null;
  private daytonaService: DaytonaService | null = null;

  /**
   * Initialize the sandbox service with all available adapters
   */
  async initialize(options?: {
    hypervisor?: CloudHypervisorService;
    firecracker?: FirecrackerService;
    daytona?: DaytonaService;
  }): Promise<void> {
    if (this.initialized) return;

    console.log('[SandboxService] Initializing...');

    // Register Docker adapter (always available)
    const dockerAdapter = new DockerAdapter();
    if (await dockerAdapter.isAvailable()) {
      this.adapters.set('docker', dockerAdapter);
      console.log('[SandboxService] Docker adapter registered');
    }

    // Register Cloud-Hypervisor adapter
    if (options?.hypervisor) {
      this.hypervisorService = options.hypervisor;
      const chAdapter = new CloudHypervisorAdapter(options.hypervisor);
      if (await chAdapter.isAvailable()) {
        this.adapters.set('cloud-hypervisor', chAdapter);
        console.log('[SandboxService] Cloud-Hypervisor adapter registered');
      }
    }

    // Register Firecracker adapter
    if (options?.firecracker) {
      this.firecrackerService = options.firecracker;
      const fcAdapter = new FirecrackerAdapter(options.firecracker);
      if (await fcAdapter.isAvailable()) {
        this.adapters.set('firecracker', fcAdapter);
        console.log('[SandboxService] Firecracker adapter registered');
      }
    }

    // Register Daytona adapter
    if (options?.daytona) {
      this.daytonaService = options.daytona;
      const daytonaAdapter = new DaytonaAdapter(options.daytona);
      if (await daytonaAdapter.isAvailable()) {
        this.adapters.set('daytona', daytonaAdapter);
        console.log('[SandboxService] Daytona adapter registered');
      }
    }

    this.initialized = true;
    console.log(`[SandboxService] Initialized with ${this.adapters.size} adapters`);
  }

  /**
   * Get availability status for all backends
   */
  async getBackendStatus(): Promise<Record<SandboxBackend, boolean>> {
    const results: Record<SandboxBackend, boolean> = {
      docker: false,
      'cloud-hypervisor': false,
      firecracker: false,
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
   * List all sandboxes from all backends
   */
  async list(filter?: SandboxListFilter): Promise<SandboxListResponse> {
    const backends = filter?.backends || Array.from(this.adapters.keys());
    const results: Sandbox[] = [];
    const errors: string[] = [];

    // Fetch from all requested backends in parallel
    const promises = backends.map(async (backend) => {
      const adapter = this.adapters.get(backend);
      if (!adapter) {
        return { backend, sandboxes: [] };
      }

      try {
        const sandboxes = await adapter.list();
        return { backend, sandboxes };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${backend}: ${message}`);
        return { backend, sandboxes: [] };
      }
    });

    const adapterResults = await Promise.all(promises);

    for (const result of adapterResults) {
      results.push(...result.sandboxes);
    }

    // Apply filters
    let filtered = results;

    // Filter by status
    if (filter?.status && filter.status.length > 0) {
      filtered = filtered.filter((s) => filter.status!.includes(s.status));
    }

    // Filter by search term
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(search) ||
          s.image.toLowerCase().includes(search)
      );
    }

    // Sort by creation date (newest first)
    filtered.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Get backend availability
    const backendStatus = await this.getBackendStatus();

    if (errors.length > 0) {
      console.warn('[SandboxService] List errors:', errors);
    }

    return {
      sandboxes: filtered,
      backends: backendStatus,
    };
  }

  /**
   * Get a specific sandbox by ID
   */
  async get(id: string): Promise<Sandbox | null> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      return null;
    }

    return adapter.get(id);
  }

  /**
   * Create a new sandbox
   */
  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    const adapter = this.adapters.get(request.backend);

    if (!adapter) {
      throw new Error(`Backend '${request.backend}' is not available`);
    }

    return adapter.create(request);
  }

  /**
   * Start a sandbox
   */
  async start(id: string): Promise<Sandbox> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.start(id);
  }

  /**
   * Stop a sandbox
   */
  async stop(id: string): Promise<Sandbox> {
    const backend = this.getBackendFromId(id);
    const adapter = this.adapters.get(backend);

    if (!adapter) {
      throw new Error(`Backend '${backend}' is not available`);
    }

    return adapter.stop(id);
  }

  /**
   * Delete a sandbox
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
   * Rename a sandbox (supported for Docker and Firecracker)
   */
  async rename(id: string, newName: string): Promise<Sandbox> {
    const backend = this.getBackendFromId(id);

    if (backend === 'firecracker') {
      if (!this.firecrackerService) {
        throw new Error('Firecracker service is not available');
      }
      // Firecracker VMs are stored with the full ID including 'fc-' prefix
      this.firecrackerService.renameVm(id, newName);
    } else if (backend === 'docker') {
      // Docker containers can be renamed
      const dockerService = await import('../docker.js');
      const containerId = id.replace(/^docker-/, '');
      await dockerService.renameContainer(containerId, newName);
    } else {
      throw new Error(`Renaming is not supported for ${backend} sandboxes`);
    }

    // Return updated sandbox
    const result = await this.get(id);
    if (!result) {
      throw new Error(`Sandbox ${id} not found after rename`);
    }
    return result;
  }

  /**
   * Determine the backend type from a sandbox ID
   */
  private getBackendFromId(id: string): SandboxBackend {
    if (id.startsWith('docker-')) {
      return 'docker';
    }
    if (id.startsWith('fc-')) {
      return 'firecracker';
    }
    if (id.startsWith('daytona-')) {
      return 'daytona';
    }
    // Default to cloud-hypervisor for 'vm-' prefix or unknown
    return 'cloud-hypervisor';
  }

  /**
   * Get the registered adapter for a backend
   */
  getAdapter(backend: SandboxBackend): SandboxAdapter | undefined {
    return this.adapters.get(backend);
  }

  /**
   * Check if a backend is available
   */
  hasBackend(backend: SandboxBackend): boolean {
    return this.adapters.has(backend);
  }

  /**
   * Get the underlying hypervisor service (for VM-specific operations)
   */
  getHypervisorService(): CloudHypervisorService | null {
    return this.hypervisorService;
  }

  /**
   * Get the underlying firecracker service (for VM-specific operations)
   */
  getFirecrackerService(): FirecrackerService | null {
    return this.firecrackerService;
  }

  /**
   * Get the underlying daytona service (for cloud-specific operations)
   */
  getDaytonaService(): DaytonaService | null {
    return this.daytonaService;
  }
}

// Singleton instance
let sandboxServiceInstance: SandboxService | null = null;

/**
 * Get or create the sandbox service singleton
 */
export function getSandboxService(): SandboxService {
  if (!sandboxServiceInstance) {
    sandboxServiceInstance = new SandboxService();
  }
  return sandboxServiceInstance;
}

/**
 * Initialize the sandbox service with dependencies
 */
export async function initializeSandboxService(options?: {
  hypervisor?: CloudHypervisorService;
  firecracker?: FirecrackerService;
  daytona?: DaytonaService;
}): Promise<SandboxService> {
  const service = getSandboxService();
  await service.initialize(options);
  return service;
}

// Re-export types
export type { SandboxAdapter, SandboxServiceConfig, AdapterResult } from './types.js';
export { DockerAdapter } from './docker-adapter.js';
export { CloudHypervisorAdapter, FirecrackerAdapter } from './vm-adapter.js';
export { DaytonaAdapter } from './daytona-adapter.js';
