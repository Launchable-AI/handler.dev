/**
 * Unified Sandbox Types
 *
 * This module defines the unified "Sandbox" abstraction that encompasses
 * all compute environments: Docker containers, VMs (Cloud-Hypervisor, Firecracker),
 * and Daytona cloud workspaces.
 */

export type SandboxBackend = 'docker' | 'cloud-hypervisor' | 'firecracker' | 'daytona' | 'aws';

export type SandboxStatus =
  | 'creating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'paused'
  | 'error'
  | 'archived'
  | 'building'; // For Docker builds in progress

/**
 * Base sandbox interface - common fields across all backends
 */
export interface Sandbox {
  /** Prefixed ID: 'docker-xxx', 'vm-xxx', 'fc-xxx', 'daytona-xxx' */
  id: string;
  /** Display name */
  name: string;
  /** Backend type */
  backend: SandboxBackend;
  /** Current status */
  status: SandboxStatus;
  /** Error message if status is 'error' */
  error?: string;

  // Resources
  /** Number of virtual CPUs */
  vcpus: number;
  /** Memory in megabytes */
  memoryMb: number;
  /** Disk size in gigabytes */
  diskGb: number;

  // Network
  /** Port mappings */
  ports: PortMapping[];
  /** Guest IP address (VMs only) */
  guestIp?: string;

  // Access
  /** Terminal connection type */
  terminalType: 'ssh' | 'docker-exec';
  /** SSH host for connection */
  sshHost?: string;
  /** SSH port */
  sshPort?: number;
  /** SSH username */
  sshUser?: string;
  /** Full SSH command for connection */
  sshCommand?: string;
  /** Docker exec command (for Docker containers) */
  dockerExecCommand?: string;
  /** SSH key identifier for download */
  sshKeyId?: string;

  // Metadata
  /** Base image used */
  image: string;
  /** Creation timestamp (ISO string) */
  createdAt: string;
  /** Start timestamp (ISO string) */
  startedAt?: string;

  /** Backend-specific metadata */
  backendMeta?: DockerMeta | VmMeta | DaytonaMeta | AwsMeta;
}

export interface PortMapping {
  /** Container/guest port */
  container: number;
  /** Host port */
  host: number;
  /** Protocol (tcp/udp) */
  protocol?: string;
}

/**
 * Docker-specific metadata
 */
export interface DockerMeta {
  type: 'docker';
  /** Docker container ID */
  containerId: string;
  /** Mounted volumes */
  volumes: Array<{ name: string; mountPath: string }>;
  /** Container state from Docker */
  dockerState?: string;
  /** Build ID if currently building */
  buildId?: string;
}

/**
 * VM-specific metadata (Cloud-Hypervisor and Firecracker)
 */
export interface VmMeta {
  type: 'vm';
  /** Hypervisor type */
  hypervisor: 'cloud-hypervisor' | 'firecracker';
  /** Network mode */
  networkMode: string;
  /** Whether snapshots are available */
  hasSnapshots: boolean;
  /** TAP device name */
  tapDevice?: string;
  /** Boot time in milliseconds */
  bootTimeMs?: number;
  /** Attached volumes */
  volumes?: Array<{ id?: string; name: string; mountPath: string; sizeGb: number }>;
}

/**
 * Daytona-specific metadata
 */
export interface DaytonaMeta {
  type: 'daytona';
  /** Workspace size class */
  sizeClass: 'small' | 'medium' | 'large';
  /** Organization ID */
  organizationId: string;
  /** Daytona target/region */
  target: string;
  /** Workspace state from Daytona API */
  daytonaState?: string;
  /** SSH key for connection */
  sshKey?: string;
}

/**
 * AWS-specific metadata
 */
