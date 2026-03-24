// Server URL configuration
// In dev mode, Vite proxies /api and /ws to the backend, so use same origin.
// In production or when VITE_SERVER_PORT is set, connect directly to the server port.
const SERVER_PORT = import.meta.env.VITE_SERVER_PORT;

function getServerUrl(): string {
  // If no explicit server port, use same origin (works with Vite proxy and production)
  if (!SERVER_PORT) {
    return window.location.origin;
  }
  const host = window.location.hostname || 'localhost';
  return `http://${host}:${SERVER_PORT}`;
}

export function getWsUrl(path: string = '/ws/terminal'): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!SERVER_PORT) {
    return `${protocol}//${window.location.host}${path}`;
  }
  const host = window.location.hostname || 'localhost';
  return `${protocol}//${host}:${SERVER_PORT}${path}`;
}

export async function getApiBase(): Promise<string> {
  return `${getServerUrl()}/api`;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'stopped' | 'created' | 'exited' | 'paused' | 'building' | 'failed';
  sshPort: number | null;
  sshCommand: string | null;
  volumes: Array<{ name: string; mountPath: string }>;
  ports: Array<{ container: number; host: number }>;
  createdAt: string;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt: string;
  size: number;
}

export interface ImageInfo {
  id: string;
  repoTags: string[];
  size: number;
  created: string;
  dockerfile?: string;      // The Dockerfile content used to build this image
  dockerfileName?: string;  // The name of the source Dockerfile file
}

export interface CreateContainerRequest {
  name: string;
  image?: string;
  dockerfile?: string;
  volumes?: Array<{ name: string; mountPath: string }>;
  ports?: Array<{ container: number; host: number }>;
  env?: Record<string, string>;
}

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const apiBase = await getApiBase();

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Containers
export async function listContainers(): Promise<ContainerInfo[]> {
  return fetchAPI('/containers');
}

export async function getContainer(id: string): Promise<ContainerInfo> {
  return fetchAPI(`/containers/${id}`);
}

