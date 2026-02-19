/**
 * AWS EC2 Backend Service
 *
 * Integrates with AWS EC2 for cloud-based spot instances as sandboxes.
 * Supports persistent EBS volumes for state preservation across stop/start cycles.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  CreateKeyPairCommand,
  DescribeKeyPairsCommand,
  DeleteKeyPairCommand,
  CreateVolumeCommand,
  AttachVolumeCommand,
  DetachVolumeCommand,
  DeleteVolumeCommand,
  DescribeVolumesCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeImagesCommand,
  CreateTagsCommand,
  waitUntilInstanceRunning,
  waitUntilInstanceStopped,
  waitUntilVolumeAvailable,
  type Instance,
  type Volume,
  type Reservation,
  type SecurityGroup,
  type _InstanceType,
} from '@aws-sdk/client-ec2';
import { getConfig, setConfig } from './config.js';
import { PROJECT_ROOT } from '../lib/paths.js';

// Path to store SSH keys (same location as Docker containers use)
const SSH_KEYS_DIR = join(PROJECT_ROOT, 'data', 'ssh-keys');
const AWS_SSH_KEY_NAME = 'handler-key';
export const AWS_SSH_KEY_PATH = join(SSH_KEYS_DIR, `${AWS_SSH_KEY_NAME}.pem`);

// EC2 instance states
export type Ec2InstanceState =
  | 'pending'
  | 'running'
  | 'shutting-down'
  | 'terminated'
  | 'stopping'
  | 'stopped';

// Size class presets
export type AwsSizeClass = 'small' | 'medium' | 'large';

export const AWS_SIZE_PRESETS: Record<AwsSizeClass, {
  instanceType: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
}> = {
  small: { instanceType: 't3.micro', vcpus: 2, memoryMb: 1024, diskGb: 8 },
  medium: { instanceType: 't3.medium', vcpus: 2, memoryMb: 4096, diskGb: 20 },
  large: { instanceType: 't3.large', vcpus: 2, memoryMb: 8192, diskGb: 30 },
};

// Default AMIs per region (Ubuntu 24.04 LTS)
export const DEFAULT_AMIS: Record<string, string> = {
  'us-east-1': 'ami-0c7217cdde317cfec',
  'us-east-2': 'ami-0e83be366243f524a',
  'us-west-1': 'ami-0ce2cb35386fc22e9',
  'us-west-2': 'ami-0aff18ec83b712f05',
  'eu-west-1': 'ami-0905a3c97561e0b69',
  'eu-west-2': 'ami-0e5f882be1900e43b',
  'eu-central-1': 'ami-0faab6bdbac9486fb',
  'ap-southeast-1': 'ami-0497a974f8d5dcef8',
  'ap-southeast-2': 'ami-0df4b2961410d4cff',
  'ap-northeast-1': 'ami-0d52744d6551d851e',
};

// Available regions
export const AWS_REGIONS = [
  { id: 'us-east-1', name: 'US East (N. Virginia)' },
  { id: 'us-east-2', name: 'US East (Ohio)' },
  { id: 'us-west-1', name: 'US West (N. California)' },
  { id: 'us-west-2', name: 'US West (Oregon)' },
  { id: 'eu-west-1', name: 'EU (Ireland)' },
  { id: 'eu-west-2', name: 'EU (London)' },
  { id: 'eu-central-1', name: 'EU (Frankfurt)' },
  { id: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
  { id: 'ap-southeast-2', name: 'Asia Pacific (Sydney)' },
  { id: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)' },
];

export interface AwsInstance {
  instanceId: string;
  name: string;
  state: Ec2InstanceState;
  instanceType: string;
  publicIp?: string;
  privateIp?: string;
  availabilityZone: string;
  launchTime?: Date;
  spotRequestId?: string;
  volumeId?: string;
  vpcId?: string;
  subnetId?: string;
  securityGroupId?: string;
  tags: Record<string, string>;
}

export interface CreateAwsInstanceRequest {
  name: string;
  sizeClass?: AwsSizeClass;
  purchaseType?: 'spot' | 'on-demand';
  instanceType?: string;
  amiId?: string;
  volumeId?: string;
  volumeSizeGb?: number;
  availabilityZone?: string;
  subnetId?: string;
  securityGroupIds?: string[];
  userData?: string;
}

// User data script for instance bootstrap
const DEFAULT_USER_DATA = `#!/bin/bash
# Update and install essentials
apt-get update && apt-get install -y git curl vim

# Mount persistent volume if attached
if [ -b /dev/xvdf ]; then
  # Check if volume needs formatting
  if ! blkid /dev/xvdf; then
    mkfs.ext4 /dev/xvdf
  fi
  mkdir -p /data
  mount /dev/xvdf /data

  # Add to fstab for persistence
  if ! grep -q '/dev/xvdf' /etc/fstab; then
    echo '/dev/xvdf /data ext4 defaults,nofail 0 2' >> /etc/fstab
  fi

  # Symlink important directories
  mkdir -p /data/.claude /data/workspace
  ln -sf /data/.claude /home/ubuntu/.claude
  ln -sf /data/workspace /home/ubuntu/workspace
  chown -R ubuntu:ubuntu /data /home/ubuntu/.claude /home/ubuntu/workspace
fi

# Signal ready (create marker file)
touch /tmp/handler-ready
`;

export class AwsService {
  private client: EC2Client | null = null;
  private region: string = 'us-east-1';
  private initialized: boolean = false;

  // Cache for instances
  private instancesCache: AwsInstance[] = [];
  private instancesCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 15 * 1000; // 15 seconds

  /**
   * Initialize the AWS service with config
   */
  async initialize(): Promise<void> {
    const config = await getConfig();
    const aws = config.cloudBackends?.aws;

    if (!aws?.accessKeyId || !aws?.secretAccessKey) {
      throw new Error('AWS credentials not configured');
    }

    this.region = aws.region || 'us-east-1';
    this.client = new EC2Client({
      region: this.region,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
      },
    });
    this.initialized = true;

    console.log('[AwsService] Initialized with region:', this.region);
  }

  /**
   * Check if the service is initialized and enabled
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await getConfig();
      const aws = config.cloudBackends?.aws;
      return !!(aws?.accessKeyId && aws?.secretAccessKey && aws?.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Get the EC2 client, initializing if needed
   */
  private async getClient(): Promise<EC2Client> {
    if (!this.initialized || !this.client) {
      await this.initialize();
    }
    return this.client!;
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const client = await this.getClient();
      const command = new DescribeInstancesCommand({ MaxResults: 5 });
      await client.send(command);
      return { success: true, message: 'Connection successful' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  /**
   * Check if the cache is still valid
   */
  private isCacheValid(): boolean {
    return Date.now() - this.instancesCacheTime < AwsService.CACHE_TTL_MS;
  }

  /**
   * Invalidate the instance cache
   */
  invalidateCache(): void {
    this.instancesCacheTime = 0;
    this.instancesCache = [];
    console.log('[AwsService] Cache invalidated');
  }

  /**
   * Convert EC2 Instance to AwsInstance
   */
  private instanceToAwsInstance(instance: Instance): AwsInstance {
    const tags: Record<string, string> = {};
    for (const tag of instance.Tags || []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    // Find attached volume with handler tag
    let volumeId: string | undefined;
    for (const mapping of instance.BlockDeviceMappings || []) {
      if (mapping.DeviceName === '/dev/xvdf' || mapping.DeviceName === '/dev/sdf') {
        volumeId = mapping.Ebs?.VolumeId;
        break;
      }
    }

    return {
      instanceId: instance.InstanceId || '',
      name: tags['Name'] || tags['handler:name'] || instance.InstanceId || '',
      state: (instance.State?.Name as Ec2InstanceState) || 'pending',
      instanceType: instance.InstanceType || 't3.micro',
      publicIp: instance.PublicIpAddress,
      privateIp: instance.PrivateIpAddress,
      availabilityZone: instance.Placement?.AvailabilityZone || '',
      launchTime: instance.LaunchTime,
      spotRequestId: instance.SpotInstanceRequestId,
      volumeId,
      vpcId: instance.VpcId,
      subnetId: instance.SubnetId,
      securityGroupId: instance.SecurityGroups?.[0]?.GroupId,
      tags,
    };
  }

  /**
   * List all Handler-managed instances
   */
  async listInstances(forceRefresh: boolean = false): Promise<AwsInstance[]> {
    if (!forceRefresh && this.isCacheValid() && this.instancesCache.length > 0) {
      console.log('[AwsService] Returning cached instances');
      return this.instancesCache;
    }

    try {
      const client = await this.getClient();
      const command = new DescribeInstancesCommand({
        Filters: [
          { Name: 'tag:handler', Values: ['true'] },
          { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
        ],
      });

      const response = await client.send(command);
      const instances: AwsInstance[] = [];

      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          instances.push(this.instanceToAwsInstance(instance));
        }
      }

      this.instancesCache = instances;
      this.instancesCacheTime = Date.now();
      console.log('[AwsService] Fetched fresh instances:', instances.length);
      return instances;
    } catch (err) {
      console.error('[AwsService] Failed to list instances:', err);
      if (this.instancesCache.length > 0) {
        console.log('[AwsService] Returning stale cache on error');
        return this.instancesCache;
      }
      return [];
    }
  }

  /**
   * Get a specific instance
   */
  async getInstance(instanceId: string): Promise<AwsInstance | null> {
    try {
      const client = await this.getClient();
      const command = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });

      const response = await client.send(command);
      const instance = response.Reservations?.[0]?.Instances?.[0];
      return instance ? this.instanceToAwsInstance(instance) : null;
    } catch {
      return null;
    }
  }

  /**
   * Ensure SSH key pair exists
   */
  async ensureSshKeyPair(): Promise<{ keyName: string; privateKey?: string }> {
    const config = await getConfig();
    const aws = config.cloudBackends?.aws;
    const keyName = AWS_SSH_KEY_NAME;

    // Migrate key from config to file if it exists in config but not as file
    if (!existsSync(AWS_SSH_KEY_PATH) && aws?.sshPrivateKey) {
      console.log('[AwsService] Migrating SSH key from config to file:', AWS_SSH_KEY_PATH);
      await mkdir(SSH_KEYS_DIR, { recursive: true });
      await writeFile(AWS_SSH_KEY_PATH, aws.sshPrivateKey, { mode: 0o600 });
    }

    // If we already have the key file stored locally, just verify it exists in AWS
    if (existsSync(AWS_SSH_KEY_PATH)) {
      try {
        const client = await this.getClient();
        const describeCommand = new DescribeKeyPairsCommand({
          KeyNames: [keyName],
        });
        await client.send(describeCommand);
        console.log('[AwsService] Key pair exists:', keyName);
        return { keyName };
      } catch {
        // Key doesn't exist in AWS but we have it locally - it may have been deleted
        // We'll need to recreate it
        console.log('[AwsService] Key exists locally but not in AWS, will recreate');
      }
    }

    try {
      const client = await this.getClient();

      // Check if key pair already exists in AWS
      const describeCommand = new DescribeKeyPairsCommand({
        KeyNames: [keyName],
      });

      try {
        await client.send(describeCommand);
        // Key exists in AWS but we don't have the private key locally
        console.log('[AwsService] Key pair exists in AWS but not locally:', keyName);
        console.log('[AwsService] You may need to delete the key in AWS and recreate it');
        return { keyName };
      } catch {
        // Key doesn't exist, create it
      }

      // Create new key pair
      const createCommand = new CreateKeyPairCommand({
        KeyName: keyName,
        KeyType: 'ed25519',
        TagSpecifications: [
          {
            ResourceType: 'key-pair',
            Tags: [{ Key: 'handler', Value: 'true' }],
          },
        ],
      });

      const response = await client.send(createCommand);
      const privateKey = response.KeyMaterial;

      if (privateKey) {
        // Store the private key in the ssh-keys directory
        await mkdir(SSH_KEYS_DIR, { recursive: true });
        await writeFile(AWS_SSH_KEY_PATH, privateKey, { mode: 0o600 });

        // Also update config to record that we have the key
        await setConfig({
          cloudBackends: {
            ...config.cloudBackends,
            aws: {
              ...aws!,
              sshKeyName: keyName,
              // Remove any old key stored in config
              sshPrivateKey: undefined,
            },
          },
        });
        console.log('[AwsService] Created new key pair and saved to:', AWS_SSH_KEY_PATH);
        return { keyName, privateKey };
      }

      return { keyName };
    } catch (err) {
      console.error('[AwsService] Failed to ensure SSH key pair:', err);
      throw err;
    }
  }

  /**
   * Get or create a security group for Handler instances
   */
  async ensureSecurityGroup(): Promise<string> {
    const client = await this.getClient();
    const sgName = 'handler-sandbox-sg';

    try {
      // Check if security group exists
      const describeCommand = new DescribeSecurityGroupsCommand({
        GroupNames: [sgName],
      });

      const response = await client.send(describeCommand);
      if (response.SecurityGroups?.[0]?.GroupId) {
        return response.SecurityGroups[0].GroupId;
      }
    } catch {
      // Security group doesn't exist, create it
    }

    // Get default VPC
    const vpcsCommand = new DescribeVpcsCommand({
      Filters: [{ Name: 'isDefault', Values: ['true'] }],
    });
    const vpcsResponse = await client.send(vpcsCommand);
    const vpcId = vpcsResponse.Vpcs?.[0]?.VpcId;

    if (!vpcId) {
      throw new Error('No default VPC found. Please specify a VPC ID in settings.');
    }

    // Create security group
    const createCommand = new CreateSecurityGroupCommand({
      GroupName: sgName,
      Description: 'Security group for Handler sandbox instances',
      VpcId: vpcId,
      TagSpecifications: [
        {
          ResourceType: 'security-group',
          Tags: [{ Key: 'handler', Value: 'true' }],
        },
      ],
    });

    const createResponse = await client.send(createCommand);
    const groupId = createResponse.GroupId!;

    // Add SSH ingress rule
    const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH access' }],
        },
      ],
    });

    await client.send(authorizeCommand);
    console.log('[AwsService] Created security group:', groupId);

    return groupId;
  }

  /**
   * Create a new EC2 instance (spot or on-demand)
   */
  async createInstance(request: CreateAwsInstanceRequest): Promise<AwsInstance> {
    const client = await this.getClient();
    const config = await getConfig();
    const aws = config.cloudBackends?.aws;

    // Determine instance type
    const sizeClass = request.sizeClass || 'small';
    const instanceType = request.instanceType || AWS_SIZE_PRESETS[sizeClass].instanceType;

    // Get AMI
    const amiId = request.amiId || DEFAULT_AMIS[this.region];
    if (!amiId) {
      throw new Error(`No default AMI for region ${this.region}. Please specify an AMI ID.`);
    }

    // Ensure key pair exists
    const { keyName } = await this.ensureSshKeyPair();

    // Ensure security group exists
    const securityGroupId = await this.ensureSecurityGroup();

    // Build user data script
    const userData = Buffer.from(request.userData || DEFAULT_USER_DATA).toString('base64');

    // Create the instance
    const runCommand = new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: instanceType as _InstanceType,
      KeyName: keyName,
      MinCount: 1,
      MaxCount: 1,
      SecurityGroupIds: request.securityGroupIds || [securityGroupId],
      SubnetId: request.subnetId || aws?.defaultSubnetId,
      UserData: userData,
      ...(request.purchaseType !== 'on-demand' ? {
        InstanceMarketOptions: {
          MarketType: 'spot' as const,
          SpotOptions: {
            SpotInstanceType: 'persistent' as const,
            InstanceInterruptionBehavior: 'stop' as const,
          },
        },
      } : {}),
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/sda1',
          Ebs: {
            VolumeSize: request.volumeSizeGb || AWS_SIZE_PRESETS[sizeClass].diskGb,
            VolumeType: 'gp3',
            DeleteOnTermination: true,
          },
        },
      ],
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            { Key: 'Name', Value: request.name },
            { Key: 'handler', Value: 'true' },
            { Key: 'handler:name', Value: request.name },
            { Key: 'handler:sizeClass', Value: sizeClass },
          ],
        },
      ],
    });

    console.log('[AwsService] Creating spot instance:', request.name);
    const response = await client.send(runCommand);
    const instance = response.Instances?.[0];

    if (!instance?.InstanceId) {
      throw new Error('Failed to create instance');
    }

    this.invalidateCache();

    // Attach existing volume if specified
    if (request.volumeId) {
      await this.attachVolume(instance.InstanceId, request.volumeId);
    }

    return this.instanceToAwsInstance(instance);
  }

  /**
   * Start a stopped instance
   */
  async startInstance(instanceId: string): Promise<AwsInstance> {
    const client = await this.getClient();

    const command = new StartInstancesCommand({
      InstanceIds: [instanceId],
    });

    await client.send(command);
    console.log('[AwsService] Starting instance:', instanceId);

    // Wait for instance to be running
    await waitUntilInstanceRunning(
      { client, maxWaitTime: 300 },
      { InstanceIds: [instanceId] }
    );

    this.invalidateCache();
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found after start`);
    }
    return instance;
  }

  /**
   * Stop a running instance
   */
  async stopInstance(instanceId: string): Promise<AwsInstance> {
    const client = await this.getClient();

    const command = new StopInstancesCommand({
      InstanceIds: [instanceId],
    });

    await client.send(command);
    console.log('[AwsService] Stopping instance:', instanceId);

    // Wait for instance to be stopped
    await waitUntilInstanceStopped(
      { client, maxWaitTime: 300 },
      { InstanceIds: [instanceId] }
    );

    this.invalidateCache();
    const instance = await this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found after stop`);
    }
    return instance;
  }

  /**
   * Terminate an instance
   */
  async terminateInstance(instanceId: string): Promise<void> {
    const client = await this.getClient();

    const command = new TerminateInstancesCommand({
      InstanceIds: [instanceId],
    });

    await client.send(command);
    console.log('[AwsService] Terminated instance:', instanceId);
    this.invalidateCache();
  }

  /**
   * Create an EBS volume
   */
  async createVolume(sizeGb: number, name: string, availabilityZone?: string): Promise<string> {
    const client = await this.getClient();

    // Default to first AZ in the region
    const az = availabilityZone || `${this.region}a`;

    const command = new CreateVolumeCommand({
      AvailabilityZone: az,
      Size: sizeGb,
      VolumeType: 'gp3',
      TagSpecifications: [
        {
          ResourceType: 'volume',
          Tags: [
            { Key: 'Name', Value: name },
            { Key: 'handler', Value: 'true' },
            { Key: 'handler:name', Value: name },
          ],
        },
      ],
    });

    const response = await client.send(command);
    const volumeId = response.VolumeId!;

    // Wait for volume to be available
    await waitUntilVolumeAvailable(
      { client, maxWaitTime: 120 },
      { VolumeIds: [volumeId] }
    );

    console.log('[AwsService] Created volume:', volumeId);
    return volumeId;
  }

  /**
   * Attach a volume to an instance
   */
  async attachVolume(instanceId: string, volumeId: string): Promise<void> {
    const client = await this.getClient();

    const command = new AttachVolumeCommand({
      InstanceId: instanceId,
      VolumeId: volumeId,
      Device: '/dev/xvdf',
    });

    await client.send(command);
    console.log('[AwsService] Attached volume:', volumeId, 'to', instanceId);
  }

  /**
   * Detach a volume from an instance
   */
  async detachVolume(volumeId: string): Promise<void> {
    const client = await this.getClient();

    const command = new DetachVolumeCommand({
      VolumeId: volumeId,
    });

    await client.send(command);
    console.log('[AwsService] Detached volume:', volumeId);
  }

  /**
   * Delete a volume
   */
  async deleteVolume(volumeId: string): Promise<void> {
    const client = await this.getClient();

    const command = new DeleteVolumeCommand({
      VolumeId: volumeId,
    });

    await client.send(command);
    console.log('[AwsService] Deleted volume:', volumeId);
  }

  /**
   * List Handler-managed volumes
   */
  async listVolumes(): Promise<Volume[]> {
    const client = await this.getClient();

    const command = new DescribeVolumesCommand({
      Filters: [
        { Name: 'tag:handler', Values: ['true'] },
      ],
    });

    const response = await client.send(command);
    return response.Volumes || [];
  }

  /**
   * Get SSH command for an instance
   */
  async getSshCommand(instanceId: string): Promise<string | null> {
    const instance = await this.getInstance(instanceId);
    if (!instance || !instance.publicIp) {
      return null;
    }

    return `ssh -i ${AWS_SSH_KEY_PATH} ubuntu@${instance.publicIp}`;
  }

  /**
   * Get the SSH private key
   */
  async getSshPrivateKey(): Promise<string | null> {
    // First try to read from file
    if (existsSync(AWS_SSH_KEY_PATH)) {
      try {
        return await readFile(AWS_SSH_KEY_PATH, 'utf-8');
      } catch {
        // Fall through to config
      }
    }
    // Fallback to config for backwards compatibility
    const config = await getConfig();
    const keyFromConfig = config.cloudBackends?.aws?.sshPrivateKey;

    // Migrate key from config to file if found
    if (keyFromConfig && !existsSync(AWS_SSH_KEY_PATH)) {
      try {
        await mkdir(SSH_KEYS_DIR, { recursive: true });
        await writeFile(AWS_SSH_KEY_PATH, keyFromConfig, { mode: 0o600 });
        console.log('[AwsService] Migrated SSH key to file:', AWS_SSH_KEY_PATH);
      } catch (err) {
        console.error('[AwsService] Failed to migrate SSH key to file:', err);
      }
    }

    return keyFromConfig || null;
  }

  /**
   * Get the path to the SSH private key file
   */
  getSshKeyPath(): string {
    return AWS_SSH_KEY_PATH;
  }

  /**
   * Get the current region
   */
  getRegion(): string {
    return this.region;
  }
}

// Singleton instance
let awsService: AwsService | null = null;

export function getAwsService(): AwsService {
  if (!awsService) {
    awsService = new AwsService();
  }
  return awsService;
}

export async function initializeAwsService(): Promise<AwsService> {
  const service = getAwsService();
  await service.initialize();
  return service;
}
