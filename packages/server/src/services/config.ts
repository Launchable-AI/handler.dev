import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const CONFIG_FILE = join(PROJECT_ROOT, 'data', 'config.json');

export interface DaytonaConfig {
  apiUrl: string;      // e.g., https://app.daytona.io/api
  apiKey: string;      // User's API key
  enabled: boolean;
}

export interface AwsConfig {
  accessKeyId: string;        // AWS Access Key ID
  secretAccessKey: string;    // AWS Secret Access Key
  region: string;             // e.g., "us-east-1"
  enabled: boolean;
  defaultVpcId?: string;      // Optional: use default VPC if not specified
  defaultSubnetId?: string;   // Optional: use default subnet if not specified
  sshKeyName?: string;        // AWS key pair name (auto-created if not specified)
  sshPrivateKey?: string;     // Private key content (stored when auto-created)
}

export interface AzureConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  subscriptionId: string;
  region: string;             // e.g., "eastus"
  resourceGroup: string;      // Resource group for VMs
  enabled: boolean;
  sshPrivateKey?: string;     // Private key content
  sshPublicKey?: string;      // Public key content
}

export interface GcpConfig {
  projectId: string;
  keyFileJson: string;        // Service account JSON key content
  zone: string;               // e.g., "us-central1-a"
  enabled: boolean;
  sshPrivateKey?: string;
  sshPublicKey?: string;
}

export interface DigitalOceanConfig {
  apiToken: string;
  region: string;             // e.g., "nyc1"
  enabled: boolean;
  sshKeyId?: number;          // DO SSH key ID
  sshPrivateKey?: string;
  sshPublicKey?: string;
}

export interface LinodeConfig {
  apiToken: string;
  region: string;             // e.g., "us-east"
  enabled: boolean;
  sshPrivateKey?: string;
  sshPublicKey?: string;
  rootPassword?: string;      // Generated root password
}

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  username?: string;
  enabled: boolean;
  // Repo visibility: 'all' shows all repos, array of full_names (e.g., 'owner/repo') shows only selected
  visibleRepos?: 'all' | string[];
}

export interface CloudBackendsConfig {
  daytona?: DaytonaConfig;
  aws?: AwsConfig;
  azure?: AzureConfig;
  gcp?: GcpConfig;
  digitalocean?: DigitalOceanConfig;
  linode?: LinodeConfig;
  github?: GitHubConfig;
}

export interface DockerHubConfig {
  username: string;
  password: string;
  enabled: boolean;
}

export interface ContainerRegistriesConfig {
  dockerHub?: DockerHubConfig;
}

export interface AppConfig {
  sshKeysDisplayPath: string; // Path shown in SSH commands (e.g., ~/.ssh)
  sshHost: string; // Host used in SSH commands (empty = localhost)
  sshJumpHost: string; // Jump host for ProxyJump (e.g., user@bastion.example.com)
  sshJumpHostKeyPath: string; // Path to SSH key for jump host (e.g., ~/.ssh/jump_key.pem)
  dataDirectory: string; // Base directory for all data (volumes, ssh-keys, etc.)
  cloudBackends?: CloudBackendsConfig; // Cloud backend configurations
  containerRegistries?: ContainerRegistriesConfig; // Container registry configurations
}

const DEFAULT_CONFIG: AppConfig = {
  sshKeysDisplayPath: '~/.ssh',
  sshHost: '', // Empty means localhost
  sshJumpHost: '', // Empty means no jump host
  sshJumpHostKeyPath: '', // Empty means use default key
  dataDirectory: join(PROJECT_ROOT, 'data'),
  cloudBackends: undefined, // No cloud backends configured by default
};

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

let cachedConfig: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Partial<AppConfig>;
    cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    return cachedConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  const current = await getConfig();
  const newConfig = { ...current, ...updates };

  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2));

  cachedConfig = newConfig;
  return newConfig;
}

export async function getSshKeysDisplayPath(): Promise<string> {
  const config = await getConfig();
  return config.sshKeysDisplayPath;
}
