/**
 * Virtual Machine Types for Cloud-Hypervisor Integration
 */

import { z } from 'zod';

export type VmStatus = 'creating' | 'booting' | 'running' | 'paused' | 'stopped' | 'error';

export type NetworkMode = 'tap' | 'bridge' | 'user' | 'none';

export type HypervisorType = 'cloud-hypervisor' | 'firecracker' | 'daytona';

export interface PortMapping {
  container: number;
  host: number;
  protocol?: 'tcp' | 'udp';
}

export interface VolumeMount {
  id?: string;
  name: string;
  hostPath: string;
  mountPath: string;
  readOnly?: boolean;
}

export interface ResourceConfig {
  vcpus: number; // 1-32 vCPUs
  memoryMb: number; // Memory in MB (512-65536)
  diskGb: number; // Virtual disk size in GB (1-1000)
}

export interface NetworkConfig {
  mode: NetworkMode;
  tapDevice?: string;
  bridgeName?: string;
  macAddress?: string;
  guestIp?: string;
  gateway?: string;
  dns?: string[];
}

export interface VmState {
  id: string;
  name: string;
  status: VmStatus;
  /** Which hypervisor manages this VM */
  hypervisor: HypervisorType;

  // Process info
  pid?: number;
  apiSocket?: string;

  // Network
  sshPort: number;
  guestIp?: string;
  networkConfig: NetworkConfig;
  portMappings: PortMapping[];

  // Resources
  baseImage: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;

  // Storage
  volumes: VolumeMount[];
  overlayPath?: string;

  // Snapshot source - if created from a snapshot, tracks the source for restore
  sourceSnapshot?: {
    vmId: string;
    snapshotId: string;
    snapshotDir: string;
  };

  // Timestamps
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;

  // Error handling
  error?: string;
}

export interface VmConfig {
  name: string;
  /** Which hypervisor to use (defaults to cloud-hypervisor) */
  hypervisor?: HypervisorType;
  baseImage?: string;
  // Launch from an existing snapshot for instant boot
  fromSnapshot?: {
    vmId: string;
    snapshotId: string;
  };
  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;
  portMappings?: PortMapping[];
  volumes?: VolumeMount[];
  networkMode?: NetworkMode;
  autoStart?: boolean;
}

export interface VmInfo {
  id: string;
  name: string;
  status: VmStatus;
  state: VmStatus; // Alias for UI compatibility
  /** Which hypervisor manages this VM */
  hypervisor: HypervisorType;

  // SSH access
  sshHost: string;
  sshPort: number;
  sshUser?: string;
  sshCommand?: string;

  // Network
  guestIp?: string;
  networkMode?: NetworkMode;
  ports: PortMapping[];
  volumes: VolumeMount[];

  // Resources
  image: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;

  // Timestamps
  createdAt: string;
  startedAt?: string;

  // Error
  error?: string;
}

export interface SnapshotInfo {
  id: string;
  vmId: string;
  baseImage: string;
  configPath: string;
  snapshotFile: string;
  memoryRanges: string[];
  createdAt: string;
  sizeBytes?: number;
  name?: string;
  isQuickLaunchDefault?: boolean;
}

export interface BaseImageInfo {
  name: string;
  virtualSizeGb: number;
  actualSizeMb: number;
  hasKernel: boolean;
  hasInitrd: boolean;
  hasWarmupSnapshot: boolean;
  createdAt: string;
  description?: string;
  parentImage?: string;
}

export interface VmStats {
  cpuUsage: number; // 0-100%
  memoryUsed: number; // MB
  memoryTotal: number; // MB
  diskUsed: number; // GB
  diskTotal: number; // GB
  networkRxBytes: number;
  networkTxBytes: number;
}

