/**
 * Docker Sandbox Adapter
 *
 * Converts Docker containers to the unified Sandbox abstraction.
 */

import type { SandboxAdapter } from './types.js';
import type {
  Sandbox,
  SandboxStatus,
  DockerMeta,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import type { ContainerInfo } from '../../types/index.js';
import * as docker from '../docker.js';
import { listBuilds, getBuild, type BuildStatus } from '../build-tracker.js';
import { findAvailableSshPort } from '../../utils/port.js';

/**
 * Maps Docker container state to unified SandboxStatus
 */
function mapContainerState(state: ContainerInfo['state']): SandboxStatus {
  switch (state) {
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'building':
      return 'building';
    case 'failed':
      return 'error';
    case 'created':
    case 'exited':
    case 'stopped':
    default:
      return 'stopped';
  }
}

/**
 * Extracts vCPU count from container (Docker doesn't expose this easily)
 * Returns a default value since Docker containers share host CPUs
 */
function getContainerVcpus(): number {
  return 1; // Default, Docker shares host CPUs
}

/**
 * Extracts memory from container (Docker doesn't expose this easily in list)
 * Returns a default value
 */
function getContainerMemoryMb(): number {
  return 1024; // Default 1GB
}

/**
 * Extracts disk size from container
 */
function getContainerDiskGb(): number {
  return 10; // Default 10GB
}

/**
 * Converts a Docker ContainerInfo to Sandbox
 */
function containerToSandbox(container: ContainerInfo): Sandbox {
  const meta: DockerMeta = {
    type: 'docker',
    containerId: container.id,
    volumes: container.volumes,
    dockerState: container.state,
  };

  // Generate docker exec command for direct container access
  // Use container name for more user-friendly command
  const shortId = container.id.substring(0, 12);
  const dockerExecCommand = `docker exec -it -u dev -w /home/dev/workspace ${container.name} /bin/bash`;

  return {
    id: `docker-${shortId}`,
    name: container.name,
    backend: 'docker',
    status: mapContainerState(container.state),

    // Resources
    vcpus: getContainerVcpus(),
    memoryMb: getContainerMemoryMb(),
    diskGb: getContainerDiskGb(),

    // Network
    ports: container.ports.map((p) => ({
      container: p.container,
      host: p.host,
      protocol: 'tcp',
    })),

    // Access
    terminalType: 'docker-exec',
    sshHost: container.sshPort ? 'localhost' : undefined,
    sshPort: container.sshPort ?? undefined,
    sshUser: container.sshPort ? 'root' : undefined,
    sshCommand: container.sshCommand ?? undefined,
    dockerExecCommand,
    sshKeyId: container.sshPort ? 'docker' : undefined,

    // Metadata
    image: container.image,
    createdAt: container.createdAt,

    backendMeta: meta,
  };
}

/**
 * Converts a build status to a pseudo-Sandbox
 */
function buildStatusToSandbox(buildId: string, status: BuildStatus): Sandbox {
  const meta: DockerMeta = {
    type: 'docker',
    containerId: '',
    volumes: [],
    buildId,
  };

  return {
    id: `docker-build-${buildId}`,
    name: status.name || buildId,
    backend: 'docker',
    status: status.status === 'failed' ? 'error' : 'building',
    error: status.error,

    // Resources (pending)
    vcpus: 1,
    memoryMb: 1024,
    diskGb: 10,

    // Network (pending)
    ports: [],

    // Access (not available during build)
    terminalType: 'docker-exec',

    // Metadata
    image: status.name || 'building...',
    createdAt: status.startedAt,

    backendMeta: meta,
  };
}

export class DockerAdapter implements SandboxAdapter {
  readonly backend = 'docker' as const;

  async isAvailable(): Promise<boolean> {
    try {
      // Try to list containers to verify Docker is accessible
      await docker.listContainers();
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<Sandbox[]> {
    const containers = await docker.listContainers();
    const sandboxes = containers.map(containerToSandbox);

    // Include in-progress builds as pseudo-sandboxes
    const builds = listBuilds();
    for (const buildStatus of builds) {
      if (buildStatus.status === 'building' || buildStatus.status === 'failed') {
        // Don't include if we already have the container
        const containerExists = containers.some(
          (c) => c.name === buildStatus.name
        );
        if (!containerExists) {
          sandboxes.push(buildStatusToSandbox(buildStatus.id, buildStatus));
        }
      }
    }

    return sandboxes;
  }

  async get(id: string): Promise<Sandbox | null> {
    // Handle build IDs
    if (id.startsWith('docker-build-')) {
      const buildId = id.replace('docker-build-', '');
      const status = getBuild(buildId);
      return status ? buildStatusToSandbox(buildId, status) : null;
    }

    // Strip the 'docker-' prefix to get the container ID
    const containerId = id.startsWith('docker-') ? id.slice(7) : id;

    const container = await docker.getContainer(containerId);
    return container ? containerToSandbox(container) : null;
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    // For Docker, we need either an image or a dockerfile
    if (!request.image && !request.dockerOptions?.dockerfile) {
      throw new Error('Docker sandbox requires either an image or dockerfile');
    }

    // If dockerfile is provided, we need to build first
    // For now, require an existing image - build support to be added
    if (!request.image) {
      throw new Error('Building from dockerfile not yet supported via sandbox API');
    }

    // Find an available SSH port
    const sshPort = await findAvailableSshPort();

    const container = await docker.createContainer({
      name: request.name,
      image: request.image,
      sshPort,
      volumes: request.dockerOptions?.volumes,
      ports: request.ports?.map((p) => ({
        container: p.container,
        host: p.host,
      })),
      env: request.dockerOptions?.env,
    });

    // Start the container
    await container.start();

    // Get the updated container info
    const info = await docker.getContainer(container.id);
    if (!info) {
      throw new Error('Failed to get container info after creation');
    }

    return containerToSandbox(info);
  }

  async start(id: string): Promise<Sandbox> {
    const containerId = id.startsWith('docker-') ? id.slice(7) : id;
    await docker.startContainer(containerId);

    const container = await docker.getContainer(containerId);
    if (!container) {
      throw new Error(`Container ${containerId} not found after start`);
    }

    return containerToSandbox(container);
  }

  async stop(id: string): Promise<Sandbox> {
    const containerId = id.startsWith('docker-') ? id.slice(7) : id;
    await docker.stopContainer(containerId);

    const container = await docker.getContainer(containerId);
    if (!container) {
      throw new Error(`Container ${containerId} not found after stop`);
    }

    return containerToSandbox(container);
  }

  async delete(id: string): Promise<void> {
    const containerId = id.startsWith('docker-') ? id.slice(7) : id;
    await docker.removeContainer(containerId);
  }
}