export async function createContainer(request: CreateContainerRequest): Promise<{
  buildId: string;
  status: 'building';
  message: string;
}> {
  return fetchAPI('/containers', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function startContainer(id: string): Promise<{ success: boolean; recreated?: boolean; newId?: string }> {
  return fetchAPI(`/containers/${id}/start`, { method: 'POST' });
}

export async function stopContainer(id: string): Promise<void> {
  await fetchAPI(`/containers/${id}/stop`, { method: 'POST' });
}

export async function removeContainer(id: string): Promise<void> {
  await fetchAPI(`/containers/${id}`, { method: 'DELETE' });
}

export interface ReconfigureContainerRequest {
  volumes?: Array<{ name: string; mountPath: string }>;
  ports?: Array<{ container: number; host: number }>;
}

export async function reconfigureContainer(id: string, request: ReconfigureContainerRequest): Promise<ContainerInfo> {
  return fetchAPI(`/containers/${id}/reconfigure`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function downloadSshKey(id: string): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/containers/${id}/ssh-key`);
  if (!response.ok) {
    throw new Error('Failed to download SSH key');
  }
  return response.blob();
}

// Container Logs
export async function getContainerLogs(id: string, tail: number = 200): Promise<string> {
  const result = await fetchAPI<{ logs: string }>(`/containers/${id}/logs?tail=${tail}`);
  return result.logs;
}

// Build Logs (for containers being built)
export interface BuildLogsResponse {
  buildId: string;
  status: 'building' | 'completed' | 'failed';
  logs: string[];
}

export async function getBuildLogs(buildId: string): Promise<BuildLogsResponse> {
  return fetchAPI<BuildLogsResponse>(`/containers/builds/${buildId}/logs`);
}

export async function streamContainerLogs(
  id: string,
  callbacks: {
    onLog: (line: string) => void;
    onError?: (error: string) => void;
    onDone?: () => void;
  },
  tail: number = 100
): Promise<() => void> {
  const apiBase = await getApiBase();
  const controller = new AbortController();

  fetch(`${apiBase}/containers/${id}/logs/stream?tail=${tail}`, {
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        callbacks.onError?.(`HTTP error: ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError?.('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          callbacks.onDone?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // Skip event line, data comes next
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              callbacks.onLog(data);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        callbacks.onError?.(error.message);
      }
    });

  // Return cleanup function
  return () => controller.abort();
}

// Images
export async function listImages(): Promise<ImageInfo[]> {
  return fetchAPI('/images');
}

export async function pullImage(image: string): Promise<void> {
  await fetchAPI('/images/pull', {
    method: 'POST',
    body: JSON.stringify({ image }),
  });
}

export async function removeImage(id: string): Promise<void> {
  await fetchAPI(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function renameImage(currentTag: string, newTag: string): Promise<void> {
  await fetchAPI(`/images/${encodeURIComponent(currentTag)}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ newTag }),
  });
}

// Volumes
export async function listVolumes(): Promise<VolumeInfo[]> {
  return fetchAPI('/volumes');
}

export async function createVolume(name: string): Promise<void> {
  await fetchAPI('/volumes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function removeVolume(name: string): Promise<void> {
  await fetchAPI(`/volumes/${name}`, { method: 'DELETE' });
}

export async function getVolumeSize(name: string): Promise<number> {
  const result = await fetchAPI<{ size: number }>(`/volumes/${name}/size`);
  return result.size;
}

export async function getVolumeFiles(name: string): Promise<string[]> {
  const result = await fetchAPI<{ files: string[] }>(`/volumes/${name}/files`);
  return result.files;
}

export async function uploadFileToVolume(volumeName: string, file: File): Promise<void> {
  const serverUrl = getServerUrl();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${serverUrl}/api/volumes/${volumeName}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export async function uploadDirectoryToVolume(
  volumeName: string,
  files: Array<{ file: File; relativePath: string }>,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  const serverUrl = getServerUrl();
  const formData = new FormData();

  // Append each file with its relative path as metadata
  for (let i = 0; i < files.length; i++) {
    const { file, relativePath } = files[i];
    formData.append('files', file);
    formData.append('paths', relativePath);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.error || 'Upload failed'));
        } catch {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed: Network error'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload cancelled'));
    });

    xhr.open('POST', `${serverUrl}/api/volumes/${volumeName}/upload-directory`);
    xhr.send(formData);
  });
}

// Dockerfile Templates
export interface TemplateInfo {
  name: string;
  description: string;
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  return fetchAPI('/dockerfiles/templates');
}

export async function getTemplate(name: string): Promise<{ name: string; content: string; description: string }> {
  return fetchAPI(`/dockerfiles/templates/${name}`);
}

// Dockerfiles
export interface DockerfileInfo {
  name: string;
  modifiedAt: string;
  isSystem?: boolean;
  description?: string;
}

export async function listDockerfiles(): Promise<DockerfileInfo[]> {
  return fetchAPI('/dockerfiles');
}

export async function getDockerfile(name: string): Promise<{ name: string; content: string }> {
  return fetchAPI(`/dockerfiles/${name}`);
}

export async function saveDockerfile(name: string, content: string): Promise<void> {
  await fetchAPI(`/dockerfiles/${name}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function deleteDockerfile(name: string): Promise<void> {
  await fetchAPI(`/dockerfiles/${name}`, { method: 'DELETE' });
}

export async function renameDockerfile(name: string, newName: string): Promise<{ success: boolean; name: string }> {
  return fetchAPI(`/dockerfiles/${name}`, {
    method: 'PATCH',
    body: JSON.stringify({ newName }),
  });
}

export async function buildDockerfile(
  name: string,
  onLog: (log: string) => void,
  onDone: (tag: string) => void,
  onError: (error: string) => void,
  version?: string // Optional version tag (e.g., timestamp for auto-versioning)
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    // Use fetch with streaming for SSE
    const url = version
      ? `${serverUrl}/api/dockerfiles/${name}/build?version=${encodeURIComponent(version)}`
      : `${serverUrl}/api/dockerfiles/${name}/build`;
    fetch(url, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Build failed' }));
        onError(error.error || 'Build failed');
        reject(new Error(error.error || 'Build failed'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'log') {
              onLog(data);
            } else if (event === 'done') {
              onDone(data);
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// Health
export async function checkHealth(): Promise<{ status: string; docker: string; devMode?: boolean }> {
  return fetchAPI('/health');
}

// Config
export interface DaytonaConfig {
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
}

export interface CloudBackendsConfig {
  daytona?: DaytonaConfig;
}

export type ShellPromptTheme = 'minimal' | 'clean' | 'bracket' | 'lambda' | 'cyberpunk' | 'multiline';

export interface AppConfig {
  sshKeysDisplayPath: string;
  sshHost: string;
  sshJumpHost: string; // Jump host for ProxyJump (e.g., user@bastion.example.com)
  sshJumpHostKeyPath: string; // Path to SSH key for jump host (e.g., ~/.ssh/jump_key.pem)
  dataDirectory: string;
  cloudBackends?: CloudBackendsConfig;
  shellPromptTheme?: ShellPromptTheme;
  tmuxEnabled?: boolean; // Enable/disable tmux for terminal sessions (default: true)
  tmuxStatusBar?: boolean; // Show/hide tmux status bar at bottom of terminal (default: false)
}

export interface DataDirScanResult {
  path: string;
  quickFiles: number;
  notes: number;
  agentConfigs: number;
  templates: number;
  dockerfiles: number;
  terminalSessions: number;
  sshKeysExist: boolean;
  isEmpty: boolean;
}

export type UpdateConfigResponse = AppConfig & { _dataDirScan?: DataDirScanResult };

export async function getConfig(): Promise<AppConfig> {
  return fetchAPI('/config');
}

export async function updateConfig(updates: Partial<AppConfig>): Promise<UpdateConfigResponse> {
  return fetchAPI('/config', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// Directory browsing
export interface DirectoryEntry {
  name: string;
  path: string;
  hidden?: boolean;
}

export interface BrowseDirectoryResponse {
  currentPath: string;
  parent: string | null;
  directories: DirectoryEntry[];
}

export async function browseDirectory(path?: string): Promise<BrowseDirectoryResponse> {
  return fetchAPI('/config/browse', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

// Quick Launch config
export interface QuickLaunchConfig {
  backend: 'docker' | 'firecracker' | 'daytona' | 'aws' | 'azure' | 'gcp' | 'digitalocean' | 'linode';
  image?: string;
  ports?: number[];
  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;
  namePrefix?: string;
}

export async function getQuickLaunchConfig(): Promise<QuickLaunchConfig | null> {
  return fetchAPI('/config/quick-launch');
}

export async function setQuickLaunchConfig(config: QuickLaunchConfig): Promise<{ success: boolean; quickLaunch: QuickLaunchConfig }> {
  return fetchAPI('/config/quick-launch', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function deleteQuickLaunchConfig(): Promise<{ success: boolean }> {
  return fetchAPI('/config/quick-launch', {
    method: 'DELETE',
  });
}

// AI Chat
export interface AIStatus {
  configured: boolean;
}

export async function getAIStatus(): Promise<AIStatus> {
  return fetchAPI('/ai/status');
}

export async function streamDockerfileChat(
  message: string,
  dockerfileContent: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/ai/dockerfile-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, dockerfileContent }),
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'AI request failed' }));
        onError(error.error || 'AI request failed');
        reject(new Error(error.error || 'AI request failed'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'chunk') {
              onChunk(data);
            } else if (event === 'done') {
              onDone();
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// AI Prompts
export interface AIPromptInfo {
  current: string;
  default: string;
  isCustom: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
}

export interface ModelInfo {
  current: string;
  default: string;
  available: ModelOption[];
}

export interface AIPrompts {
  dockerfile: AIPromptInfo;
  mcpInstall: AIPromptInfo;
  mcpSearch: AIPromptInfo;
  model: ModelInfo;
}

export async function getAIPrompts(): Promise<AIPrompts> {
  return fetchAPI('/ai/prompts');
}

export async function updateDockerfilePrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/dockerfile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function updateMCPInstallPrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/mcp-install', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function updateMCPSearchPrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/mcp-search', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function updateModel(model: string | null): Promise<{ success: boolean; model: string }> {
  return fetchAPI('/ai/model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
}

// MCP Registry

export interface MCPPackage {
  registryType: 'npm' | 'pypi' | 'docker' | 'crate' | string;
  identifier: string;
  version: string;
  transport?: {
    type: 'stdio' | 'sse' | 'streamable-http' | string;
    args?: string[];
  };
}

export type MCPServerSource = 'anthropic' | 'manual' | 'github' | 'docker';

export interface MCPServer {
  name: string;
  title: string;
  description: string;
  version: string;
  packages: MCPPackage[];
  repository?: {
    type: string;
    url: string;
  };
  tools?: Array<{ name: string; description: string }>;
  prompts?: Array<{ name: string; description: string }>;
  resources?: Array<{ type: string; description: string }>;
  status?: 'deprecated' | 'deleted' | 'active';
  updatedAt?: string;
  installCommand?: string;
  source?: MCPServerSource;
}

export interface MCPRegistryStatus {
  lastSynced: string | null;
  count: number;
}

export async function getMCPRegistryStatus(): Promise<MCPRegistryStatus> {
  return fetchAPI('/mcp/status');
}

export async function syncMCPRegistry(
  onProgress?: (message: string) => void,
  onComplete?: (result: { count: number; timestamp: string }) => void,
  onError?: (error: string) => void
): Promise<void> {
  const apiBase = await getApiBase();

  const response = await fetch(`${apiBase}/mcp/sync`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        const eventType = line.slice(6).trim();
        const dataLine = lines[lines.indexOf(line) + 1];
        if (dataLine?.startsWith('data:')) {
          const data = dataLine.slice(5).trim();
          if (eventType === 'status') {
            onProgress?.(data);
          } else if (eventType === 'done') {
            onComplete?.(JSON.parse(data));
          } else if (eventType === 'error') {
            onError?.(data);
          }
        }
      }
    }
  }
}

export async function listMCPServers(limit = 100, offset = 0): Promise<{
  servers: MCPServer[];
  total: number;
  limit: number;
  offset: number;
}> {
  return fetchAPI(`/mcp/servers?limit=${limit}&offset=${offset}`);
}

export async function searchMCPServers(query: string, limit = 50, offset = 0): Promise<{
  servers: MCPServer[];
  query: string;
  total: number;
  limit: number;
  offset: number;
}> {
  return fetchAPI(`/mcp/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
}

export async function aiSearchMCPServers(query: string): Promise<{
  servers: MCPServer[];
  total: number;
  query: string;
  aiSearch: boolean;
}> {
  return fetchAPI('/mcp/ai-search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

export async function getMCPServer(name: string): Promise<MCPServer> {
  return fetchAPI(`/mcp/servers/${encodeURIComponent(name)}`);
}

export async function getMCPInstallCommand(name: string): Promise<{ name: string; command: string | null }> {
  return fetchAPI(`/mcp/servers/${encodeURIComponent(name)}/install`);
}

export async function getMCPReadme(name: string): Promise<{ name: string; content: string }> {
  return fetchAPI(`/mcp/servers/${encodeURIComponent(name)}/readme`);
}

// MCP Favorites

export async function getMCPFavorites(): Promise<{
  favorites: string[];
  servers: MCPServer[];
}> {
  return fetchAPI('/mcp/favorites');
}

export async function addMCPFavorite(name: string): Promise<void> {
  await fetchAPI(`/mcp/favorites/${encodeURIComponent(name)}`, { method: 'POST' });
}

export async function removeMCPFavorite(name: string): Promise<void> {
  await fetchAPI(`/mcp/favorites/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function checkMCPFavorite(name: string): Promise<{ isFavorite: boolean }> {
  return fetchAPI(`/mcp/favorites/${encodeURIComponent(name)}/check`);
}

// Stream AI-generated install guide
export async function streamMCPInstallGuide(
  name: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/mcp/servers/${encodeURIComponent(name)}/install-guide`, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to generate install guide' }));
        onError(error.error || 'Failed to generate install guide');
        reject(new Error(error.error || 'Failed to generate install guide'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/s);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = dataMatch[1];

            if (event === 'chunk') {
              onChunk(data);
            } else if (event === 'done') {
              onDone();
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      onDone();
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// ============ Manual MCP Servers ============

export async function addManualMCPServer(githubUrl: string): Promise<{ server: MCPServer }> {
  return fetchAPI('/mcp/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: githubUrl }),
  });
}

export async function getManualMCPServers(): Promise<{ servers: MCPServer[] }> {
  return fetchAPI('/mcp/manual');
}

export async function removeManualMCPServer(name: string): Promise<{ success: boolean }> {
  return fetchAPI(`/mcp/manual/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

// ============ MCP Deployments ============

export type MCPDeploymentStatus =
  | 'provisioning'
  | 'installing'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'
  | 'unreachable';

export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';
export type MCPInstallMethod = 'npm' | 'pip' | 'docker' | 'cargo' | 'git-clone';

export interface MCPConnectionConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPDeploymentLogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'warn';
}

export interface MCPDeployment {
  id: string;
  serverName: string;
  serverTitle: string;
  status: MCPDeploymentStatus;
  backend: string;
  sandboxId: string;
  installMethod: MCPInstallMethod;
  transport: MCPTransport;
  port?: number;
  endpoint?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  connectionConfig?: MCPConnectionConfig;
  healthCheckFailures: number;
  deployLog: MCPDeploymentLogEntry[];
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
}

export interface MCPLocalServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  status: 'running' | 'stopped' | 'unknown';
  source: 'claude-json' | 'process';
  pid?: number;
}

export async function deployMCPServer(
  serverName: string,
  backend: string,
  env?: Record<string, string>,
  onProgress?: (event: { status: MCPDeploymentStatus; message: string; deployment?: MCPDeployment }) => void,
  onComplete?: (deployment: MCPDeployment) => void,
  onError?: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  const response = await fetch(`${serverUrl}/api/mcp/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverName, backend, env }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Deploy failed' }));
    throw new Error(error.error || 'Deploy failed');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';

    for (const block of blocks) {
      const eventMatch = block.match(/event: (\w+)/);
      const dataMatch = block.match(/data: (.+)/s);

      if (eventMatch && dataMatch) {
        const event = eventMatch[1];
        const data = dataMatch[1];

        if (event === 'progress') {
          onProgress?.(JSON.parse(data));
        } else if (event === 'done') {
          onComplete?.(JSON.parse(data));
        } else if (event === 'error') {
          onError?.(data);
        }
      }
    }
  }
}

export async function listMCPDeployments(): Promise<{ deployments: MCPDeployment[] }> {
  return fetchAPI('/mcp/deployments');
}

export async function getMCPDeployment(id: string): Promise<MCPDeployment> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(id)}`);
}

export async function stopMCPDeployment(id: string): Promise<MCPDeployment> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

export async function restartMCPDeployment(id: string): Promise<MCPDeployment> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(id)}/restart`, { method: 'POST' });
}

export async function deleteMCPDeployment(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getMCPDeploymentLogs(id: string): Promise<{ logs: MCPDeploymentLogEntry[] }> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(id)}/logs`);
}

export async function startMCPDeployment(id: string): Promise<MCPDeployment> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(id)}/start`, { method: 'POST' });
}

export async function connectMCPToSandbox(deploymentId: string, sandboxId: string): Promise<{ success: boolean; serverKey: string; transport: string }> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(deploymentId)}/connect/${encodeURIComponent(sandboxId)}`, { method: 'POST' });
}

export async function disconnectMCPFromSandbox(deploymentId: string, sandboxId: string): Promise<{ success: boolean }> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(deploymentId)}/disconnect/${encodeURIComponent(sandboxId)}`, { method: 'POST' });
}

export interface MCPPingResult {
  reachable: boolean;
  configured: boolean;
  statusCode?: number;
  url?: string;
  transport?: string;
  command?: string;
  error?: string;
}

export async function pingMCPFromSandbox(deploymentId: string, sandboxId: string): Promise<MCPPingResult> {
  return fetchAPI(`/mcp/deployments/${encodeURIComponent(deploymentId)}/ping/${encodeURIComponent(sandboxId)}`, { method: 'POST' });
}

export async function discoverLocalMCPServers(): Promise<{ servers: MCPLocalServer[] }> {
  return fetchAPI('/mcp/local');
}

// ============ Notes ============

export interface Note {
  id: string;
  title: string;
  description?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export async function getNotes(): Promise<{ notes: Note[] }> {
  return fetchAPI('/notes');
}

export async function getNote(id: string): Promise<Note> {
  return fetchAPI(`/notes/${encodeURIComponent(id)}`);
}

export async function createNote(input: { title: string; description?: string; body: string }): Promise<Note> {
  return fetchAPI('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateNote(id: string, input: { title?: string; description?: string; body?: string }): Promise<Note> {
  return fetchAPI(`/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteNote(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/notes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ============ Quick Files ============

export interface QuickFile {
  id: string;
  name: string;
  filename: string;
  destPath: string;
  content: string;
  isDefault: boolean;
  isSensitive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listQuickFiles(): Promise<{ files: QuickFile[] }> {
  return fetchAPI('/quick-files');
}

export async function createQuickFile(input: {
  name: string;
  filename: string;
  destPath: string;
  content: string;
  isDefault?: boolean;
  isSensitive?: boolean;
}): Promise<QuickFile> {
  return fetchAPI('/quick-files', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateQuickFile(id: string, input: {
  name?: string;
  filename?: string;
  destPath?: string;
  content?: string;
  isDefault?: boolean;
  isSensitive?: boolean;
}): Promise<QuickFile> {
  return fetchAPI(`/quick-files/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteQuickFile(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/quick-files/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function copyQuickFileToSandbox(fileId: string, sandboxId: string): Promise<{ success: boolean; filesInjected: number }> {
  return fetchAPI(`/quick-files/${encodeURIComponent(fileId)}/copy/${encodeURIComponent(sandboxId)}`, {
    method: 'POST',
  });
}

export async function copyDefaultQuickFilesToSandbox(sandboxId: string): Promise<{ success: boolean; filesInjected: number }> {
  return fetchAPI(`/quick-files/copy-defaults/${encodeURIComponent(sandboxId)}`, {
    method: 'POST',
  });
}

// ============ Agent Config Presets ============

export interface MCPServerStdioConfig {
  type?: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPServerHttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface MCPServerSseConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type MCPServerConfig = MCPServerStdioConfig | MCPServerHttpConfig | MCPServerSseConfig;

export interface AgentPermissions {
  allow?: string[];
  deny?: string[];
}

export interface SkillFrontmatter {
  description?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  'allowed-tools'?: string;
  model?: string;
  context?: string;
  agent?: string;
  'argument-hint'?: string;
}

export interface SkillConfig {
  name: string;
  content: string;
  frontmatter?: SkillFrontmatter;
}

export interface RuleConfig {
  filename: string;
  content: string;
}

export type SubagentPermissionMode = 'default' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions' | 'plan';

export interface SubagentConfig {
  name: string;
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: SubagentPermissionMode;
  skills?: string[];
  systemPrompt: string;
}

export interface HookEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'UserPromptSubmit' | 'Stop' | 'Notification' | 'SessionStart' | 'SessionEnd' | 'SubagentStart' | 'SubagentStop' | 'PermissionRequest' | 'PreCompact' | 'Setup';

export interface PluginMarketplace {
  type: 'github';
  owner: string;
  repo: string;
}

export interface PluginRef {
  name: string;
  marketplace: string;
  enabled: boolean;
}

export interface MarketplacePlugin {
  name: string;
  description: string;
  version?: string;
  homepage?: string;
  category?: string;
  tags?: string[];
  source?: { type: string; url?: string; path?: string };
  marketplace?: string;
  marketplaceOwner?: string;
  marketplaceRepo?: string;
}

export interface MarketplaceData {
  name: string;
  slug: string;
  description?: string;
  owner?: string;
  repo?: string;
  plugins: MarketplacePlugin[];
  isCustom?: boolean;
}

export interface AgentConfigPreset {
  id: string;
  name: string;
  description?: string;
  mcpServers: Record<string, MCPServerConfig>;
  claudeMd: string;
  permissions: AgentPermissions;
  skills: SkillConfig[];
  rules: RuleConfig[];
  hooks: Partial<Record<HookEvent, HookMatcher[]>>;
  env: Record<string, string>;
  model: string;
  subagents: SubagentConfig[];
  plugins: PluginRef[];
  marketplaces: PluginMarketplace[];
  createdAt: string;
  updatedAt: string;
}

export async function getAgentConfigs(): Promise<{ configs: AgentConfigPreset[] }> {
  return fetchAPI('/agent-configs');
}

export async function getAgentConfig(id: string): Promise<AgentConfigPreset> {
  return fetchAPI(`/agent-configs/${encodeURIComponent(id)}`);
}

export async function createAgentConfig(input: {
  name: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  claudeMd?: string;
  permissions?: AgentPermissions;
  skills?: SkillConfig[];
  rules?: RuleConfig[];
  hooks?: Partial<Record<HookEvent, HookMatcher[]>>;
  env?: Record<string, string>;
  model?: string;
  subagents?: SubagentConfig[];
  plugins?: PluginRef[];
  marketplaces?: PluginMarketplace[];
}): Promise<AgentConfigPreset> {
  return fetchAPI('/agent-configs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAgentConfig(id: string, input: {
  name?: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  claudeMd?: string;
  permissions?: AgentPermissions;
  skills?: SkillConfig[];
  rules?: RuleConfig[];
  hooks?: Partial<Record<HookEvent, HookMatcher[]>>;
  env?: Record<string, string>;
  model?: string;
  subagents?: SubagentConfig[];
  plugins?: PluginRef[];
  marketplaces?: PluginMarketplace[];
}): Promise<AgentConfigPreset> {
  return fetchAPI(`/agent-configs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteAgentConfig(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/agent-configs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function injectAgentConfig(configId: string, sandboxId: string): Promise<{ success: boolean; filesInjected: number }> {
  return fetchAPI(`/agent-configs/${encodeURIComponent(configId)}/inject/${encodeURIComponent(sandboxId)}`, {
    method: 'POST',
  });
}

// Plugin Marketplace
export async function getPluginMarketplaces(): Promise<{ marketplaces: MarketplaceData[] }> {
  return fetchAPI('/agent-configs/plugins/marketplaces');
}

export async function searchPlugins(query: string): Promise<{ plugins: MarketplacePlugin[] }> {
  return fetchAPI(`/agent-configs/plugins/search?q=${encodeURIComponent(query)}`);
}

export async function addPluginMarketplace(owner: string, repo: string, branch?: string, path?: string): Promise<MarketplaceData> {
  return fetchAPI('/agent-configs/plugins/marketplaces', {
    method: 'POST',
    body: JSON.stringify({ owner, repo, branch, path }),
  });
}

export async function removePluginMarketplace(owner: string, repo: string): Promise<{ success: boolean }> {
  return fetchAPI(`/agent-configs/plugins/marketplaces/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    method: 'DELETE',
  });
}

// ============ Virtual Machines ============

export type VmStatus = 'creating' | 'booting' | 'running' | 'paused' | 'stopped' | 'error';

export interface VmPortMapping {
  container: number;
  host: number;
  protocol?: 'tcp' | 'udp';
}

export interface VmVolumeMount {
  name: string;
  hostPath: string;
  mountPath: string;
  readOnly?: boolean;
}

export interface VmInfo {
  id: string;
  name: string;
  status: VmStatus;
  state: VmStatus;
  sshHost: string;
  sshPort: number;
  sshUser?: string;
  sshCommand?: string;
  guestIp?: string;
  networkMode?: 'tap' | 'bridge' | 'user' | 'none';
  ports: VmPortMapping[];
  volumes: VmVolumeMount[];
  image: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
  createdAt: string;
  startedAt?: string;
  error?: string;
  hypervisor?: HypervisorType;
}

export type HypervisorType = 'firecracker' | 'daytona';

export type DaytonaSizeClass = 'small' | 'medium' | 'large';

// Daytona size class resource configurations (for display)
export const DAYTONA_SIZE_PRESETS: Record<DaytonaSizeClass, { cpu: number; memoryGb: number; diskGb: number; label: string }> = {
  small: { cpu: 1, memoryGb: 1, diskGb: 3, label: 'Small' },
  medium: { cpu: 2, memoryGb: 4, diskGb: 8, label: 'Medium' },
  large: { cpu: 4, memoryGb: 8, diskGb: 10, label: 'Large' },
};

export interface CreateVmRequest {
  name: string;
  baseImage?: string;
  // Launch from an existing snapshot for instant boot with pre-configured environment
  fromSnapshot?: {
    vmId: string;
    snapshotId: string;
  };
  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;
  ports?: VmPortMapping[];
  volumes?: VmVolumeMount[];
  autoStart?: boolean;
  // Hypervisor to use for this VM
  hypervisor?: HypervisorType;
  // Daytona-specific: size class (small, medium, large)
  daytonaSizeClass?: DaytonaSizeClass;
  // Daytona-specific: cloud volumes to mount
  daytonaVolumes?: DaytonaVolumeMount[];
}

export interface VmStats {
  total: number;
  running: number;
  stopped: number;
  error: number;
}

export interface NetworkStatus {
  configured: boolean;
  healthy: boolean;
  bridgeExists: boolean;
  tapDevicesExist: boolean;
  availableTaps: number;
  totalTaps: number;
  message: string;
}

export interface BaseImageInfo {
  name: string;
  hasKernel: boolean;
  hasWarmupSnapshot: boolean;
  isLayered?: boolean;
  parent?: string;
  layerSizeMB?: number;
}

export async function listVms(): Promise<VmInfo[]> {
  return fetchAPI('/vms');
}

export async function getVm(id: string): Promise<VmInfo> {
  return fetchAPI(`/vms/${id}`);
}

export async function createVm(request: CreateVmRequest): Promise<VmInfo> {
  return fetchAPI('/vms', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function startVm(id: string): Promise<VmInfo> {
  return fetchAPI(`/vms/${id}/start`, { method: 'POST' });
}

export async function stopVm(id: string): Promise<VmInfo> {
  return fetchAPI(`/vms/${id}/stop`, { method: 'POST' });
}

export async function deleteVm(id: string): Promise<void> {
  await fetchAPI(`/vms/${id}`, { method: 'DELETE' });
}

export async function updateVmPorts(id: string, ports: Array<{ container: number; host: number }>): Promise<VmInfo> {
  return fetchAPI(`/vms/${id}/ports`, {
    method: 'PATCH',
    body: JSON.stringify({ ports }),
  });
}

export async function getVmStats(): Promise<VmStats> {
  return fetchAPI('/vms/stats');
}

export async function getVmNetworkStatus(): Promise<NetworkStatus> {
  return fetchAPI('/vms/network');
}

export async function listVmBaseImages(): Promise<BaseImageInfo[]> {
  return fetchAPI('/vms/base-images');
}

export async function deleteVmBaseImage(name: string): Promise<void> {
  await fetchAPI(`/vms/base-images/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function triggerVmWarmup(baseImage: string): Promise<void> {
  await fetchAPI(`/vms/warmup/${encodeURIComponent(baseImage)}`, { method: 'POST' });
}

export async function getVmSshInfo(id: string): Promise<{
  host: string;
  port: number;
  user: string;
  command: string;
}> {
  return fetchAPI(`/vms/${id}/ssh`);
}

export async function getVmLogs(id: string, lines?: number): Promise<{ logs: string; logPath?: string }> {
  const params = lines ? `?lines=${lines}` : '';
  return fetchAPI(`/vms/${id}/logs${params}`);
}

export async function downloadVmSshKey(): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/vms/ssh-key`);
  if (!response.ok) {
    throw new Error('Failed to download SSH key');
  }
  return response.blob();
}

// VM Snapshots
export interface VmSnapshotInfo {
  id: string;
  vmId: string;
  name?: string;
  baseImage: string;
  configPath: string;
  snapshotFile: string;
  memoryRanges: string[];
  createdAt: string;
  sizeBytes?: number;
  isQuickLaunchDefault?: boolean;
}

export async function listVmSnapshots(vmId: string): Promise<VmSnapshotInfo[]> {
  return fetchAPI(`/vms/${vmId}/snapshots`);
}

export async function createVmSnapshot(vmId: string, name?: string): Promise<VmSnapshotInfo> {
  return fetchAPI(`/vms/${vmId}/snapshots`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteVmSnapshot(vmId: string, snapshotId: string): Promise<void> {
  await fetchAPI(`/vms/${vmId}/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
}

// Rollback VM to a snapshot (restores the same VM to snapshot state)
export async function rollbackVmToSnapshot(vmId: string, snapshotId: string): Promise<VmInfo> {
  return fetchAPI(`/vms/${vmId}/snapshots/${encodeURIComponent(snapshotId)}/rollback`, {
    method: 'POST',
  });
}

// Promote snapshot to a base image
export async function promoteSnapshotToImage(
  vmId: string,
  snapshotId: string,
  imageName: string
): Promise<{ imageName: string; imagePath: string }> {
  return fetchAPI(`/vms/${vmId}/snapshots/${encodeURIComponent(snapshotId)}/promote`, {
    method: 'POST',
    body: JSON.stringify({ imageName }),
  });
}

export interface VmSnapshotWithVmInfo extends VmSnapshotInfo {
  vmName: string;
}

export async function listAllVmSnapshots(): Promise<VmSnapshotWithVmInfo[]> {
  return fetchAPI('/vms/snapshots');
}

// Warmup status
export interface WarmupStatus {
  baseImage: string;
  phase: 'idle' | 'starting' | 'booting' | 'waiting_for_boot' | 'pausing' | 'snapshotting' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
  vmId?: string;
}

export async function getWarmupStatus(baseImage: string): Promise<WarmupStatus> {
  return fetchAPI(`/vms/warmup/${encodeURIComponent(baseImage)}`);
}

export async function getWarmupLogs(baseImage: string, lines: number = 100): Promise<{ logs: string }> {
  return fetchAPI(`/vms/warmup/${encodeURIComponent(baseImage)}/logs?lines=${lines}`);
}

export async function clearWarmupStatus(baseImage: string): Promise<void> {
  await fetchAPI(`/vms/warmup/${encodeURIComponent(baseImage)}`, { method: 'DELETE' });
}

// Quick launch default
export interface QuickLaunchDefault {
  vmId: string | null;
  snapshotId: string | null;
}

export async function getQuickLaunchDefault(): Promise<QuickLaunchDefault> {
  return fetchAPI('/vms/quick-launch/default');
}

export async function setQuickLaunchDefault(vmId: string, snapshotId: string): Promise<void> {
  await fetchAPI('/vms/quick-launch/default', {
    method: 'PUT',
    body: JSON.stringify({ vmId, snapshotId }),
  });
}

export async function clearQuickLaunchDefault(): Promise<void> {
  await fetchAPI('/vms/quick-launch/default', { method: 'DELETE' });
}

// ============ VM File Operations ============

export interface VmFileInfo {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

export async function listVmFiles(vmId: string, path: string = '/home/agent'): Promise<{ files: VmFileInfo[]; path: string }> {
  return fetchAPI(`/vms/${vmId}/files?path=${encodeURIComponent(path)}`);
}

export async function uploadFileToVm(vmId: string, file: File, destPath: string = '/home/agent'): Promise<{ success: boolean; path: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', destPath);

  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/vms/${vmId}/files/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to upload file');
  }

  return response.json();
}

export async function downloadFileFromVm(vmId: string, filePath: string): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/vms/${vmId}/files/download?path=${encodeURIComponent(filePath)}`);

  if (!response.ok) {
    throw new Error('Failed to download file');
  }

  return response.blob();
}

export async function deleteVmFile(vmId: string, filePath: string): Promise<void> {
  await fetchAPI(`/vms/${vmId}/files?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
}

// ============ Firecracker Install Status ============

export interface FirecrackerInstallStatus {
  binaryInstalled: boolean;
  binaryVersion?: string;
  imageDownloaded: boolean;
  imagePath?: string;
  kvmAvailable: boolean;
  kvmError?: string;
}

export async function getFirecrackerInstallStatus(): Promise<FirecrackerInstallStatus> {
  return fetchAPI('/backends/firecracker/install-status');
}

// ============ Backend Status ============

export interface BackendInfo {
  installed: boolean;
  enabled: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

export interface BackendStatus {
  docker: BackendInfo;
  firecracker: BackendInfo;
  daytona: BackendInfo;
  aws: BackendInfo;
}

export async function getBackendStatus(): Promise<BackendStatus> {
  return fetchAPI('/backends/status');
}

export async function performBackendAction(
  backend: string,
  action: 'enable' | 'disable' | 'install' | 'uninstall'
): Promise<{ success: boolean; message: string }> {
  return fetchAPI(`/backends/${backend}/${action}`, { method: 'POST' });
}

// Cloud Backend Configuration
export interface DaytonaConfigResponse {
  configured: boolean;
  apiUrl: string;
  enabled: boolean;
  hasApiKey?: boolean;
}

export async function getDaytonaConfig(): Promise<DaytonaConfigResponse> {
  return fetchAPI('/backends/daytona/config');
}

export async function configureDaytona(config: {
  apiUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}): Promise<{ success: boolean; daytona?: { apiUrl: string; enabled: boolean } }> {
  return fetchAPI('/backends/daytona/configure', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function testDaytonaConnection(config?: {
  apiUrl?: string;
  apiKey?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/daytona/test', {
    method: 'POST',
    body: JSON.stringify(config || {}),
  });
}

export async function refreshDaytonaCache(): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/daytona/refresh', {
    method: 'POST',
  });
}

// ========== Daytona Volumes API ==========

export type DaytonaVolumeState = 'creating' | 'ready' | 'deleting' | 'error';

export interface DaytonaVolumeInfo {
  id: string;
  organizationId: string;
  name: string;
  state: DaytonaVolumeState;
  createdAt: string;
  updatedAt: string;
}

export interface DaytonaVolumeMount {
  volumeId: string;
  mountPath: string;
  subpath?: string;
}

export async function listDaytonaVolumes(): Promise<DaytonaVolumeInfo[]> {
  return fetchAPI('/backends/daytona/volumes');
}

export async function getDaytonaVolume(id: string): Promise<DaytonaVolumeInfo> {
  return fetchAPI(`/backends/daytona/volumes/${id}`);
}

export async function createDaytonaVolume(name: string): Promise<DaytonaVolumeInfo> {
  return fetchAPI('/backends/daytona/volumes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteDaytonaVolume(id: string): Promise<void> {
  await fetchAPI(`/backends/daytona/volumes/${id}`, {
    method: 'DELETE',
  });
}

// Host Stats
export interface HostStats {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  uptime: number;
  hostname: string;
}

export async function getHostStats(): Promise<HostStats> {
  return fetchAPI('/backends/host-stats');
}

// ========== VM Volumes API ==========

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

export interface CreateVmVolumeRequest {
  name: string;
  sizeGb?: number;
  format?: 'ext4' | 'xfs';
  mountPath?: string;
}

export async function listVmVolumes(): Promise<VmVolumeInfo[]> {
  return fetchAPI('/vm-volumes');
}

export async function getVmVolume(id: string): Promise<VmVolumeInfo> {
  return fetchAPI(`/vm-volumes/${id}`);
}

export async function createVmVolume(request: CreateVmVolumeRequest): Promise<VmVolumeInfo> {
  return fetchAPI('/vm-volumes', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function deleteVmVolume(id: string): Promise<void> {
  await fetchAPI(`/vm-volumes/${id}`, { method: 'DELETE' });
}

export async function attachVmVolume(volumeId: string, vmId: string): Promise<VmVolumeInfo> {
  return fetchAPI(`/vm-volumes/${volumeId}/attach`, {
    method: 'POST',
    body: JSON.stringify({ vmId }),
  });
}

export async function detachVmVolume(volumeId: string): Promise<VmVolumeInfo> {
  return fetchAPI(`/vm-volumes/${volumeId}/detach`, {
    method: 'POST',
  });
}

export async function resizeVmVolume(volumeId: string, sizeGb: number): Promise<VmVolumeInfo> {
  return fetchAPI(`/vm-volumes/${volumeId}/resize`, {
    method: 'POST',
    body: JSON.stringify({ sizeGb }),
  });
}

export async function getVmAttachedVolumes(vmId: string): Promise<VmVolumeInfo[]> {
  return fetchAPI(`/vm-volumes/vm/${vmId}`);
}

// VM Volume File Operations
export interface VmVolumeFileInfo {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

export async function listVmVolumeFiles(volumeId: string, path: string = '/'): Promise<{ files: VmVolumeFileInfo[]; path: string }> {
  return fetchAPI(`/vm-volumes/${volumeId}/files?path=${encodeURIComponent(path)}`);
}

export async function uploadFileToVmVolume(volumeId: string, file: File, destPath: string = '/'): Promise<{ success: boolean; path: string }> {
  const apiBase = await getApiBase();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', destPath);

  const response = await fetch(`${apiBase}/vm-volumes/${volumeId}/files/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function downloadFileFromVmVolume(volumeId: string, filePath: string): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/vm-volumes/${volumeId}/files/download?path=${encodeURIComponent(filePath)}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.blob();
}

export async function deleteVmVolumeFile(volumeId: string, filePath: string): Promise<void> {
  await fetchAPI(`/vm-volumes/${volumeId}/files?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
}

// Download base image with progress streaming
export interface DownloadProgress {
  phase: string;
  progress: number;
  message: string;
}

export async function downloadBaseImage(
  name: string,
  imageUrl: string,
  kernelUrl: string,
  initrdUrl: string,
  onProgress: (progress: DownloadProgress) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/vms/base-images/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, imageUrl, kernelUrl, initrdUrl }),
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Download failed' }));
        onError(error.error || 'Download failed');
        reject(new Error(error.error || 'Download failed'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/s);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            try {
              const data = JSON.parse(dataMatch[1]);

              if (event === 'progress') {
                onProgress(data);
              } else if (event === 'done') {
                onDone();
                resolve();
              } else if (event === 'error') {
                onError(data.error || 'Download failed');
                reject(new Error(data.error || 'Download failed'));
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// ==================== Unified Sandbox API ====================

/**
 * Backend types for sandboxes
 */
export type SandboxBackend = 'docker' | 'firecracker' | 'daytona' | 'aws' | 'azure' | 'gcp' | 'digitalocean' | 'linode';

/**
 * Unified status across all backends
 */
export type SandboxStatus =
  | 'creating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'paused'
  | 'error'
  | 'archived'
  | 'building';

/**
 * Port mapping for sandboxes
 */
export interface SandboxPortMapping {
  container: number;
  host: number;
  protocol?: string;
}

/**
 * Docker-specific metadata
 */
export interface DockerMeta {
  type: 'docker';
  containerId: string;
  volumes: Array<{ name: string; mountPath: string }>;
  dockerState?: string;
  buildId?: string;
}

/**
 * VM-specific metadata
 */
export interface VmMeta {
  type: 'vm';
  hypervisor: 'firecracker';
  networkMode: string;
  hasSnapshots: boolean;
  tapDevice?: string;
  bootTimeMs?: number;
  volumes?: Array<{ id?: string; name: string; mountPath: string; sizeGb: number }>;
}

/**
 * Daytona-specific metadata
 */
export interface DaytonaMeta {
  type: 'daytona';
  sizeClass: 'small' | 'medium' | 'large';
  organizationId: string;
  target: string;
  daytonaState?: string;
}

/**
 * Unified Sandbox type - represents any compute environment
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
  /** Progress message during startup/boot */
  statusMessage?: string;

  // Resources
  vcpus: number;
  memoryMb: number;
  diskGb: number;

  // Network
  ports: SandboxPortMapping[];
  guestIp?: string;

  // Access
  terminalType: 'ssh' | 'docker-exec';
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshCommand?: string;
  /** Docker exec command for direct container access */
  dockerExecCommand?: string;
  /** SSH key identifier for download */
  sshKeyId?: string;

  // Metadata
  image: string;
  createdAt: string;
  startedAt?: string;

  /** Backend-specific metadata */
  backendMeta?: DockerMeta | VmMeta | DaytonaMeta | AwsMeta;
}

/**
 * AWS-specific metadata
 */
export interface AwsMeta {
  type: 'aws';
  instanceId: string;
  instanceType: string;
  spotRequestId?: string;
  volumeId?: string;
  availabilityZone: string;
  publicIp?: string;
  privateIp?: string;
  region: string;
  ec2State?: string;
  launchTime?: string;
  securityGroupId?: string;
  subnetId?: string;
  vpcId?: string;
}

/**
 * Response from listing sandboxes
 */
export interface SandboxListResponse {
  sandboxes: Sandbox[];
  backends: {
    docker: boolean;
    firecracker: boolean;
    daytona: boolean;
    aws: boolean;
    azure: boolean;
    gcp: boolean;
    digitalocean: boolean;
    linode: boolean;
  };
}

/**
 * Filter options for listing sandboxes
 */
export interface SandboxListFilter {
  backends?: SandboxBackend[];
  status?: SandboxStatus[];
  search?: string;
}

/**
 * Request to create a new sandbox
 */
export interface CreateSandboxRequest {
  name: string;
  backend: SandboxBackend;
  image: string;

  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;

  ports?: SandboxPortMapping[];

  dockerOptions?: {
    dockerfile?: string;
    volumes?: Array<{ name: string; mountPath: string }>;
    env?: Record<string, string>;
    enableSsh?: boolean;
  };

  vmOptions?: {
    hypervisor?: 'firecracker';
    networkMode?: 'bridged' | 'nat';
    volumes?: Array<{ id: string; mountPath: string }>;
  };

  daytonaOptions?: {
    sizeClass?: 'small' | 'medium' | 'large';
    language?: string;
    volumes?: Array<{ name: string; mountPath: string }>;
  };

  awsOptions?: {
    sizeClass?: 'small' | 'medium' | 'large';
    purchaseType?: 'spot' | 'on-demand';
    instanceType?: string;
    amiId?: string;
    volumeId?: string;
    volumeSizeGb?: number;
    availabilityZone?: string;
    securityGroupIds?: string[];
    subnetId?: string;
  };

  agentConfigId?: string;
}

/**
 * List all sandboxes with optional filtering
 */
export async function listSandboxes(filter?: SandboxListFilter): Promise<SandboxListResponse> {
  const params = new URLSearchParams();
  if (filter?.backends?.length) {
    params.set('backend', filter.backends.join(','));
  }
  if (filter?.status?.length) {
    params.set('status', filter.status.join(','));
  }
  if (filter?.search) {
    params.set('search', filter.search);
  }

  const query = params.toString();
  return fetchAPI(`/sandboxes${query ? `?${query}` : ''}`);
}

/**
 * Get backend availability status
 */
export async function getSandboxBackends(): Promise<Record<SandboxBackend, boolean>> {
  return fetchAPI('/sandboxes/backends');
}

/**
 * Get a specific sandbox by ID
 */
export async function getSandbox(id: string): Promise<Sandbox> {
  return fetchAPI(`/sandboxes/${encodeURIComponent(id)}`);
}

/**
 * Create a new sandbox
 */
export async function createSandbox(request: CreateSandboxRequest): Promise<Sandbox> {
  return fetchAPI('/sandboxes', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Start a stopped sandbox
 */
export async function startSandbox(id: string): Promise<Sandbox> {
  return fetchAPI(`/sandboxes/${encodeURIComponent(id)}/start`, { method: 'POST' });
}

/**
 * Stop a running sandbox
 */
export async function stopSandbox(id: string): Promise<Sandbox> {
  return fetchAPI(`/sandboxes/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

/**
 * Delete a sandbox
 */
export async function deleteSandbox(id: string): Promise<void> {
  await fetchAPI(`/sandboxes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Rename a sandbox (Firecracker VMs only)
 */
export async function renameSandbox(id: string, newName: string): Promise<Sandbox> {
  return fetchAPI(`/sandboxes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
}

/**
 * Update sandbox resources (vCPUs, memory, disk)
 */
export async function updateSandboxResources(id: string, resources: { vcpus?: number; memoryMb?: number; diskGb?: number }): Promise<Sandbox> {
  return fetchAPI(`/sandboxes/${encodeURIComponent(id)}/resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resources),
  });
}

/**
 * Get sandbox logs
 */
export async function getSandboxLogs(id: string, tail: number = 200): Promise<string> {
  const result = await fetchAPI<{ logs: string }>(`/sandboxes/${encodeURIComponent(id)}/logs?tail=${tail}`);
  return result.logs;
}

/**
 * Stream sandbox logs via SSE
 */
export async function streamSandboxLogs(
  id: string,
  callbacks: {
    onLog: (line: string) => void;
    onError?: (error: string) => void;
    onDone?: () => void;
  },
  tail: number = 100
): Promise<() => void> {
  const apiBase = await getApiBase();
  const controller = new AbortController();

  fetch(`${apiBase}/sandboxes/${encodeURIComponent(id)}/logs/stream?tail=${tail}`, {
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        callbacks.onError?.(`HTTP error: ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError?.('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          callbacks.onDone?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // Skip event line, data comes next
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              callbacks.onLog(data);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        callbacks.onError?.(error.message);
      }
    });

  // Return cleanup function
  return () => controller.abort();
}

/**
 * Download SSH key for a sandbox
 */
export async function downloadSandboxSshKey(id: string): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/sandboxes/${encodeURIComponent(id)}/ssh-key`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to download SSH key' }));
    throw new Error(error.error || 'Failed to download SSH key');
  }
  return response.blob();
}

/**
 * Download the global VM SSH private key
 */
export async function downloadGlobalSshKey(): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/ssh-keys/download`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to download SSH key' }));
    throw new Error(error.error || 'Failed to download SSH key');
  }
  return response.blob();
}

/**
 * Regenerate the global VM SSH keypair and download the new private key
 */
export async function regenerateSshKey(): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/ssh-keys/regenerate`, { method: 'POST' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to regenerate SSH key' }));
    throw new Error(error.error || 'Failed to regenerate SSH key');
  }
  return response.blob();
}

export async function getSshKeyInfo(): Promise<{ exists: boolean; publicKey: string | null }> {
  return fetchAPI<{ exists: boolean; publicKey: string | null }>('/ssh-keys/info');
}

/**
 * Get SSH command for a sandbox (creates SSH access for Daytona sandboxes)
 */
export async function getSandboxSshCommand(id: string): Promise<string> {
  const result = await fetchAPI<{ sshCommand: string }>(`/sandboxes/${encodeURIComponent(id)}/ssh-command`);
  return result.sshCommand;
}

/**
 * Upload a file to a sandbox's working directory
 */
export interface UploadHandle {
  promise: Promise<{ success: boolean; path?: string; filesUploaded?: number; destination?: string }>;
  abort: () => void;
}

export function uploadFileToSandbox(
  id: string,
  file: File,
  destPath: string = '/home/dev/workspace',
  onProgress?: (progress: UploadProgress) => void
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;

  const promise = (async () => {
    const apiBase = await getApiBase();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('destPath', destPath);

    return new Promise<{ success: boolean; path: string }>((resolve, reject) => {
      xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percent: Math.round((event.loaded / event.total) * 100),
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr!.status >= 200 && xhr!.status < 300) {
          try {
            resolve(JSON.parse(xhr!.responseText));
          } catch {
            resolve({ success: true, path: destPath });
          }
        } else {
          try {
            const error = JSON.parse(xhr!.responseText);
            reject(new Error(error.error || 'Upload failed'));
          } catch {
            reject(new Error(`Upload failed: HTTP ${xhr!.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed: Network error'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });

      xhr.open('POST', `${apiBase}/sandboxes/${encodeURIComponent(id)}/upload`);
      xhr.send(formData);
    });
  })();

  return {
    promise,
    abort: () => xhr?.abort(),
  };
}

/**
 * Upload a directory to a sandbox's working directory (uses tar for efficiency)
 */
export function uploadDirectoryToSandbox(
  id: string,
  files: Array<{ file: File; relativePath: string }>,
  destPath: string = '/home/dev/workspace',
  onProgress?: (progress: UploadProgress) => void
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;

  const promise = (async () => {
    const apiBase = await getApiBase();
    const formData = new FormData();

    // Append each file with its relative path
    for (const { file, relativePath } of files) {
      formData.append('files', file);
      formData.append('paths', relativePath);
    }
    formData.append('destPath', destPath);

    return new Promise<{ success: boolean; filesUploaded: number; destination: string }>((resolve, reject) => {
      xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percent: Math.round((event.loaded / event.total) * 100),
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr!.status >= 200 && xhr!.status < 300) {
          try {
            resolve(JSON.parse(xhr!.responseText));
          } catch {
            resolve({ success: true, filesUploaded: files.length, destination: destPath });
          }
        } else {
          try {
            const error = JSON.parse(xhr!.responseText);
            reject(new Error(error.error || 'Upload failed'));
          } catch {
            reject(new Error(`Upload failed: HTTP ${xhr!.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed: Network error'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });

      xhr.open('POST', `${apiBase}/sandboxes/${encodeURIComponent(id)}/upload-directory`);
      xhr.send(formData);
    });
  })();

  return {
    promise,
    abort: () => xhr?.abort(),
  };
}

/**
 * Download a file from a sandbox
 */
export async function downloadFileFromSandbox(id: string, filePath: string): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/sandboxes/${encodeURIComponent(id)}/files/download?path=${encodeURIComponent(filePath)}`);

  if (!response.ok) {
    let errorMsg = 'Failed to download file';
    try {
      const error = await response.json();
      errorMsg = error.error || errorMsg;
    } catch {
      // use default message
    }
    throw new Error(errorMsg);
  }

  return response.blob();
}

/**
 * List files in a sandbox directory
 */
export async function listSandboxFiles(id: string, path: string = '/'): Promise<{ files: VmFileInfo[]; path: string }> {
  return fetchAPI(`/sandboxes/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`);
}

// ==================== Unified Volume API ====================

/**
 * Volume backend types
 */
export type UnifiedVolumeBackend = 'docker' | 'vm' | 'daytona';

/**
 * Volume status types
 */
export type UnifiedVolumeStatus = 'creating' | 'ready' | 'attached' | 'error' | 'deleting';

/**
 * Volume attachment info
 */
export interface UnifiedVolumeAttachment {
  sandboxId: string;
  sandboxName: string;
  mountPath: string;
}

/**
 * Docker volume metadata
 */
export interface UnifiedDockerVolumeMeta {
  type: 'docker';
  driver: string;
  mountpoint: string;
}

/**
 * VM volume metadata
 */
export interface UnifiedVmVolumeMeta {
  type: 'vm';
  format: 'ext4' | 'xfs';
  devicePath: string;
  lastAttachedAt?: string;
}

/**
 * Daytona volume metadata
 */
export interface UnifiedDaytonaVolumeMeta {
  type: 'daytona';
  organizationId: string;
  daytonaState?: string;
}

/**
 * Unified Volume type
 */
export interface UnifiedVolume {
  id: string;
  name: string;
  backend: UnifiedVolumeBackend;
  status: UnifiedVolumeStatus;
  sizeGb?: number;
  actualSizeMb?: number;
  mountPath?: string;
  attachedTo: UnifiedVolumeAttachment[];
  createdAt: string;
  error?: string;
  backendMeta?: UnifiedDockerVolumeMeta | UnifiedVmVolumeMeta | UnifiedDaytonaVolumeMeta;
}

/**
 * Response from listing unified volumes
 */
export interface UnifiedVolumeListResponse {
  volumes: UnifiedVolume[];
  backends: Record<UnifiedVolumeBackend, boolean>;
}

/**
 * Filter options for listing unified volumes
 */
export interface UnifiedVolumeListFilter {
  backends?: UnifiedVolumeBackend[];
  status?: UnifiedVolumeStatus[];
  search?: string;
}

/**
 * Request to create a unified volume
 */
export interface CreateUnifiedVolumeRequest {
  name: string;
  backend?: UnifiedVolumeBackend;
  sizeGb?: number;
  format?: 'ext4' | 'xfs';
  mountPath?: string;
}

/**
 * File info for volume file listing
 */
export interface UnifiedVolumeFileInfo {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified?: string;
}

/**
 * List all unified volumes
 */
export async function listUnifiedVolumes(filter?: UnifiedVolumeListFilter): Promise<UnifiedVolumeListResponse> {
  const params = new URLSearchParams();
  if (filter?.backends?.length) {
    params.set('backend', filter.backends.join(','));
  }
  if (filter?.status?.length) {
    params.set('status', filter.status.join(','));
  }
  if (filter?.search) {
    params.set('search', filter.search);
  }

  const query = params.toString();
  return fetchAPI(`/unified-volumes${query ? `?${query}` : ''}`);
}

/**
 * Get unified volume backend availability
 */
export async function getUnifiedVolumeBackends(): Promise<Record<UnifiedVolumeBackend, boolean>> {
  return fetchAPI('/unified-volumes/backends');
}

/**
 * Get a specific unified volume
 */
export async function getUnifiedVolume(id: string): Promise<UnifiedVolume> {
  return fetchAPI(`/unified-volumes/${encodeURIComponent(id)}`);
}

/**
 * Create a new unified volume
 */
export async function createUnifiedVolume(request: CreateUnifiedVolumeRequest): Promise<UnifiedVolume> {
  return fetchAPI('/unified-volumes', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Delete a unified volume
 */
export async function deleteUnifiedVolume(id: string): Promise<void> {
  await fetchAPI(`/unified-volumes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * List files in a unified volume
 */
export async function listUnifiedVolumeFiles(id: string, path: string = '/'): Promise<{ files: UnifiedVolumeFileInfo[]; path: string }> {
  return fetchAPI(`/unified-volumes/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`);
}

/**
 * Upload a file to a unified volume
 */
export async function uploadToUnifiedVolume(id: string, file: File, destPath: string = '/'): Promise<{ success: boolean; path: string }> {
  const apiBase = await getApiBase();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', destPath);

  const response = await fetch(`${apiBase}/unified-volumes/${encodeURIComponent(id)}/files`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

/**
 * Download a file from a unified volume
 */
export async function downloadFromUnifiedVolume(id: string, filePath: string): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/unified-volumes/${encodeURIComponent(id)}/files/download?path=${encodeURIComponent(filePath)}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Download failed' }));
    throw new Error(error.error || 'Download failed');
  }

  return response.blob();
}

/**
 * Delete a file from a unified volume
 */
export async function deleteUnifiedVolumeFile(id: string, filePath: string): Promise<void> {
  await fetchAPI(`/unified-volumes/${encodeURIComponent(id)}/files?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
}

/**
 * Attach a volume to a sandbox (VM volumes only)
 */
export async function attachUnifiedVolume(volumeId: string, sandboxId: string): Promise<UnifiedVolume> {
  return fetchAPI(`/unified-volumes/${encodeURIComponent(volumeId)}/attach`, {
    method: 'POST',
    body: JSON.stringify({ sandboxId }),
  });
}

/**
 * Detach a volume from its sandbox (VM volumes only)
 */
export async function detachUnifiedVolume(volumeId: string): Promise<UnifiedVolume> {
  return fetchAPI(`/unified-volumes/${encodeURIComponent(volumeId)}/detach`, {
    method: 'POST',
  });
}

// ==================== Daytona Snapshots API ====================

/**
 * Daytona snapshot state
 */
export type DaytonaSnapshotState =
  | 'building'
  | 'pending'
  | 'pulling'
  | 'active'
  | 'inactive'
  | 'error'
  | 'build_failed'
  | 'removing';

/**
 * Daytona snapshot info
 */
export interface DaytonaSnapshot {
  id: string;
  organizationId?: string;
  general: boolean;
  name: string;
  imageName?: string;
  state: DaytonaSnapshotState;
  size: number | null;
  entrypoint: string[] | null;
  cpu: number;
  gpu: number;
  mem: number;
  disk: number;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  regionIds?: string[];
  ref?: string;
}

/**
 * Paginated snapshots response
 */
export interface DaytonaPaginatedSnapshots {
  items: DaytonaSnapshot[];
  total: number;
}

/**
 * List Daytona snapshots
 */
export async function listDaytonaSnapshots(options?: {
  page?: number;
  limit?: number;
  name?: string;
}): Promise<DaytonaPaginatedSnapshots> {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.name) params.set('name', options.name);
  const query = params.toString();
  return fetchAPI(`/daytona/snapshots${query ? `?${query}` : ''}`);
}

/**
 * Get a Daytona snapshot by ID or name
 */
export async function getDaytonaSnapshot(idOrName: string): Promise<DaytonaSnapshot> {
  return fetchAPI(`/daytona/snapshots/${encodeURIComponent(idOrName)}`);
}

/**
 * Create a Daytona snapshot from a registry image
 */
export async function createDaytonaSnapshot(request: {
  name: string;
  imageName?: string;
  entrypoint?: string[];
  cpu?: number;
  memory?: number;
  disk?: number;
  regionId?: string;
}): Promise<DaytonaSnapshot> {
  return fetchAPI('/daytona/snapshots', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Push a local Docker image to Daytona and create a snapshot
 */
export async function pushImageToDaytona(
  request: {
    localImage: string;
    snapshotName: string;
    cpu?: number;
    memory?: number;
    disk?: number;
    entrypoint?: string[];
    regionId?: string;
  },
  onProgress?: (message: string, type: 'info' | 'progress' | 'error' | 'done') => void
): Promise<DaytonaSnapshot> {
  const apiBase = await getApiBase();

  const response = await fetch(`${apiBase}/daytona/snapshots/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  // Check content type - if JSON, it's an error response
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const error = await response.json();
    throw new Error(error.error || 'Push failed');
  }

  // Otherwise it's an SSE stream
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let snapshot: DaytonaSnapshot | null = null;
  let lastError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events (events are separated by double newlines)
    const events = buffer.split('\n\n');
    buffer = events.pop() || ''; // Keep incomplete event in buffer

    for (const event of events) {
      if (!event.trim()) continue;

      const lines = event.split('\n');
      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        }
      }

      if (!eventType || !eventData) continue;

      // Parse the data (it's JSON-stringified)
      let parsedData: string;
      try {
        parsedData = JSON.parse(eventData);
      } catch {
        parsedData = eventData;
      }

      if (eventType === 'snapshot') {
        // Snapshot data is double-encoded (JSON string of JSON)
        try {
          snapshot = typeof parsedData === 'string' ? JSON.parse(parsedData) : parsedData;
        } catch {
          console.error('Failed to parse snapshot:', parsedData);
        }
      } else if (eventType === 'error') {
        lastError = parsedData;
        if (onProgress) {
          onProgress(parsedData, 'error');
        }
      } else if (onProgress && (eventType === 'info' || eventType === 'progress' || eventType === 'done')) {
        onProgress(parsedData, eventType as 'info' | 'progress' | 'done');
      }
    }
  }

  if (lastError && !snapshot) {
    throw new Error(lastError);
  }

  if (!snapshot) {
    throw new Error('No snapshot returned from push');
  }

  return snapshot;
}

/**
 * Delete a Daytona snapshot
 */
export async function deleteDaytonaSnapshot(id: string): Promise<void> {
  await fetchAPI(`/daytona/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Activate a Daytona snapshot
 */
export async function activateDaytonaSnapshot(id: string): Promise<DaytonaSnapshot> {
  return fetchAPI(`/daytona/snapshots/${encodeURIComponent(id)}/activate`, { method: 'POST' });
}

/**
 * Deactivate a Daytona snapshot
 */
export async function deactivateDaytonaSnapshot(id: string): Promise<void> {
  await fetchAPI(`/daytona/snapshots/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
}

// ==================== AWS Backend API ====================

/**
 * AWS size class presets for display
 */
export type AwsSizeClass = 'small' | 'medium' | 'large';

export const AWS_SIZE_PRESETS: Record<AwsSizeClass, {
  instanceType: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
  label: string;
}> = {
  small: { instanceType: 't3.micro', vcpus: 2, memoryMb: 1024, diskGb: 8, label: 'Small' },
  medium: { instanceType: 't3.medium', vcpus: 2, memoryMb: 4096, diskGb: 20, label: 'Medium' },
  large: { instanceType: 't3.large', vcpus: 2, memoryMb: 8192, diskGb: 30, label: 'Large' },
};

/**
 * AWS region info
 */
export interface AwsRegion {
  id: string;
  name: string;
}

/**
 * AWS configuration response
 */
export interface AwsConfigResponse {
  configured: boolean;
  region: string;
  enabled: boolean;
  hasCredentials?: boolean;
  hasSshKey?: boolean;
  sshKeyPath?: string;
  defaultVpcId?: string;
  defaultSubnetId?: string;
}

/**
 * Get AWS backend configuration
 */
export async function getAwsConfig(): Promise<AwsConfigResponse> {
  return fetchAPI('/backends/aws/config');
}

/**
 * Configure AWS backend
 */
export async function configureAws(config: {
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  enabled?: boolean;
  defaultVpcId?: string;
  defaultSubnetId?: string;
}): Promise<{ success: boolean; aws?: AwsConfigResponse }> {
  return fetchAPI('/backends/aws/configure', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/**
 * Test AWS connection
 */
export async function testAwsConnection(config?: {
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/aws/test', {
    method: 'POST',
    body: JSON.stringify(config || {}),
  });
}

/**
 * Get list of available AWS regions
 */
export async function listAwsRegions(): Promise<AwsRegion[]> {
  return fetchAPI('/backends/aws/regions');
}

/**
 * Get default AMIs per region
 */
export async function getAwsAmis(): Promise<Record<string, string>> {
  return fetchAPI('/backends/aws/amis');
}

/**
 * Get AWS size presets from server
 */
export async function getAwsSizes(): Promise<Record<AwsSizeClass, {
  instanceType: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
}>> {
  return fetchAPI('/backends/aws/sizes');
}

/**
 * Refresh AWS instance cache
 */
export async function refreshAwsCache(): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/aws/refresh', {
    method: 'POST',
  });
}

// ==================== Azure Backend API ====================

export interface AzureConfigResponse {
  configured: boolean;
  region: string;
  resourceGroup: string;
  enabled: boolean;
  hasCredentials?: boolean;
}

export async function getAzureConfig(): Promise<AzureConfigResponse> {
  return fetchAPI('/backends/azure/config');
}

export async function configureAzure(config: {
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  subscriptionId?: string;
  region?: string;
  resourceGroup?: string;
  enabled?: boolean;
}): Promise<{ success: boolean }> {
  return fetchAPI('/backends/azure/configure', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function testAzureConnection(config?: {
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  subscriptionId?: string;
  region?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/azure/test', {
    method: 'POST',
    body: JSON.stringify(config || {}),
  });
}

// ==================== GCP Backend API ====================

export interface GcpConfigResponse {
  configured: boolean;
  projectId: string;
  zone: string;
  enabled: boolean;
  hasCredentials?: boolean;
}

export async function getGcpConfig(): Promise<GcpConfigResponse> {
  return fetchAPI('/backends/gcp/config');
}

export async function configureGcp(config: {
  projectId?: string;
  keyFileJson?: string;
  zone?: string;
  enabled?: boolean;
}): Promise<{ success: boolean }> {
  return fetchAPI('/backends/gcp/configure', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function testGcpConnection(config?: {
  projectId?: string;
  keyFileJson?: string;
  zone?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/gcp/test', {
    method: 'POST',
    body: JSON.stringify(config || {}),
  });
}

// ==================== DigitalOcean Backend API ====================

export interface DigitalOceanConfigResponse {
  configured: boolean;
  region: string;
  enabled: boolean;
  hasCredentials?: boolean;
}

export async function getDigitalOceanConfig(): Promise<DigitalOceanConfigResponse> {
  return fetchAPI('/backends/digitalocean/config');
}

export async function configureDigitalOcean(config: {
  apiToken?: string;
  region?: string;
  enabled?: boolean;
}): Promise<{ success: boolean }> {
  return fetchAPI('/backends/digitalocean/configure', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function testDigitalOceanConnection(config?: {
  apiToken?: string;
  region?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/digitalocean/test', {
    method: 'POST',
    body: JSON.stringify(config || {}),
  });
}

// ==================== Linode Backend API ====================

export interface LinodeConfigResponse {
  configured: boolean;
  region: string;
  enabled: boolean;
  hasCredentials?: boolean;
}

export async function getLinodeConfig(): Promise<LinodeConfigResponse> {
  return fetchAPI('/backends/linode/config');
}

export async function configureLinode(config: {
  apiToken?: string;
  region?: string;
  enabled?: boolean;
}): Promise<{ success: boolean }> {
  return fetchAPI('/backends/linode/configure', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function testLinodeConnection(config?: {
  apiToken?: string;
  region?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/backends/linode/test', {
    method: 'POST',
    body: JSON.stringify(config || {}),
  });
}

/**
 * Download AWS SSH key
 */
export async function downloadAwsSshKey(): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/backends/aws/ssh-key`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to download SSH key' }));
    throw new Error(error.error || 'Failed to download SSH key');
  }
  return response.blob();
}

/**
 * List AWS-managed volumes
 */
export async function listAwsVolumes(): Promise<Array<{
  VolumeId: string;
  Size: number;
  State: string;
  AvailabilityZone: string;
  Tags?: Array<{ Key: string; Value: string }>;
}>> {
  return fetchAPI('/backends/aws/volumes');
}

/**
 * Create an AWS EBS volume
 */
export async function createAwsVolume(request: {
  name: string;
  sizeGb: number;
  availabilityZone?: string;
}): Promise<{ volumeId: string }> {
  return fetchAPI('/backends/aws/volumes', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Delete an AWS EBS volume
 */
export async function deleteAwsVolume(volumeId: string): Promise<{ success: boolean }> {
  return fetchAPI(`/backends/aws/volumes/${volumeId}`, { method: 'DELETE' });
}

// ==================== Container Registry API ====================

export type RegistryType = 'daytona' | 'ecr' | 'gcr' | 'acr' | 'dockerhub';

export interface AvailableRegistry {
  type: RegistryType;
  label: string;
  configured: boolean;
}

export interface PushRecord {
  id: string;
  localImage: string;
  remoteImage: string;
  imageName: string;
  registryType: RegistryType;
  registryUrl: string;
  pushedAt: string;
}

export interface RegistryPushRequest {
  localImage: string;
  imageName: string;
  registryType: RegistryType;
  ecrRegion?: string;
  gcrHostname?: string;
  acrLoginServer?: string;
  regionId?: string;
}

/**
 * List available (configured) registries
 */
export async function listAvailableRegistries(): Promise<AvailableRegistry[]> {
  return fetchAPI('/registry/available');
}

/**
 * Push an image to a registry with SSE progress streaming
 */
export async function pushImageToRegistry(
  request: RegistryPushRequest,
  onProgress?: (message: string, type: 'info' | 'progress' | 'error' | 'done') => void
): Promise<PushRecord> {
  const apiBase = await getApiBase();

  const response = await fetch(`${apiBase}/registry/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const error = await response.json();
    throw new Error(error.error || 'Push failed');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let record: PushRecord | null = null;
  let lastError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      if (!event.trim()) continue;

      const lines = event.split('\n');
      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) eventData = line.slice(6);
      }

      if (!eventType || !eventData) continue;

      let parsedData: string;
      try {
        parsedData = JSON.parse(eventData);
      } catch {
        parsedData = eventData;
      }

      if (eventType === 'result') {
        try {
          record = typeof parsedData === 'string' ? JSON.parse(parsedData) : parsedData;
        } catch {
          console.error('Failed to parse push result:', parsedData);
        }
      } else if (eventType === 'error') {
        lastError = parsedData;
        if (onProgress) onProgress(parsedData, 'error');
      } else if (onProgress && (eventType === 'info' || eventType === 'progress' || eventType === 'done')) {
        onProgress(parsedData, eventType as 'info' | 'progress' | 'done');
      }
    }
  }

  if (lastError && !record) throw new Error(lastError);
  if (!record) throw new Error('No result returned from push');

  return record;
}

/**
 * List push history records
 */
export async function listPushHistory(): Promise<PushRecord[]> {
  return fetchAPI('/registry/push-history');
}

/**
 * Delete a push history record
 */
export async function deletePushRecord(id: string): Promise<void> {
  await fetchAPI(`/registry/push-history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Test registry connectivity
 */
export async function testRegistryConnection(request: { registryType: RegistryType; acrLoginServer?: string }): Promise<{ success: boolean; message?: string; error?: string }> {
  return fetchAPI('/registry/test', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

// ==================== Docker Hub Config API ====================

/**
 * Get Docker Hub configuration status
 */
export async function getDockerHubConfig(): Promise<{ username: string; hasPassword: boolean; enabled: boolean; configured: boolean }> {
  return fetchAPI('/config/dockerhub');
}

/**
 * Configure Docker Hub credentials
 */
export async function configureDockerHub(config: { username?: string; password?: string; enabled: boolean }): Promise<void> {
  await fetchAPI('/config/dockerhub', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ==================== GitHub API ====================

export interface GitHubStatus {
  connected: boolean;
  username?: string;
  clientConfigured: boolean;
  visibleRepos?: 'all' | string[];
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
}

/**
 * Get GitHub connection status
 */
export async function getGitHubStatus(): Promise<GitHubStatus> {
  return fetchAPI('/github/status');
}

/**
 * Configure GitHub OAuth credentials
 */
export async function configureGitHub(clientId: string, clientSecret: string): Promise<void> {
  await fetchAPI('/github/configure', {
    method: 'POST',
    body: JSON.stringify({ clientId, clientSecret }),
  });
}

/**
 * Get GitHub OAuth authorization URL
 */
export async function getGitHubOAuthUrl(redirectUri: string): Promise<{ url: string }> {
  return fetchAPI(`/github/oauth-url?redirect_uri=${encodeURIComponent(redirectUri)}`);
}

/**
 * Exchange OAuth code for access token
 */
export async function exchangeGitHubCode(code: string, redirectUri: string): Promise<{ accessToken: string; username: string }> {
  return fetchAPI('/github/callback', {
    method: 'POST',
    body: JSON.stringify({ code, redirectUri }),
  });
}

/**
 * Disconnect GitHub account
 */
export async function disconnectGitHub(): Promise<void> {
  await fetchAPI('/github/disconnect', { method: 'POST' });
}

/**
 * Clear all GitHub credentials (OAuth app + access token)
 */
export async function clearGitHubCredentials(): Promise<void> {
  await fetchAPI('/github/clear-credentials', { method: 'POST' });
}

/**
 * List user's GitHub repositories
 */
export async function listGitHubRepos(options?: {
  page?: number;
  perPage?: number;
  sort?: 'updated' | 'pushed' | 'full_name';
  type?: 'all' | 'owner' | 'member';
}): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', options.page.toString());
  if (options?.perPage) params.set('per_page', options.perPage.toString());
  if (options?.sort) params.set('sort', options.sort);
  if (options?.type) params.set('type', options.type);

  const query = params.toString();
  return fetchAPI(`/github/repos${query ? `?${query}` : ''}`);
}

/**
 * Get a specific GitHub repository
 */
export async function getGitHubRepo(owner: string, repo: string): Promise<GitHubRepo> {
  return fetchAPI(`/github/repos/${owner}/${repo}`);
}

/**
 * Get current GitHub user
 */
export async function getGitHubUser(): Promise<GitHubUser> {
  return fetchAPI('/github/user');
}

/**
 * Set visible repos ('all' or array of repo full_names)
 */
export async function setGitHubVisibleRepos(visibleRepos: 'all' | string[]): Promise<void> {
  await fetchAPI('/github/visible-repos', {
    method: 'POST',
    body: JSON.stringify({ visibleRepos }),
  });
}

// ==================== GitHub App API ====================

export interface GitHubAppStatus {
  configured: boolean;
  installed: boolean;
  username?: string;
  installationId?: string;
  repositorySelection?: 'all' | 'selected';
  visibleRepos?: 'all' | string[];
}

export interface GitHubAppInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    avatar_url: string;
    type: string;
  };
  repository_selection: 'all' | 'selected';
  permissions: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface GitHubAppRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  owner: {
    login: string;
    avatar_url: string;
  };
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

/**
 * Get GitHub App status
 */
export async function getGitHubAppStatus(): Promise<GitHubAppStatus> {
  return fetchAPI('/github-app/status');
}

/**
 * Configure GitHub App (App ID and Private Key)
 */
export async function configureGitHubApp(appId: string, privateKey: string): Promise<void> {
  await fetchAPI('/github-app/configure', {
    method: 'POST',
    body: JSON.stringify({ appId, privateKey }),
  });
}

/**
 * List GitHub App installations
 */
export async function listGitHubAppInstallations(): Promise<{ installations: GitHubAppInstallation[] }> {
  return fetchAPI('/github-app/installations');
}

/**
 * Select a GitHub App installation
 */
export async function selectGitHubAppInstallation(installationId: string, username: string): Promise<void> {
  await fetchAPI('/github-app/select-installation', {
    method: 'POST',
    body: JSON.stringify({ installationId, username }),
  });
}

/**
 * Disconnect GitHub App
 */
export async function disconnectGitHubApp(): Promise<void> {
  await fetchAPI('/github-app/disconnect', { method: 'POST' });
}

/**
 * Clear all GitHub App credentials
 */
export async function clearGitHubAppCredentials(): Promise<void> {
  await fetchAPI('/github-app/clear-credentials', { method: 'POST' });
}

/**
 * List GitHub App repositories
 */
export async function listGitHubAppRepos(options?: {
  page?: number;
  perPage?: number;
}): Promise<{ repos: GitHubAppRepo[]; hasMore: boolean; totalCount: number }> {
  const params = new URLSearchParams();
  if (options?.page) params.set('page', options.page.toString());
  if (options?.perPage) params.set('per_page', options.perPage.toString());

  const query = params.toString();
  return fetchAPI(`/github-app/repos${query ? `?${query}` : ''}`);
}

/**
 * Get a specific GitHub App repository
 */
export async function getGitHubAppRepo(owner: string, repo: string): Promise<GitHubAppRepo> {
  return fetchAPI(`/github-app/repos/${owner}/${repo}`);
}

/**
 * Set visible repos for GitHub App
 */
export async function setGitHubAppVisibleRepos(visibleRepos: 'all' | string[]): Promise<void> {
  await fetchAPI('/github-app/visible-repos', {
    method: 'POST',
    body: JSON.stringify({ visibleRepos }),
  });
}

// ==================== Work API ====================

export interface WorkResult {
  sandboxId: string;
  repoName: string;
  branch: string;
  clonePath: string;
}

export interface StartWorkOptions {
  repoFullName: string;
  branch?: string;
  backend: SandboxBackend;
  agentConfigId?: string;
}

/**
 * Start work on a GitHub repository
 */
export async function startWork(options: StartWorkOptions): Promise<WorkResult> {
  return fetchAPI('/work/start', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

/**
 * Get work session status
 */
export async function getWorkStatus(sandboxId: string): Promise<{ status: string; ready: boolean }> {
  return fetchAPI(`/work/status/${sandboxId}`);
}

// ============ Agent Detection ============

export interface AgentInfo {
  id: string;
  name: string;
  installed: boolean;
  running: boolean;
}

export async function detectSandboxAgents(id: string): Promise<AgentInfo[]> {
  const result = await fetchAPI<{ agents: AgentInfo[] }>(`/sandboxes/${encodeURIComponent(id)}/agents`);
  return result.agents;
}

// ============ Guest Metrics ============

export interface GuestMetrics {
  cpuUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryUsage: number;
  diskUsed: number;
  diskTotal: number;
  diskUsage: number;
}

export async function getSandboxMetrics(id: string): Promise<GuestMetrics | null> {
  const result = await fetchAPI<{ metrics: GuestMetrics | null }>(`/sandboxes/${encodeURIComponent(id)}/metrics`);
  return result.metrics;
}

// ============ Tmux Sessions ============

export interface TmuxSessionInfo {
  name: string;
  windows: number;
  created: number;
}

export async function listTmuxSessions(id: string): Promise<TmuxSessionInfo[]> {
  const result = await fetchAPI<{ sessions: TmuxSessionInfo[] }>(`/sandboxes/${encodeURIComponent(id)}/tmux-sessions`);
  return result.sessions;
}

// ============ Terminal Summary (AI-powered) ============

export interface TerminalSummaryResult {
  summary: string | null;
  updatedAt?: number;
}

export async function getTerminalSummary(id: string): Promise<TerminalSummaryResult> {
  return fetchAPI<TerminalSummaryResult>(`/sandboxes/${encodeURIComponent(id)}/terminal-summary`);
}

// ============ Image Builder (dev-mode only) ============

export interface ImageBuilderDetail {
  name: string;
  hasQcow2: boolean;
  hasRootfs: boolean;
  hasKernel: boolean;
  qcow2SizeBytes: number | null;
  rootfsSizeBytes: number | null;
  kernelSizeBytes: number | null;
  modifiedAt: string | null;
  filesystemInfo?: string;
  isLayer: boolean;
  hasLayer: boolean;
  layerSizeBytes: number | null;
  parentImage: string | null;
  isMounted: boolean;
  mountCommand: string | null;
  umountCommand: string | null;
}

export interface BuildOperation {
  id: string;
  type: string;
  imageName?: string;
  startedAt: string;
}

export async function listBuilderImages(): Promise<ImageBuilderDetail[]> {
  return fetchAPI('/image-builder');
}

export async function inspectBuilderImage(name: string): Promise<ImageBuilderDetail> {
  return fetchAPI(`/image-builder/${encodeURIComponent(name)}`);
}

export async function deleteBuilderImage(name: string): Promise<{ success: boolean }> {
  return fetchAPI(`/image-builder/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function listBuildOperations(): Promise<BuildOperation[]> {
  return fetchAPI('/image-builder/operations/list');
}

export async function cancelBuildOperation(id: string): Promise<{ success: boolean }> {
  return fetchAPI(`/image-builder/operations/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export async function listAwsProfiles(): Promise<{ profiles: string[] }> {
  return fetchAPI('/image-builder/aws-profiles');
}

/**
 * Run an image builder SSE operation and stream output.
 * Returns a cancel function.
 */
function runBuilderSseOperation(
  url: string,
  method: string,
  body: unknown | undefined,
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    const serverUrl = getServerUrl();

    const fetchOpts: RequestInit = {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      fetchOpts.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${serverUrl}${url}`, fetchOpts);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Operation failed' }));
        onError(error.error || 'Operation failed');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const eventMatch = block.match(/event: (\w+)/);
          const dataMatch = block.match(/data: (.+)/s);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            try {
              const data = JSON.parse(dataMatch[1]);
              if (event === 'output') {
                onOutput(data.line);
              } else if (event === 'done') {
                onDone();
              } else if (event === 'error') {
                onError(data.error || 'Operation failed');
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        onError(err.message);
      }
    }
  })();

  return () => controller.abort();
}

export function prepareImage(
  name: string,
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): () => void {
  return runBuilderSseOperation(
    `/api/image-builder/${encodeURIComponent(name)}/prepare`,
    'POST', undefined, onOutput, onDone, onError,
  );
}

export function buildKernel(
  opts: { version?: string },
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): () => void {
  return runBuilderSseOperation(
    '/api/image-builder/kernel/build',
    'POST', opts.version ? { version: opts.version } : {}, onOutput, onDone, onError,
  );
}

export function uploadImage(
  name: string,
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  config?: { awsProfile?: string; s3Bucket?: string; s3Region?: string },
): () => void {
  return runBuilderSseOperation(
    `/api/image-builder/${encodeURIComponent(name)}/upload`,
    'POST', config || {}, onOutput, onDone, onError,
  );
}

export function downloadBuilderImage(
  name: string,
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): () => void {
  return runBuilderSseOperation(
    `/api/image-builder/${encodeURIComponent(name)}/download`,
    'POST', undefined, onOutput, onDone, onError,
  );
}

export function duplicateImage(
  sourceName: string,
  destName: string,
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): () => void {
  return runBuilderSseOperation(
    `/api/image-builder/${encodeURIComponent(sourceName)}/duplicate`,
    'POST', { name: destName }, onOutput, onDone, onError,
  );
}

// Global manifest management

export interface ManifestImage {
  name: string;
  description: string;
  type: string;
  path: string;
  default?: boolean;
}

export interface GlobalManifest {
  version: string;
  description: string;
  images: ManifestImage[];
}

export async function getGlobalManifest(): Promise<GlobalManifest> {
  return fetchAPI('/image-builder/manifest');
}

export async function addToManifest(name: string, description: string, isDefault?: boolean): Promise<GlobalManifest> {
  return fetchAPI('/image-builder/manifest/add', {
    method: 'POST',
    body: JSON.stringify({ name, description, isDefault }),
  });
}

export async function removeFromManifest(name: string): Promise<GlobalManifest> {
  return fetchAPI('/image-builder/manifest/remove', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function setManifestDefault(name: string): Promise<GlobalManifest> {
  return fetchAPI('/image-builder/manifest/set-default', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}