export interface HypervisorConfig {
  dataDir: string; // Base directory for VM data
  baseImagesDir: string; // Directory for base images
  sshKeysDir: string; // SSH keys directory
  hypervisorBinary: string; // Path to cloud-hypervisor binary
  kernelPath?: string; // Default kernel path
  initrdPath?: string; // Default initrd path
  sshPortRangeStart: number; // Start of SSH port range
  sshPortRangeEnd: number; // End of SSH port range
  defaultVcpus: number;
  defaultMemoryMb: number;
  defaultDiskGb: number;
  defaultBaseImage: string;
}

// Default configuration
export const DEFAULT_HYPERVISOR_CONFIG: HypervisorConfig = {
  dataDir: `${process.env.HOME}/.local/share/caisson/vms`,
  baseImagesDir: `${process.env.HOME}/.local/share/caisson/base-images`,
  sshKeysDir: `${process.env.HOME}/.local/share/caisson/ssh-keys`,
  hypervisorBinary: '/usr/bin/cloud-hypervisor',
  sshPortRangeStart: 10022,
  sshPortRangeEnd: 10122,
  defaultVcpus: 1,
  defaultMemoryMb: 1024,
  defaultDiskGb: 5,
  defaultBaseImage: 'ubuntu-24.04',
};

// Daytona sandbox size classes
export type DaytonaSizeClass = 'small' | 'medium' | 'large';

// Zod schemas for validation
export const CreateVmSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'VM name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
  hypervisor: z.enum(['cloud-hypervisor', 'firecracker', 'daytona']).optional(),
  baseImage: z.string().optional(),
  // Launch from an existing snapshot (provides instant boot with pre-configured environment)
  fromSnapshot: z.object({
    vmId: z.string(),
    snapshotId: z.string(),
  }).optional(),
  vcpus: z.number().min(1).max(32).optional(),
  memoryMb: z.number().min(512).max(65536).optional(),
  diskGb: z.number().min(1).max(1000).optional(),
  ports: z.array(z.object({
    container: z.number().min(1).max(65535),
    host: z.number().min(1).max(65535),
    protocol: z.enum(['tcp', 'udp']).optional(),
  })).optional(),
  volumes: z.array(z.object({
    name: z.string(),
    hostPath: z.string(),
    mountPath: z.string(),
    readOnly: z.boolean().optional(),
  })).optional(),
  autoStart: z.boolean().optional(),
  // Daytona-specific: size class (small, medium, large)
  daytonaSizeClass: z.enum(['small', 'medium', 'large']).optional(),
  // Daytona-specific: cloud volumes to mount
  daytonaVolumes: z.array(z.object({
    volumeId: z.string(),
    mountPath: z.string(),
    subpath: z.string().optional(),
  })).optional(),
});

export type CreateVmRequest = z.infer<typeof CreateVmSchema>;

// Warmup feature types
export type WarmupPhase =
  | 'idle'
  | 'starting'
  | 'booting'
  | 'waiting_for_boot'
  | 'pausing'
  | 'snapshotting'
  | 'complete'
  | 'error';

export interface WarmupStatus {
  baseImage: string;
  phase: WarmupPhase;
  progress: number; // 0-100
  message: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  vmId?: string; // ID of warmup VM (for logs access)
}

// Standalone VM Volume types
export interface VmVolume {
  id: string;
  name: string;
  sizeGb: number;
  actualSizeMb: number; // Actual disk usage (sparse file)
  format: 'ext4' | 'xfs';
  mountPath?: string; // Default mount path in VMs
  attachedTo?: string; // VM ID if currently attached
  attachedToVmName?: string; // User-defined VM name for display
  createdAt: string;
  lastAttachedAt?: string;
}

export interface VmVolumeInfo {
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
}

export const CreateVmVolumeSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Volume name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
  sizeGb: z.number().min(1).max(500).default(10),
  format: z.enum(['ext4', 'xfs']).default('ext4'),
  mountPath: z.string().optional(),
});

export type CreateVmVolumeRequest = z.infer<typeof CreateVmVolumeSchema>;
