/**
 * Azure Compute Backend Service
 *
 * Integrates with Azure VMs for cloud-based sandboxes.
 * Uses REST API calls (fetch) instead of Azure SDK to avoid dependency issues.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateKeyPairSync } from 'crypto';
import { getConfig, setConfig } from './config.js';

// Path to store SSH keys
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const SSH_KEYS_DIR = join(PROJECT_ROOT, 'data', 'ssh-keys');
export const AZURE_SSH_KEY_PATH = join(SSH_KEYS_DIR, 'azure-key');
export const AZURE_SSH_PUB_KEY_PATH = join(SSH_KEYS_DIR, 'azure-key.pub');

// Azure REST API configuration
const AZURE_MANAGEMENT_BASE = 'https://management.azure.com';
const COMPUTE_API_VERSION = '2024-03-01';
const NETWORK_API_VERSION = '2024-01-01';

// Azure VM power states
export type AzurePowerState =
  | 'PowerState/running'
  | 'PowerState/deallocated'
  | 'PowerState/stopped'
  | 'PowerState/starting'
  | 'PowerState/stopping'
  | 'PowerState/deallocating'
  | 'PowerState/unknown';

// Size class presets
export type AzureSizeClass = 'small' | 'medium' | 'large';

export const AZURE_SIZE_PRESETS: Record<AzureSizeClass, {
  vmSize: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
}> = {
  small: { vmSize: 'Standard_B1s', vcpus: 1, memoryMb: 2048, diskGb: 30 },
  medium: { vmSize: 'Standard_B2s', vcpus: 2, memoryMb: 4096, diskGb: 30 },
  large: { vmSize: 'Standard_B4ms', vcpus: 4, memoryMb: 16384, diskGb: 64 },
};

// Available regions
export const AZURE_REGIONS = [
  { id: 'eastus', name: 'East US' },
  { id: 'eastus2', name: 'East US 2' },
  { id: 'westus2', name: 'West US 2' },
  { id: 'westus3', name: 'West US 3' },
  { id: 'centralus', name: 'Central US' },
  { id: 'westeurope', name: 'West Europe' },
  { id: 'northeurope', name: 'North Europe' },
  { id: 'southeastasia', name: 'Southeast Asia' },
  { id: 'eastasia', name: 'East Asia' },
  { id: 'uksouth', name: 'UK South' },
];

export interface AzureInstance {
  vmName: string;
  vmId: string;
  name: string;
  powerState: AzurePowerState;
  provisioningState: string;
  vmSize: string;
  publicIp?: string;
  privateIp?: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  tags: Record<string, string>;
}

export interface CreateAzureInstanceRequest {
  name: string;
  sizeClass?: AzureSizeClass;
  vmSize?: string;
  resourceGroup?: string;
  userData?: string;
}

// User data cloud-init script for Azure VMs
const DEFAULT_USER_DATA = `#!/bin/bash
# Update and install essentials
apt-get update && apt-get install -y git curl vim

# Create workspace directory
mkdir -p /home/azureuser/workspace /home/azureuser/.claude
chown -R azureuser:azureuser /home/azureuser/workspace /home/azureuser/.claude

# Signal ready (create marker file)
touch /tmp/caisson-ready
`;

export class AzureService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private subscriptionId: string = '';
  private resourceGroup: string = '';
  private tenantId: string = '';
  private clientId: string = '';
  private clientSecret: string = '';
  private region: string = 'eastus';
  private initialized: boolean = false;

  // Cache for instances
  private instancesCache: AzureInstance[] = [];
  private instancesCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 15 * 1000; // 15 seconds

  /**
   * Initialize the Azure service with config
   */
  async initialize(): Promise<void> {
    const config = await getConfig();
    const azure = config.cloudBackends?.azure;

    if (!azure?.clientId || !azure?.clientSecret || !azure?.tenantId || !azure?.subscriptionId) {
      throw new Error('Azure credentials not configured');
    }

    this.tenantId = azure.tenantId;
    this.clientId = azure.clientId;
    this.clientSecret = azure.clientSecret;
    this.subscriptionId = azure.subscriptionId;
    this.resourceGroup = azure.resourceGroup || 'caisson-rg';
    this.region = azure.region || 'eastus';
    this.initialized = true;

    console.log('[AzureService] Initialized with region:', this.region);
  }

  /**
   * Check if the service is initialized and enabled
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await getConfig();
      const azure = config.cloudBackends?.azure;
      return !!(azure?.clientId && azure?.clientSecret && azure?.tenantId && azure?.subscriptionId && azure?.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Get an OAuth2 access token using client credentials flow
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    if (!this.initialized) {
      await this.initialize();
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://management.azure.com/.default',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get Azure access token: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);

    return this.accessToken;
  }

  /**
   * Make an authenticated Azure REST API request
   */
  private async azureRequest(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    return response;
  }

  /**
   * Build the base resource URL for compute operations
   */
  private computeBaseUrl(): string {
    return `${AZURE_MANAGEMENT_BASE}/subscriptions/${this.subscriptionId}/resourceGroups/${this.resourceGroup}/providers/Microsoft.Compute`;
  }

  /**
   * Build the base resource URL for network operations
   */
  private networkBaseUrl(): string {
    return `${AZURE_MANAGEMENT_BASE}/subscriptions/${this.subscriptionId}/resourceGroups/${this.resourceGroup}/providers/Microsoft.Network`;
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const url = `${this.computeBaseUrl()}/virtualMachines?api-version=${COMPUTE_API_VERSION}`;
      const response = await this.azureRequest('GET', url);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API error: ${response.status} ${errorText}` };
      }

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
    return Date.now() - this.instancesCacheTime < AzureService.CACHE_TTL_MS;
  }

  /**
   * Invalidate the instance cache
   */
  invalidateCache(): void {
    this.instancesCacheTime = 0;
    this.instancesCache = [];
    console.log('[AzureService] Cache invalidated');
  }

  /**
   * Ensure the resource group exists
   */
  private async ensureResourceGroup(): Promise<void> {
    const url = `${AZURE_MANAGEMENT_BASE}/subscriptions/${this.subscriptionId}/resourceGroups/${this.resourceGroup}?api-version=2021-04-01`;
    const response = await this.azureRequest('GET', url);

    if (response.ok) {
      return; // Resource group exists
    }

    // Create the resource group
    const createResponse = await this.azureRequest('PUT', url, {
      location: this.region,
      tags: { caisson: 'true' },
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create resource group: ${createResponse.status} ${errorText}`);
    }

    console.log('[AzureService] Created resource group:', this.resourceGroup);
  }

  /**
   * Ensure VNet and subnet exist, return subnet ID
   */
  private async ensureNetwork(): Promise<string> {
    const vnetName = 'caisson-vnet';
    const subnetName = 'caisson-subnet';
    const vnetUrl = `${this.networkBaseUrl()}/virtualNetworks/${vnetName}?api-version=${NETWORK_API_VERSION}`;

    const response = await this.azureRequest('GET', vnetUrl);

    if (response.ok) {
      const vnet = await response.json() as { properties: { subnets: Array<{ id: string; name: string }> } };
      const subnet = vnet.properties.subnets.find((s: { name: string }) => s.name === subnetName);
      if (subnet) {
        return subnet.id;
      }
    }

    // Create VNet with subnet
    const createResponse = await this.azureRequest('PUT', vnetUrl, {
      location: this.region,
      tags: { caisson: 'true' },
      properties: {
        addressSpace: {
          addressPrefixes: ['10.0.0.0/16'],
        },
        subnets: [
          {
            name: subnetName,
            properties: {
              addressPrefix: '10.0.0.0/24',
            },
          },
        ],
      },
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create VNet: ${createResponse.status} ${errorText}`);
    }

    const vnet = await createResponse.json() as { properties: { subnets: Array<{ id: string; name: string }> } };
    const subnet = vnet.properties.subnets.find((s: { name: string }) => s.name === subnetName);

    if (!subnet) {
      throw new Error('Subnet not found after VNet creation');
    }

    console.log('[AzureService] Created VNet and subnet');
    return subnet.id;
  }

  /**
   * Create a public IP address
   */
  private async createPublicIp(name: string): Promise<string> {
    const ipName = `${name}-pip`;
    const url = `${this.networkBaseUrl()}/publicIPAddresses/${ipName}?api-version=${NETWORK_API_VERSION}`;

    const response = await this.azureRequest('PUT', url, {
      location: this.region,
      tags: { caisson: 'true' },
      properties: {
        publicIPAllocationMethod: 'Dynamic',
      },
      sku: {
        name: 'Basic',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create public IP: ${response.status} ${errorText}`);
    }

    const ip = await response.json() as { id: string };
    console.log('[AzureService] Created public IP:', ipName);
    return ip.id;
  }

  /**
   * Create a network interface
   */
  private async createNic(name: string, subnetId: string, publicIpId: string): Promise<string> {
    const nicName = `${name}-nic`;
    const url = `${this.networkBaseUrl()}/networkInterfaces/${nicName}?api-version=${NETWORK_API_VERSION}`;

    // Ensure NSG exists for SSH access
    const nsgId = await this.ensureNetworkSecurityGroup();

    const response = await this.azureRequest('PUT', url, {
      location: this.region,
      tags: { caisson: 'true' },
      properties: {
        ipConfigurations: [
          {
            name: 'ipconfig1',
            properties: {
              subnet: { id: subnetId },
              publicIPAddress: { id: publicIpId },
              privateIPAllocationMethod: 'Dynamic',
            },
          },
        ],
        networkSecurityGroup: { id: nsgId },
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create NIC: ${response.status} ${errorText}`);
    }

    const nic = await response.json() as { id: string };
    console.log('[AzureService] Created NIC:', nicName);
    return nic.id;
  }

  /**
   * Ensure a Network Security Group exists with SSH rule
   */
  private async ensureNetworkSecurityGroup(): Promise<string> {
    const nsgName = 'caisson-nsg';
    const url = `${this.networkBaseUrl()}/networkSecurityGroups/${nsgName}?api-version=${NETWORK_API_VERSION}`;

    const response = await this.azureRequest('GET', url);
    if (response.ok) {
      const nsg = await response.json() as { id: string };
      return nsg.id;
    }

    // Create NSG with SSH rule
    const createResponse = await this.azureRequest('PUT', url, {
      location: this.region,
      tags: { caisson: 'true' },
      properties: {
        securityRules: [
          {
            name: 'AllowSSH',
            properties: {
              protocol: 'Tcp',
              sourcePortRange: '*',
              destinationPortRange: '22',
              sourceAddressPrefix: '*',
              destinationAddressPrefix: '*',
              access: 'Allow',
              priority: 1000,
              direction: 'Inbound',
            },
          },
        ],
      },
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create NSG: ${createResponse.status} ${errorText}`);
    }

    const nsg = await createResponse.json() as { id: string };
    console.log('[AzureService] Created NSG:', nsgName);
    return nsg.id;
  }

  /**
   * Ensure SSH key pair exists locally
   */
  async ensureSshKeyPair(): Promise<{ publicKey: string }> {
    if (existsSync(AZURE_SSH_KEY_PATH) && existsSync(AZURE_SSH_PUB_KEY_PATH)) {
      const publicKey = await readFile(AZURE_SSH_PUB_KEY_PATH, 'utf-8');
      return { publicKey: publicKey.trim() };
    }

    // Generate a new ed25519 key pair
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Convert PEM public key to OpenSSH format for Azure
    const publicKeyDer = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\n/g, '');
    const pubKeyBuffer = Buffer.from(publicKeyDer, 'base64');

    // Ed25519 public key in OpenSSH format
    // The DER-encoded SPKI for ed25519 has the 32-byte key at the end
    const rawPubKey = pubKeyBuffer.subarray(pubKeyBuffer.length - 32);
    const keyType = Buffer.from('ssh-ed25519');
    const keyTypeLen = Buffer.alloc(4);
    keyTypeLen.writeUInt32BE(keyType.length);
    const keyDataLen = Buffer.alloc(4);
    keyDataLen.writeUInt32BE(rawPubKey.length);
    const sshPubKey = Buffer.concat([keyTypeLen, keyType, keyDataLen, rawPubKey]);
    const sshPubKeyStr = `ssh-ed25519 ${sshPubKey.toString('base64')} caisson@azure`;

    await mkdir(SSH_KEYS_DIR, { recursive: true });
    await writeFile(AZURE_SSH_KEY_PATH, privateKey, { mode: 0o600 });
    await writeFile(AZURE_SSH_PUB_KEY_PATH, sshPubKeyStr, { mode: 0o644 });

    console.log('[AzureService] Generated SSH key pair at:', AZURE_SSH_KEY_PATH);
    return { publicKey: sshPubKeyStr };
  }

  /**
   * Get the power state of a VM from its instance view
   */
  private async getVmPowerState(vmName: string): Promise<AzurePowerState> {
    const url = `${this.computeBaseUrl()}/virtualMachines/${vmName}/instanceView?api-version=${COMPUTE_API_VERSION}`;
    const response = await this.azureRequest('GET', url);

    if (!response.ok) {
      return 'PowerState/unknown';
    }

    const data = await response.json() as { statuses: Array<{ code: string }> };
    const powerStatus = data.statuses?.find((s: { code: string }) => s.code.startsWith('PowerState/'));
    return (powerStatus?.code as AzurePowerState) || 'PowerState/unknown';
  }

  /**
   * Get the public IP address for a VM
   */
  private async getVmPublicIp(vmName: string): Promise<string | undefined> {
    const ipName = `${vmName}-pip`;
    const url = `${this.networkBaseUrl()}/publicIPAddresses/${ipName}?api-version=${NETWORK_API_VERSION}`;
    const response = await this.azureRequest('GET', url);

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json() as { properties: { ipAddress?: string } };
    return data.properties?.ipAddress;
  }

  /**
   * Get the private IP address for a VM
   */
  private async getVmPrivateIp(vmName: string): Promise<string | undefined> {
    const nicName = `${vmName}-nic`;
    const url = `${this.networkBaseUrl()}/networkInterfaces/${nicName}?api-version=${NETWORK_API_VERSION}`;
    const response = await this.azureRequest('GET', url);

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json() as { properties: { ipConfigurations: Array<{ properties: { privateIPAddress?: string } }> } };
    return data.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress;
  }

  /**
   * Convert Azure VM API response to AzureInstance
   */
  private async vmToAzureInstance(vm: Record<string, unknown>): Promise<AzureInstance> {
    const tags = (vm.tags as Record<string, string>) || {};
    const vmName = vm.name as string;
    const properties = vm.properties as Record<string, unknown>;
    const hardwareProfile = properties.hardwareProfile as { vmSize: string };
    const vmId = vm.id as string;
    const location = vm.location as string;

    // Get power state
    const powerState = await this.getVmPowerState(vmName);

    // Get IP addresses
    const publicIp = await this.getVmPublicIp(vmName);
    const privateIp = await this.getVmPrivateIp(vmName);

    return {
      vmName,
      vmId,
      name: tags['caisson:name'] || vmName,
      powerState,
      provisioningState: (properties.provisioningState as string) || 'Unknown',
      vmSize: hardwareProfile?.vmSize || 'Unknown',
      publicIp,
      privateIp,
      location,
      resourceGroup: this.resourceGroup,
      subscriptionId: this.subscriptionId,
      tags,
    };
  }

  /**
   * List all Caisson-managed VMs
   */
  async listInstances(forceRefresh: boolean = false): Promise<AzureInstance[]> {
    if (!forceRefresh && this.isCacheValid() && this.instancesCache.length > 0) {
      console.log('[AzureService] Returning cached instances');
      return this.instancesCache;
    }

    try {
      const url = `${this.computeBaseUrl()}/virtualMachines?api-version=${COMPUTE_API_VERSION}`;
      const response = await this.azureRequest('GET', url);

      if (!response.ok) {
        throw new Error(`Failed to list VMs: ${response.status}`);
      }

      const data = await response.json() as { value: Array<Record<string, unknown>> };
      const vms = data.value || [];

      // Filter for caisson-tagged VMs
      const caissonVms = vms.filter((vm: Record<string, unknown>) => {
        const tags = (vm.tags as Record<string, string>) || {};
        return tags['caisson'] === 'true';
      });

      const instances: AzureInstance[] = [];
      for (const vm of caissonVms) {
        instances.push(await this.vmToAzureInstance(vm));
      }

      this.instancesCache = instances;
      this.instancesCacheTime = Date.now();
      console.log('[AzureService] Fetched fresh instances:', instances.length);
      return instances;
    } catch (err) {
      console.error('[AzureService] Failed to list instances:', err);
      if (this.instancesCache.length > 0) {
        console.log('[AzureService] Returning stale cache on error');
        return this.instancesCache;
      }
      return [];
    }
  }

  /**
   * Get a specific VM instance
   */
  async getInstance(vmName: string): Promise<AzureInstance | null> {
    try {
      const url = `${this.computeBaseUrl()}/virtualMachines/${vmName}?api-version=${COMPUTE_API_VERSION}`;
      const response = await this.azureRequest('GET', url);

      if (!response.ok) {
        return null;
      }

      const vm = await response.json() as Record<string, unknown>;
      return await this.vmToAzureInstance(vm);
    } catch {
      return null;
    }
  }

  /**
   * Create a new VM instance
   */
  async createInstance(request: CreateAzureInstanceRequest): Promise<AzureInstance> {
    // Ensure resource group and network exist
    await this.ensureResourceGroup();
    const subnetId = await this.ensureNetwork();

    // Determine VM size
    const sizeClass = request.sizeClass || 'small';
    const vmSize = request.vmSize || AZURE_SIZE_PRESETS[sizeClass].vmSize;
    const diskGb = AZURE_SIZE_PRESETS[sizeClass].diskGb;

    // Ensure SSH key pair
    const { publicKey } = await this.ensureSshKeyPair();

    // Create public IP and NIC
    const vmName = request.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    const publicIpId = await this.createPublicIp(vmName);
    const nicId = await this.createNic(vmName, subnetId, publicIpId);

    // Build user data
    const userData = Buffer.from(request.userData || DEFAULT_USER_DATA).toString('base64');

    // Create the VM
    const url = `${this.computeBaseUrl()}/virtualMachines/${vmName}?api-version=${COMPUTE_API_VERSION}`;
    const vmBody = {
      location: this.region,
      tags: {
        caisson: 'true',
        'caisson:name': request.name,
        'caisson:sizeClass': sizeClass,
      },
      properties: {
        hardwareProfile: {
          vmSize,
        },
        storageProfile: {
          imageReference: {
            publisher: 'Canonical',
            offer: 'ubuntu-24_04-lts',
            sku: 'server',
            version: 'latest',
          },
          osDisk: {
            createOption: 'FromImage',
            managedDisk: {
              storageAccountType: 'Standard_LRS',
            },
            diskSizeGB: diskGb,
          },
        },
        osProfile: {
          computerName: vmName,
          adminUsername: 'azureuser',
          customData: userData,
          linuxConfiguration: {
            disablePasswordAuthentication: true,
            ssh: {
              publicKeys: [
                {
                  path: '/home/azureuser/.ssh/authorized_keys',
                  keyData: publicKey,
                },
              ],
            },
          },
        },
        networkProfile: {
          networkInterfaces: [
            {
              id: nicId,
              properties: {
                primary: true,
              },
            },
          ],
        },
      },
    };

    console.log('[AzureService] Creating VM:', vmName);
    const response = await this.azureRequest('PUT', url, vmBody);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create VM: ${response.status} ${errorText}`);
    }

    this.invalidateCache();

    // Fetch and return the created instance
    // Azure VM creation is async, so we return what we can immediately
    const vm = await response.json() as Record<string, unknown>;
    return await this.vmToAzureInstance(vm);
  }

  /**
   * Start a stopped VM
   */
  async startInstance(vmName: string): Promise<AzureInstance> {
    const url = `${this.computeBaseUrl()}/virtualMachines/${vmName}/start?api-version=${COMPUTE_API_VERSION}`;
    const response = await this.azureRequest('POST', url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to start VM: ${response.status} ${errorText}`);
    }

    console.log('[AzureService] Starting VM:', vmName);
    this.invalidateCache();

    // Poll for running state (Azure start is async)
    let attempts = 0;
    while (attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const powerState = await this.getVmPowerState(vmName);
      if (powerState === 'PowerState/running') break;
      attempts++;
    }

    const instance = await this.getInstance(vmName);
    if (!instance) {
      throw new Error(`VM ${vmName} not found after start`);
    }
    return instance;
  }

  /**
   * Stop (deallocate) a running VM
   */
  async stopInstance(vmName: string): Promise<AzureInstance> {
    // Use deallocate to stop billing (powerOff keeps the VM allocated)
    const url = `${this.computeBaseUrl()}/virtualMachines/${vmName}/deallocate?api-version=${COMPUTE_API_VERSION}`;
    const response = await this.azureRequest('POST', url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to stop VM: ${response.status} ${errorText}`);
    }

    console.log('[AzureService] Stopping (deallocating) VM:', vmName);
    this.invalidateCache();

    // Poll for deallocated state
    let attempts = 0;
    while (attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const powerState = await this.getVmPowerState(vmName);
      if (powerState === 'PowerState/deallocated') break;
      attempts++;
    }

    const instance = await this.getInstance(vmName);
    if (!instance) {
      throw new Error(`VM ${vmName} not found after stop`);
    }
    return instance;
  }

  /**
   * Terminate (delete) a VM and its associated resources
   */
  async terminateInstance(vmName: string): Promise<void> {
    // Delete the VM
    const vmUrl = `${this.computeBaseUrl()}/virtualMachines/${vmName}?api-version=${COMPUTE_API_VERSION}`;
    const vmResponse = await this.azureRequest('DELETE', vmUrl);

    if (!vmResponse.ok && vmResponse.status !== 404) {
      const errorText = await vmResponse.text();
      throw new Error(`Failed to delete VM: ${vmResponse.status} ${errorText}`);
    }

    console.log('[AzureService] Deleted VM:', vmName);

    // Wait a bit for VM deletion to propagate
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Clean up NIC
    const nicUrl = `${this.networkBaseUrl()}/networkInterfaces/${vmName}-nic?api-version=${NETWORK_API_VERSION}`;
    const nicResponse = await this.azureRequest('DELETE', nicUrl);
    if (nicResponse.ok || nicResponse.status === 404) {
      console.log('[AzureService] Deleted NIC:', `${vmName}-nic`);
    }

    // Wait for NIC deletion
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Clean up public IP
    const pipUrl = `${this.networkBaseUrl()}/publicIPAddresses/${vmName}-pip?api-version=${NETWORK_API_VERSION}`;
    const pipResponse = await this.azureRequest('DELETE', pipUrl);
    if (pipResponse.ok || pipResponse.status === 404) {
      console.log('[AzureService] Deleted public IP:', `${vmName}-pip`);
    }

    this.invalidateCache();
  }

  /**
   * Get SSH command for a VM
   */
  async getSshCommand(vmName: string): Promise<string | null> {
    const instance = await this.getInstance(vmName);
    if (!instance || !instance.publicIp) {
      return null;
    }

    return `ssh -i ${AZURE_SSH_KEY_PATH} azureuser@${instance.publicIp}`;
  }

  /**
   * Get the SSH private key
   */
  async getSshPrivateKey(): Promise<string | null> {
    if (existsSync(AZURE_SSH_KEY_PATH)) {
      try {
        return await readFile(AZURE_SSH_KEY_PATH, 'utf-8');
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Get the path to the SSH private key file
   */
  getSshKeyPath(): string {
    return AZURE_SSH_KEY_PATH;
  }

  /**
   * Get the current region
   */
  getRegion(): string {
    return this.region;
  }
}

// Singleton instance
let azureService: AzureService | null = null;

export function getAzureService(): AzureService {
  if (!azureService) {
    azureService = new AzureService();
  }
  return azureService;
}

export async function initializeAzureService(): Promise<AzureService> {
  const service = getAzureService();
  await service.initialize();
  return service;
}
