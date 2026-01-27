// Server URL configuration
// Uses SERVER_PORT env var at build time, or defaults to 4001
// Always uses the same hostname as the frontend for remote access compatibility
const SERVER_PORT = import.meta.env.VITE_SERVER_PORT || '4001';

function getServerUrl(): string {
  const host = window.location.hostname || 'localhost';
  return `http://${host}:${SERVER_PORT}`;
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

// Dockerfiles
export async function listDockerfiles(): Promise<string[]> {
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

export async function buildDockerfile(
  name: string,
  onLog: (log: string) => void,
  onDone: (tag: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    // Use fetch with streaming for SSE
    fetch(`${serverUrl}/api/dockerfiles/${name}/build`, {
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
export async function checkHealth(): Promise<{ status: string; docker: string }> {
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

export interface AppConfig {
  sshKeysDisplayPath: string;
  sshHost: string;
  sshJumpHost: string; // Jump host for ProxyJump (e.g., user@bastion.example.com)
  sshJumpHostKeyPath: string; // Path to SSH key for jump host (e.g., ~/.ssh/jump_key.pem)
  dataDirectory: string;
  defaultDevNodeImage: string;
  cloudBackends?: CloudBackendsConfig;
}

export async function getConfig(): Promise<AppConfig> {
  return fetchAPI('/config');
}

export async function updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
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

// Compose
export interface ComposeService {
  name: string;
  containerId: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created' | 'unknown';
  image: string;
  ports: Array<{ container: number; host: number | null }>;
  sshPort: number | null;
}

export interface ComposeProject {
  name: string;
  status: 'running' | 'partial' | 'stopped';
  services: ComposeService[];
  createdAt: string;
}

export interface ComposeContent {
  name: string;
  content: string;
}

export async function listComposeProjects(): Promise<ComposeProject[]> {
  return fetchAPI('/composes');
}

export async function getComposeProject(name: string): Promise<ComposeProject> {
  return fetchAPI(`/composes/${name}`);
}

export async function getComposeContent(name: string): Promise<ComposeContent> {
  return fetchAPI(`/composes/${name}/content`);
}

export async function createComposeProject(name: string, content: string): Promise<ComposeProject> {
  return fetchAPI('/composes', {
    method: 'POST',
    body: JSON.stringify({ name, content }),
  });
}

export async function updateComposeProject(name: string, content: string): Promise<ComposeProject> {
  return fetchAPI(`/composes/${name}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function deleteComposeProject(name: string): Promise<void> {
  await fetchAPI(`/composes/${name}`, { method: 'DELETE' });
}

export async function renameComposeProject(name: string, newName: string): Promise<ComposeProject> {
  return fetchAPI(`/composes/${name}/rename`, {
    method: 'POST',
    body: JSON.stringify({ newName }),
  });
}

export async function composeUp(
  name: string,
  onLog: (log: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/composes/${name}/up`, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to start' }));
        onError(error.error || 'Failed to start');
        reject(new Error(error.error || 'Failed to start'));
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

export async function composeDown(
  name: string,
  onLog: (log: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/composes/${name}/down`, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to stop' }));
        onError(error.error || 'Failed to stop');
        reject(new Error(error.error || 'Failed to stop'));
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

// AI Chat
export interface AIStatus {
  configured: boolean;
}

export async function getAIStatus(): Promise<AIStatus> {
  return fetchAPI('/ai/status');
}

export async function streamComposeChat(
  message: string,
  composeContent: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = getServerUrl();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/ai/compose-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, composeContent }),
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
  compose: AIPromptInfo;
  dockerfile: AIPromptInfo;
  mcpInstall: AIPromptInfo;
  mcpSearch: AIPromptInfo;
  model: ModelInfo;
}

export async function getAIPrompts(): Promise<AIPrompts> {
  return fetchAPI('/ai/prompts');
}

export async function updateComposePrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/compose', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
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

// Components
export interface ComponentPort {
  container: number;
  host?: number;
  description?: string;
}

export interface ComponentVolume {
  name: string;
  path: string;
  description?: string;
}

export interface ComponentEnvVar {
  name: string;
  value: string;
  description?: string;
  required?: boolean;
}

export interface Component {
  id: string;
  name: string;
  description: string;
  category: 'database' | 'cache' | 'web' | 'messaging' | 'storage' | 'monitoring' | 'development' | 'other';
  icon?: string;
  image: string;
  defaultTag: string;
  ports: ComponentPort[];
  volumes: ComponentVolume[];
  environment: ComponentEnvVar[];
  healthcheck?: {
    test: string;
    interval?: string;
    timeout?: string;
    retries?: number;
  };
  dependsOn?: string[];
  networks?: string[];
  builtIn: boolean;
  createdAt: string;
}

export async function listComponents(): Promise<Component[]> {
  return fetchAPI('/components');
}

export async function getComponent(id: string): Promise<Component> {
  return fetchAPI(`/components/${id}`);
}

export async function getComponentsByCategory(category: Component['category']): Promise<Component[]> {
  return fetchAPI(`/components/category/${category}`);
}

export async function createComponent(component: Omit<Component, 'id' | 'builtIn' | 'createdAt'>): Promise<Component> {
  return fetchAPI('/components', {
    method: 'POST',
    body: JSON.stringify(component),
  });
}

export async function updateComponent(id: string, updates: Partial<Omit<Component, 'id' | 'builtIn' | 'createdAt'>>): Promise<Component> {
  return fetchAPI(`/components/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteComponent(id: string): Promise<void> {
  await fetchAPI(`/components/${id}`, { method: 'DELETE' });
}

export async function getComponentYaml(id: string, serviceName?: string): Promise<{ yaml: string }> {
  const params = serviceName ? `?name=${encodeURIComponent(serviceName)}` : '';
  return fetchAPI(`/components/${id}/yaml${params}`);
}

export async function createComponentFromAI(request: string): Promise<{ success: boolean; component: Component }> {
  return fetchAPI('/ai/create-component', {
    method: 'POST',
    body: JSON.stringify({ request }),
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

export type HypervisorType = 'cloud-hypervisor' | 'firecracker' | 'daytona';

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
  cloudHypervisor: BackendInfo;
  firecracker: BackendInfo;
  daytona: BackendInfo;
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
export type SandboxBackend = 'docker' | 'cloud-hypervisor' | 'firecracker' | 'daytona';

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
  hypervisor: 'cloud-hypervisor' | 'firecracker';
  networkMode: string;
  hasSnapshots: boolean;
  tapDevice?: string;
  bootTimeMs?: number;
  volumes?: Array<{ name: string; mountPath: string; sizeGb: number }>;
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
  backendMeta?: DockerMeta | VmMeta | DaytonaMeta;
}

/**
 * Response from listing sandboxes
 */
export interface SandboxListResponse {
  sandboxes: Sandbox[];
  backends: {
    docker: boolean;
    'cloud-hypervisor': boolean;
    firecracker: boolean;
    daytona: boolean;
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
    hypervisor?: 'cloud-hypervisor' | 'firecracker';
    networkMode?: 'bridged' | 'nat';
    volumes?: Array<{ id: string; mountPath: string }>;
  };

  daytonaOptions?: {
    sizeClass?: 'small' | 'medium' | 'large';
    language?: string;
    volumes?: Array<{ name: string; mountPath: string }>;
  };
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
 * Upload a file to a sandbox's working directory
 */
export async function uploadFileToSandbox(
  id: string,
  file: File,
  destPath: string = '/home/dev/workspace'
): Promise<{ success: boolean; path: string }> {
  const apiBase = await getApiBase();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('destPath', destPath);

  const response = await fetch(`${apiBase}/sandboxes/${encodeURIComponent(id)}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }
  return response.json();
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
