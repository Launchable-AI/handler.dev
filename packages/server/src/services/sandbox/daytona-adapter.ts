/**
 * Daytona Sandbox Adapter
 *
 * Converts Daytona cloud workspaces to the unified Sandbox abstraction.
 */

import type { SandboxAdapter } from './types.js';
import type {
  Sandbox,
  SandboxStatus,
  DaytonaMeta,
  CreateSandboxRequest,
} from '../../types/sandbox.js';
import {
  DaytonaService,
  type DaytonaWorkspace,
  type DaytonaSandboxState,
  DAYTONA_SIZE_PRESETS,
} from '../daytona.js';

/**
 * Maps Daytona sandbox state to unified SandboxStatus
 */
function mapDaytonaState(state: DaytonaSandboxState): SandboxStatus {
  switch (state) {
    case 'creating':
      return 'creating';
    case 'starting':
    case 'unarchiving':
      return 'starting';
    case 'started':
      return 'running';
    case 'stopping':
      return 'stopping';
    case 'stopped':
      return 'stopped';
    case 'archiving':
    case 'archived':
      return 'archived';
    case 'build_failed':
    case 'error':
      return 'error';
    case 'destroying':
    case 'destroyed':
      return 'stopped';
    default:
      return 'stopped';
  }
}

/**
 * Converts a Daytona workspace to Sandbox
 */
function workspaceToSandbox(workspace: DaytonaWorkspace): Sandbox {
  const sizeClass = (workspace.class || 'small') as 'small' | 'medium' | 'large';
  const language = workspace.labels?.['code-toolbox-language'] || 'python';
  const sshUser = workspace.user || 'daytona';

  const meta: DaytonaMeta = {
    type: 'daytona',
    sizeClass,
    organizationId: workspace.organizationId,
    target: workspace.target,
    daytonaState: workspace.state,
  };

  // Determine image display - show snapshot if available, otherwise show size/language
  let imageDisplay = `daytona-${sizeClass} (${language})`;
  if (workspace.snapshot) {
    // Extract clean name from snapshot (remove registry path and tags)
    let snapshotName = workspace.snapshot;
    if (snapshotName.includes('/')) {
      snapshotName = snapshotName.split('/').pop() || snapshotName;
    }
    if (snapshotName.includes(':')) {
      snapshotName = snapshotName.split(':')[0];
    }
    imageDisplay = snapshotName;
  }

  return {
    id: `daytona-${workspace.id}`,
    name: workspace.name,
    backend: 'daytona',
    status: mapDaytonaState(workspace.state),
    error: workspace.errorReason,

    // Resources
    vcpus: workspace.cpu || DAYTONA_SIZE_PRESETS[sizeClass].cpu,
    memoryMb: (workspace.memory || DAYTONA_SIZE_PRESETS[sizeClass].memory) * 1024, // GB to MB
    diskGb: workspace.disk || DAYTONA_SIZE_PRESETS[sizeClass].disk,

    // Network - Daytona workspaces don't expose port mappings the same way
    ports: [],
    guestIp: workspace.sshHost,

    // Access - Daytona uses SSH
    terminalType: 'ssh',
    sshHost: workspace.sshHost,
    sshPort: workspace.sshPort || 22,
    sshUser,
    sshCommand: workspace.sshHost
      ? `ssh -p ${workspace.sshPort || 22} ${sshUser}@${workspace.sshHost}`
      : undefined,

    // Metadata
    image: imageDisplay,
    createdAt: workspace.createdAt,
    startedAt: workspace.startedAt,

    backendMeta: meta,
  };
}

export class DaytonaAdapter implements SandboxAdapter {
  readonly backend = 'daytona' as const;

  constructor(private daytona: DaytonaService) {}

  async isAvailable(): Promise<boolean> {
    return this.daytona.isAvailable();
  }

  async list(): Promise<Sandbox[]> {
    try {
      const workspaces = await this.daytona.listWorkspaces();
      return workspaces.map(workspaceToSandbox);
    } catch (error) {
      console.error('[DaytonaAdapter] Failed to list workspaces:', error);
      return [];
    }
  }

  async get(id: string): Promise<Sandbox | null> {
    // Strip the 'daytona-' prefix to get the workspace ID
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;

    try {
      const workspace = await this.daytona.getWorkspace(workspaceId);
      return workspace ? workspaceToSandbox(workspace) : null;
    } catch {
      return null;
    }
  }

  async create(request: CreateSandboxRequest): Promise<Sandbox> {
    // Determine size class from resources or options
    let sizeClass: 'small' | 'medium' | 'large' = 'small';

    if (request.daytonaOptions?.sizeClass) {
      sizeClass = request.daytonaOptions.sizeClass;
    } else if (request.vcpus && request.memoryMb) {
      // Infer size class from resources
      if (request.vcpus >= 4 || request.memoryMb >= 8192) {
        sizeClass = 'large';
      } else if (request.vcpus >= 2 || request.memoryMb >= 4096) {
        sizeClass = 'medium';
      }
    }

    // Determine snapshot to use from the image field
    // The image can be a snapshot name, or left to use Daytona defaults
    let snapshot: string | undefined;
    if (request.image && !request.image.startsWith('ubuntu:') && !request.image.startsWith('debian:')) {
      // Use the selected snapshot - the image field contains the snapshot name for Daytona
      snapshot = request.image;
    }

    const workspace = await this.daytona.createWorkspace({
      name: request.name,
      snapshot,
      language: request.daytonaOptions?.language as 'python' | 'typescript' | 'javascript',
      sizeClass,
      volumes: request.daytonaOptions?.volumes?.map((v) => ({
        volumeId: v.name,
        mountPath: v.mountPath,
      })),
    });

    return workspaceToSandbox(workspace);
  }

  async start(id: string): Promise<Sandbox> {
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
    const workspace = await this.daytona.startWorkspace(workspaceId);
    return workspaceToSandbox(workspace);
  }

  async stop(id: string): Promise<Sandbox> {
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
    const workspace = await this.daytona.stopWorkspace(workspaceId);
    return workspaceToSandbox(workspace);
  }

  async delete(id: string): Promise<void> {
    const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
    await this.daytona.deleteWorkspace(workspaceId);
  }
}