export interface AwsMeta {
  type: 'aws';
  /** EC2 Instance ID */
  instanceId: string;
  /** EC2 Instance type (e.g., t3.micro) */
  instanceType: string;
  /** Spot Instance request ID */
  spotRequestId?: string;
  /** EBS volume ID for persistent storage */
  volumeId?: string;
  /** Availability zone */
  availabilityZone: string;
  /** Public IP address */
  publicIp?: string;
  /** Private IP address */
  privateIp?: string;
  /** AWS region */
  region: string;
  /** EC2 instance state */
  ec2State?: string;
  /** Instance launch time */
  launchTime?: string;
  /** Security group ID */
  securityGroupId?: string;
  /** Subnet ID */
  subnetId?: string;
  /** VPC ID */
  vpcId?: string;
}

/**
 * Request to create a new sandbox
 */
export interface CreateSandboxRequest {
  /** Sandbox name */
  name: string;
  /** Backend to use */
  backend: SandboxBackend;
  /** Base image */
  image: string;

  // Resources (optional, uses backend defaults if not specified)
  /** Number of vCPUs */
  vcpus?: number;
  /** Memory in MB */
  memoryMb?: number;
  /** Disk size in GB */
  diskGb?: number;

  // Network
  /** Port mappings */
  ports?: PortMapping[];

  // Backend-specific options
  /** Docker-specific options */
  dockerOptions?: DockerCreateOptions;
  /** VM-specific options */
  vmOptions?: VmCreateOptions;
  /** Daytona-specific options */
  daytonaOptions?: DaytonaCreateOptions;
  /** AWS-specific options */
  awsOptions?: AwsCreateOptions;
  /** Agent config preset to inject after sandbox is running */
  agentConfigId?: string;
}

export interface DockerCreateOptions {
  /** Dockerfile content (if building) */
  dockerfile?: string;
  /** Volumes to mount */
  volumes?: Array<{ name: string; mountPath: string }>;
  /** Environment variables */
  env?: Record<string, string>;
  /** Whether to enable SSH access */
  enableSsh?: boolean;
}

export interface VmCreateOptions {
  /** Hypervisor type */
  hypervisor?: 'cloud-hypervisor' | 'firecracker';
  /** Network mode */
  networkMode?: 'bridged' | 'nat';
  /** Root filesystem path */
  rootfsPath?: string;
  /** Kernel path */
  kernelPath?: string;
  /** Init command */
  initCommand?: string;
  /** Volumes to attach */
  volumes?: Array<{ id: string; mountPath: string }>;
  /** User data script */
  userData?: string;
}

export interface DaytonaCreateOptions {
  /** Size class */
  sizeClass?: 'small' | 'medium' | 'large';
  /** Language/environment */
  language?: string;
  /** Target region */
  target?: string;
  /** Volumes to attach */
  volumes?: Array<{ name: string; mountPath: string }>;
}

export interface AwsCreateOptions {
  /** Size class preset (uses predefined instance types) */
  sizeClass?: 'small' | 'medium' | 'large';
  /** Use spot instances for cost savings, or on-demand for reliability (default: 'spot') */
  purchaseType?: 'spot' | 'on-demand';
  /** Override instance type (e.g., t3.large) */
  instanceType?: string;
  /** Custom AMI ID (uses region default if not specified) */
  amiId?: string;
  /** Existing EBS volume ID to attach */
  volumeId?: string;
  /** Size for new EBS volume in GB */
  volumeSizeGb?: number;
  /** Availability zone (uses region default if not specified) */
  availabilityZone?: string;
  /** Security group IDs */
  securityGroupIds?: string[];
  /** Subnet ID */
  subnetId?: string;
}

/**
 * Filter options for listing sandboxes
 */
export interface SandboxListFilter {
  /** Filter by backend types */
  backends?: SandboxBackend[];
  /** Filter by status */
  status?: SandboxStatus[];
  /** Search by name */
  search?: string;
}

/**
 * Response for sandbox list
 */
export interface SandboxListResponse {
  sandboxes: Sandbox[];
  /** Backend availability status */
  backends: {
    docker: boolean;
    'cloud-hypervisor': boolean;
    firecracker: boolean;
    daytona: boolean;
    aws: boolean;
  };
}
