/**
 * Unified Volume Types
 *
 * This module defines the unified "Volume" abstraction that encompasses
 * all storage backends: Docker volumes, VM ext4 block devices, and Daytona S3 volumes.
 */

export type VolumeBackend = 'docker' | 'vm' | 'daytona';
export type VolumeStatus = 'creating' | 'ready' | 'attached' | 'error' | 'deleting';

/**
 * Unified Volume interface
 */
export interface Volume {
  /** Prefixed ID: 'vol-docker-xxx', 'vol-vm-xxx', 'vol-daytona-xxx' */
  id: string;
  /** Display name */
  name: string;
  /** Backend type */
  backend: VolumeBackend;
  /** Current status */
  status: VolumeStatus;
  /** Maximum size in GB (for VM/Daytona) */
  sizeGb?: number;
  /** Actual used size in MB */
  actualSizeMb?: number;
  /** Default mount path */
  mountPath?: string;
  /** Sandboxes this volume is attached to */
  attachedTo: VolumeAttachment[];
  /** Creation timestamp (ISO string) */
  createdAt: string;
  /** Error message if status is 'error' */
  error?: string;
  /** Backend-specific metadata */
  backendMeta?: DockerVolumeMeta | VmVolumeMeta | DaytonaVolumeMeta;
}

/**
 * Volume attachment info
 */
export interface VolumeAttachment {
  sandboxId: string;
  sandboxName: string;
  mountPath: string;
}

/**
 * Docker-specific volume metadata
 */
export interface DockerVolumeMeta {
  type: 'docker';
  /** Docker volume driver */
  driver: string;
  /** Host mountpoint */
  mountpoint: string;
}

/**
 * VM-specific volume metadata
 */
export interface VmVolumeMeta {
  type: 'vm';
  /** Filesystem format */
  format: 'ext4' | 'xfs';
  /** Host path to the block device file */
  devicePath: string;
  /** Last attached timestamp */
  lastAttachedAt?: string;
}

/**
 * Daytona-specific volume metadata
 */
export interface DaytonaVolumeMeta {
  type: 'daytona';
  /** Daytona organization ID */
  organizationId: string;
  /** Daytona volume state */
  daytonaState?: string;
}

/**
 * Request to create a new volume
 */
export interface CreateVolumeRequest {
  /** Volume name */
  name: string;
  /** Backend to use (auto-detect if not specified) */
  backend?: VolumeBackend;
  /** Size in GB (for VM/Daytona) */
  sizeGb?: number;
  /** Filesystem format (for VM) */
  format?: 'ext4' | 'xfs';
  /** Default mount path */
  mountPath?: string;
}

/**
 * File info for volume file listing
 */
export interface VolumeFileInfo {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified?: string;
}

/**
 * Filter options for listing volumes
 */
export interface VolumeListFilter {
  /** Filter by backend types */
  backends?: VolumeBackend[];
  /** Filter by status */
  status?: VolumeStatus[];
  /** Search by name */
  search?: string;
}
