import { useState, useEffect } from 'react';
import { FolderOpen, Loader2, Sparkles, RotateCcw, Box, Cpu, Search, Maximize2, Server, Key, X, Cog, Download, Trash2, Power, PowerOff, CheckCircle, XCircle, AlertCircle, RefreshCw, Cloud, ChevronDown, Github, Globe, Zap, Palette, Keyboard } from 'lucide-react';
import { useConfig, useUpdateConfig, useQuickLaunchConfig, useSetQuickLaunchConfig, useDeleteQuickLaunchConfig, useImages, useVmBaseImages } from '../hooks/useContainers';
import { DirectoryPicker } from './DirectoryPicker';
import { downloadGlobalSshKey, regenerateSshKey } from '../api/client';
import * as api from '../api/client';
import type { ModelOption, BackendStatus, QuickLaunchConfig } from '../api/client';
import { CloudBackendsSettings } from './settings/CloudBackendsSettings';
import { FirecrackerInstallModal } from './settings/FirecrackerInstallModal';
import { GitHubSettings } from './settings/GitHubSettings';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { KeyboardShortcutsSettings } from './settings/KeyboardShortcutsSettings';

type SettingsTab = 'appearance' | 'general' | 'quick-launch' | 'self-hosting' | 'ai' | 'backends' | 'github' | 'keyboard';
type BackendsView = 'local' | 'cloud';

export function Settings() {
  const { data: config, isLoading } = useConfig();
  const updateMutation = useUpdateConfig();

  const [dataDirectory, setDataDirectory] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [sshJumpHost, setSshJumpHost] = useState('');
  const [sshJumpHostKeyPath, setSshJumpHostKeyPath] = useState('');
  const [sshKeysDisplayPath, setSshKeysDisplayPath] = useState('');
  const [tmuxEnabled, setTmuxEnabled] = useState(true);
  const [tmuxStatusBar, setTmuxStatusBar] = useState(false);
  const [showDataDirPicker, setShowDataDirPicker] = useState(false);

  // SSH Key management state
  const [sshKeyLoading, setSshKeyLoading] = useState<'download' | 'regenerate' | null>(null);
  const [sshKeyMessage, setSshKeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // AI Prompts state
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [dockerfilePrompt, setDockerfilePrompt] = useState('');
  const [mcpInstallPrompt, setMcpInstallPrompt] = useState('');
  const [mcpSearchPrompt, setMcpSearchPrompt] = useState('');
  const [defaultDockerfilePrompt, setDefaultDockerfilePrompt] = useState('');
  const [defaultMcpInstallPrompt, setDefaultMcpInstallPrompt] = useState('');
  const [defaultMcpSearchPrompt, setDefaultMcpSearchPrompt] = useState('');
  const [currentModel, setCurrentModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsSaving, setPromptsSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState<{
    key: 'dockerfile' | 'mcpSearch' | 'mcpInstall';
    label: string;
  } | null>(null);

  // Backends state
  const [backendsView, setBackendsView] = useState<BackendsView>('local');
  const [backends, setBackends] = useState<BackendStatus | null>(null);
  const [backendsLoading, setBackendsLoading] = useState(false);
  const [backendsError, setBackendsError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [showFirecrackerInstall, setShowFirecrackerInstall] = useState(false);

  // Quick Launch state
  const { data: quickLaunchConfig, isLoading: quickLaunchLoading } = useQuickLaunchConfig();
  const setQuickLaunchMutation = useSetQuickLaunchConfig();
  const deleteQuickLaunchMutation = useDeleteQuickLaunchConfig();
  const { data: dockerImages } = useImages();
  const { data: vmBaseImages } = useVmBaseImages();
  const [qlBackend, setQlBackend] = useState<string>('docker');
  const [qlImage, setQlImage] = useState('');
  const [qlPorts, setQlPorts] = useState('3000, 5173');
  const [qlVcpus, setQlVcpus] = useState('2');
  const [qlMemoryMb, setQlMemoryMb] = useState('2048');
  const [qlDiskGb, setQlDiskGb] = useState('10');
  const [qlNamePrefix, setQlNamePrefix] = useState('sandbox');

  useEffect(() => {
    if (config) {
      setDataDirectory(config.dataDirectory || '');
      setSshHost(config.sshHost || '');
      setSshJumpHost(config.sshJumpHost || '');
      setSshJumpHostKeyPath(config.sshJumpHostKeyPath || '');
      setSshKeysDisplayPath(config.sshKeysDisplayPath || '');
      setTmuxEnabled(config.tmuxEnabled !== false);
      setTmuxStatusBar(config.tmuxStatusBar === true);
    }
  }, [config]);

  // Load Quick Launch config
  useEffect(() => {
    if (quickLaunchConfig) {
      setQlBackend(quickLaunchConfig.backend);
      setQlImage(quickLaunchConfig.image || '');
      setQlPorts(quickLaunchConfig.ports?.join(', ') || '3000, 5173');
      setQlVcpus(String(quickLaunchConfig.vcpus || 2));
      setQlMemoryMb(String(quickLaunchConfig.memoryMb || 2048));
      setQlDiskGb(String(quickLaunchConfig.diskGb || 10));
      setQlNamePrefix(quickLaunchConfig.namePrefix || 'sandbox');
    }
  }, [quickLaunchConfig]);

  // Load AI prompts when switching to AI tab
  useEffect(() => {
    if (activeTab === 'ai') {
      setPromptsLoading(true);
      Promise.all([
        api.getAIStatus(),
        api.getAIPrompts(),
      ]).then(([status, prompts]) => {
        setAiConfigured(status.configured);
        setDockerfilePrompt(prompts.dockerfile.current);
        setMcpInstallPrompt(prompts.mcpInstall.current);
        setMcpSearchPrompt(prompts.mcpSearch.current);
        setDefaultDockerfilePrompt(prompts.dockerfile.default);
        setDefaultMcpInstallPrompt(prompts.mcpInstall.default);
        setDefaultMcpSearchPrompt(prompts.mcpSearch.default);
        setCurrentModel(prompts.model.current);
        setDefaultModel(prompts.model.default);
        setAvailableModels(prompts.model.available);
      }).catch(() => {
        setAiConfigured(false);
      }).finally(() => {
        setPromptsLoading(false);
      });
    }
  }, [activeTab]);

  // Load backends status when switching to backends tab
  useEffect(() => {
    if (activeTab === 'backends') {
      loadBackends();
    }
  }, [activeTab]);

  const loadBackends = async () => {
    setBackendsLoading(true);
    setBackendsError(null);
    try {
      const status = await api.getBackendStatus();
      setBackends(status);
    } catch (err) {
      setBackendsError(err instanceof Error ? err.message : 'Failed to load backend status');
    } finally {
      setBackendsLoading(false);
    }
  };

  const handleBackendAction = async (backend: string, action: 'enable' | 'disable' | 'install' | 'uninstall') => {
    setActionInProgress(`${backend}-${action}`);
    try {
      await api.performBackendAction(backend, action);
      await loadBackends();
    } catch (err) {
      setBackendsError(err instanceof Error ? err.message : `Failed to ${action} ${backend}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSavePrompts = async () => {
    setPromptsSaving(true);
    try {
      const dockerfilePromptToSave = dockerfilePrompt === defaultDockerfilePrompt ? null : dockerfilePrompt;
      const mcpInstallPromptToSave = mcpInstallPrompt === defaultMcpInstallPrompt ? null : mcpInstallPrompt;
      const mcpSearchPromptToSave = mcpSearchPrompt === defaultMcpSearchPrompt ? null : mcpSearchPrompt;
      const modelToSave = currentModel === defaultModel ? null : currentModel;

      await Promise.all([
        api.updateDockerfilePrompt(dockerfilePromptToSave),
        api.updateMCPInstallPrompt(mcpInstallPromptToSave),
        api.updateMCPSearchPrompt(mcpSearchPromptToSave),
        api.updateModel(modelToSave),
      ]);
    } finally {
      setPromptsSaving(false);
    }
  };

  const handleResetDockerfilePrompt = () => setDockerfilePrompt(defaultDockerfilePrompt);
  const handleResetMcpInstallPrompt = () => setMcpInstallPrompt(defaultMcpInstallPrompt);
  const handleResetMcpSearchPrompt = () => setMcpSearchPrompt(defaultMcpSearchPrompt);
  const handleResetModel = () => setCurrentModel(defaultModel);

  const getPromptValue = (key: 'dockerfile' | 'mcpSearch' | 'mcpInstall') => {
    switch (key) {
      case 'dockerfile': return dockerfilePrompt;
      case 'mcpSearch': return mcpSearchPrompt;
      case 'mcpInstall': return mcpInstallPrompt;
    }
  };

  const setPromptValue = (key: 'dockerfile' | 'mcpSearch' | 'mcpInstall', value: string) => {
    switch (key) {
      case 'dockerfile': setDockerfilePrompt(value); break;
      case 'mcpSearch': setMcpSearchPrompt(value); break;
      case 'mcpInstall': setMcpInstallPrompt(value); break;
    }
  };

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      sshHost: sshHost || '',
      sshJumpHost: sshJumpHost || '',
      sshJumpHostKeyPath: sshJumpHostKeyPath || '',
      sshKeysDisplayPath: sshKeysDisplayPath || '~/.ssh',
      dataDirectory: dataDirectory || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] px-4">
        <button
          onClick={() => setActiveTab('appearance')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'appearance'
              ? 'border-[hsl(var(--cyan))] text-[hsl(var(--cyan))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Palette className="h-3.5 w-3.5" />
          Appearance
        </button>
        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'general'
              ? 'border-[hsl(var(--cyan))] text-[hsl(var(--cyan))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          General
        </button>
        <button
          onClick={() => setActiveTab('quick-launch')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'quick-launch'
              ? 'border-[hsl(var(--green))] text-[hsl(var(--green))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          Quick Launch
        </button>
        <button
          onClick={() => setActiveTab('backends')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'backends'
              ? 'border-[hsl(var(--green))] text-[hsl(var(--green))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Cog className="h-3.5 w-3.5" />
          Backends
        </button>
        <button
          onClick={() => setActiveTab('self-hosting')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'self-hosting'
              ? 'border-[hsl(var(--amber))] text-[hsl(var(--amber))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          Self-Hosting
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'ai'
              ? 'border-[hsl(var(--purple))] text-[hsl(var(--purple))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Prompts
        </button>
        <button
          onClick={() => setActiveTab('github')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'github'
              ? 'border-[hsl(var(--text-primary))] text-[hsl(var(--text-primary))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Github className="h-3.5 w-3.5" />
          GitHub
        </button>
        <button
          onClick={() => setActiveTab('keyboard')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'keyboard'
              ? 'border-[hsl(var(--cyan))] text-[hsl(var(--cyan))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Keyboard className="h-3.5 w-3.5" />
          Keyboard
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className={activeTab === 'backends' && backendsView === 'cloud' ? '' : activeTab === 'github' ? 'max-w-2xl mx-auto' : 'max-w-3xl mx-auto'}>
          {activeTab === 'appearance' && (
            <AppearanceSettings />
          )}

          {activeTab === 'general' && (
            <div className="space-y-6">
              {/* Data Directory */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Data Directory
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  Where volumes, SSH keys, and dockerfiles are stored on the server.
                </p>
                <div className="flex border border-[hsl(var(--border))] overflow-hidden">
                  <div className="flex-1 px-3 py-2 text-xs bg-[hsl(var(--bg-base))] text-[hsl(var(--text-primary))] truncate">
                    {dataDirectory || <span className="text-[hsl(var(--text-muted))]">Default (project/data)</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDataDirPicker(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Browse
                  </button>
                </div>
              </div>

              {/* Session Persistence */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  Session Persistence (tmux)
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  Use tmux for persistent terminal sessions that survive disconnects and server restarts.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const newVal = !tmuxEnabled;
                        setTmuxEnabled(newVal);
                        updateMutation.mutate({ tmuxEnabled: newVal });
                      }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        tmuxEnabled ? 'bg-[hsl(var(--cyan))]' : 'bg-[hsl(var(--text-muted)/0.3)]'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          tmuxEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-[hsl(var(--text-secondary))]">
                      {tmuxEnabled ? 'Enabled' : 'Disabled'} — tmux sessions {tmuxEnabled ? 'persist across disconnects' : 'are not used'}
                    </span>
                  </div>
                  {tmuxEnabled && (
                    <div className="flex items-center gap-2 pl-11">
                      <button
                        onClick={() => {
                          const newVal = !tmuxStatusBar;
                          setTmuxStatusBar(newVal);
                          updateMutation.mutate({ tmuxStatusBar: newVal });
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          tmuxStatusBar ? 'bg-[hsl(var(--cyan))]' : 'bg-[hsl(var(--text-muted)/0.3)]'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            tmuxStatusBar ? 'translate-x-4.5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-xs text-[hsl(var(--text-secondary))]">
                        Show tmux status bar
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* SSH Keys Display Path */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Key className="h-3.5 w-3.5" />
                  SSH Keys Display Path
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  The path shown in SSH commands for finding the private key on your local machine.
                </p>
                <input
                  type="text"
                  value={sshKeysDisplayPath}
                  onChange={(e) => setSshKeysDisplayPath(e.target.value)}
                  placeholder="~/.ssh"
                  className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>

              {/* Preview */}
              <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
                <div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Server Volumes Path</p>
                  <code className="text-[10px] text-[hsl(var(--text-secondary))] block break-all">
                    {dataDirectory ? `${dataDirectory}/volumes/` : '(default)'}
                  </code>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
                <button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50"
                >
                  {updateMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {activeTab === 'quick-launch' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Quick Launch Configuration</h3>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                  Configure defaults for the "New Sandbox" button. When set, clicking New Sandbox will instantly create a sandbox with these settings.
                </p>
              </div>

              {quickLaunchLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
                </div>
              ) : (
                <>
                  {/* Backend Selection */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                      <Server className="h-3.5 w-3.5" />
                      Backend
                    </label>
                    <select
                      value={qlBackend}
                      onChange={(e) => setQlBackend(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                    >
                      <option value="docker">Docker</option>
                      <option value="firecracker">Firecracker (VM)</option>
                      <option value="cloud-hypervisor">Cloud-Hypervisor (VM)</option>
                      <option value="daytona">Daytona</option>
                      <option value="aws">AWS</option>
                      <option value="azure">Azure</option>
                      <option value="gcp">GCP</option>
                      <option value="digitalocean">DigitalOcean</option>
                      <option value="linode">Linode</option>
                    </select>
                  </div>

                  {/* Name Prefix */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                      Name Prefix
                    </label>
                    <p className="text-[10px] text-[hsl(var(--text-muted))] mb-2">
                      Auto-generated names will use this prefix (e.g., "dev" → "dev-1", "dev-2")
                    </p>
                    <input
                      type="text"
                      value={qlNamePrefix}
                      onChange={(e) => setQlNamePrefix(e.target.value)}
                      placeholder="sandbox"
                      className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                    />
                  </div>

                  {/* Image Selection - changes based on backend type */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                      {qlBackend === 'docker' ? <Box className="h-3.5 w-3.5" /> : <Cpu className="h-3.5 w-3.5" />}
                      {qlBackend === 'docker' ? 'Docker Image' : 'Base Image'}
                    </label>
                    <p className="text-[10px] text-[hsl(var(--text-muted))] mb-2">
                      {qlBackend === 'docker'
                        ? 'Select a Docker image to use for new containers'
                        : 'Select a VM base image for new virtual machines'}
                    </p>
                    <select
                      value={qlImage}
                      onChange={(e) => setQlImage(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                    >
                      <option value="">Select an image...</option>
                      {qlBackend === 'docker' ? (
                        dockerImages?.map((img) => (
                          <option key={img.id} value={img.repoTags?.[0] || img.id}>
                            {img.repoTags?.[0] || img.id.slice(0, 12)}
                          </option>
                        ))
                      ) : (qlBackend === 'firecracker' || qlBackend === 'cloud-hypervisor') ? (
                        vmBaseImages?.map((img) => (
                          <option key={img.name} value={img.name}>
                            {img.name}
                          </option>
                        ))
                      ) : null}
                    </select>
                    {qlBackend === 'docker' && dockerImages?.length === 0 && (
                      <p className="text-[10px] text-[hsl(var(--amber))] mt-1">No Docker images found. Build or pull an image first.</p>
                    )}
                    {(qlBackend === 'firecracker' || qlBackend === 'cloud-hypervisor') && vmBaseImages?.length === 0 && (
                      <p className="text-[10px] text-[hsl(var(--amber))] mt-1">No VM base images found. Run prepare-fc-image.sh to create one.</p>
                    )}
                  </div>

                  {/* VM Resources */}
                  {(qlBackend === 'firecracker' || qlBackend === 'cloud-hypervisor' || qlBackend.match(/^(aws|azure|gcp|digitalocean|linode)$/)) && (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-2 block">vCPUs</label>
                        <input
                          type="number"
                          value={qlVcpus}
                          onChange={(e) => setQlVcpus(e.target.value)}
                          min="1"
                          className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-2 block">Memory (MB)</label>
                        <input
                          type="number"
                          value={qlMemoryMb}
                          onChange={(e) => setQlMemoryMb(e.target.value)}
                          min="512"
                          step="512"
                          className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-2 block">Disk (GB)</label>
                        <input
                          type="number"
                          value={qlDiskGb}
                          onChange={(e) => setQlDiskGb(e.target.value)}
                          min="5"
                          className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Ports */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                      Quick Access Ports
                    </label>
                    <p className="text-[10px] text-[hsl(var(--text-muted))] mb-2">
                      Comma-separated list of ports to expose (e.g., "3000, 5173, 8080")
                    </p>
                    <input
                      type="text"
                      value={qlPorts}
                      onChange={(e) => setQlPorts(e.target.value)}
                      placeholder="3000, 5173"
                      className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                    />
                  </div>

                  {/* Preview */}
                  <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-2">
                    <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Preview</p>
                    <p className="text-xs text-[hsl(var(--text-primary))]">
                      Clicking <span className="text-[hsl(var(--green))]">New Sandbox</span> will create:
                    </p>
                    <ul className="text-[10px] text-[hsl(var(--text-secondary))] space-y-1 ml-4 list-disc">
                      <li>Backend: <span className="text-[hsl(var(--cyan))]">{qlBackend}</span></li>
                      <li>Name: <span className="text-[hsl(var(--cyan))]">{qlNamePrefix || 'sandbox'}-1</span> (auto-incremented)</li>
                      {qlImage && (
                        <li>Image: <span className="text-[hsl(var(--cyan))]">{qlImage}</span></li>
                      )}
                      {qlPorts && <li>Ports: <span className="text-[hsl(var(--cyan))]">{qlPorts}</span></li>}
                    </ul>
                  </div>

                  {/* Save/Reset Buttons */}
                  <div className="flex justify-between pt-4 border-t border-[hsl(var(--border))]">
                    <button
                      onClick={() => deleteQuickLaunchMutation.mutate()}
                      disabled={deleteQuickLaunchMutation.isPending || !quickLaunchConfig}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
                    >
                      {deleteQuickLaunchMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Reset to Default
                    </button>
                    <button
                      onClick={() => {
                        const ports = qlPorts.split(',').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p));
                        setQuickLaunchMutation.mutate({
                          backend: qlBackend as QuickLaunchConfig['backend'],
                          image: qlImage || undefined,
                          ports: ports.length > 0 ? ports : undefined,
                          vcpus: parseInt(qlVcpus, 10) || undefined,
                          memoryMb: parseInt(qlMemoryMb, 10) || undefined,
                          diskGb: parseInt(qlDiskGb, 10) || undefined,
                          namePrefix: qlNamePrefix || undefined,
                        });
                      }}
                      disabled={setQuickLaunchMutation.isPending}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
                    >
                      {setQuickLaunchMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Save Quick Launch
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'self-hosting' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Remote Access Configuration</h3>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                  Configure SSH settings for accessing Handler when running on a remote server
                </p>
              </div>

              {/* SSH Host */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Server className="h-3.5 w-3.5" />
                  SSH Host
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  The hostname or IP used in SSH connection commands. Leave empty for localhost.
                </p>
                <input
                  type="text"
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder="e.g., my-server.example.com or 192.168.1.100"
                  className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>

              {/* SSH Jump Host */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Server className="h-3.5 w-3.5" />
                  SSH Jump Host (ProxyJump)
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  Optional bastion/jump host for reaching VMs on internal networks. Format: user@host or user@host:port
                </p>
                <input
                  type="text"
                  value={sshJumpHost}
                  onChange={(e) => setSshJumpHost(e.target.value)}
                  placeholder="e.g., ubuntu@my-azure-vm.example.com"
                  className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>

              {/* SSH Jump Host Key Path */}
              {sshJumpHost && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                    <Key className="h-3.5 w-3.5" />
                    Jump Host SSH Key Path
                  </label>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                    Path to the SSH key for authenticating to the jump host (on your local machine).
                  </p>
                  <input
                    type="text"
                    value={sshJumpHostKeyPath}
                    onChange={(e) => setSshJumpHostKeyPath(e.target.value)}
                    placeholder="e.g., ~/.ssh/azure-vm-key.pem"
                    className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                  />
                </div>
              )}

              {/* Preview */}
              <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
                <div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">
                    Example SSH Command {sshJumpHost && sshJumpHostKeyPath ? '(Remote via jump host)' : '(Local)'}
                  </p>
                  <code className="text-[10px] text-[hsl(var(--cyan))] block break-all font-mono">
                    {sshJumpHost && sshJumpHostKeyPath
                      ? `ssh -o ProxyCommand="ssh -i ${sshJumpHostKeyPath} -W %h:%p ${sshJumpHost}" -i ${sshKeysDisplayPath || '~/.ssh'}/vm_id_ed25519 agent@172.31.0.2`
                      : `ssh -i ${sshKeysDisplayPath || '~/.ssh'}/vm_id_ed25519 agent@${sshHost || '172.31.0.2'}`
                    }
                  </code>
                </div>
                {sshJumpHost && sshJumpHostKeyPath && (
                  <div className="text-[10px] text-[hsl(var(--text-muted))]">
                    Connections will proxy through <span className="text-[hsl(var(--purple))]">{sshJumpHost}</span> to reach VMs
                  </div>
                )}
                {sshJumpHost && !sshJumpHostKeyPath && (
                  <div className="text-[10px] text-[hsl(var(--amber))]">
                    Add Jump Host SSH Key Path to enable remote access
                  </div>
                )}
              </div>

              {/* VM SSH Key Management */}
              <div className="pt-6 border-t border-[hsl(var(--border))]">
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Key className="h-3.5 w-3.5" />
                  VM SSH Key
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  This key is used for SSH access to all VM backends (Firecracker, Cloud-Hypervisor). Download the private key to connect from your machine, or regenerate to create a fresh keypair.
                </p>

                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setSshKeyLoading('download');
                      setSshKeyMessage(null);
                      try {
                        const blob = await downloadGlobalSshKey();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'handler_vm_key.pem';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        setSshKeyMessage({ type: 'success', text: 'Private key downloaded' });
                      } catch (err) {
                        setSshKeyMessage({ type: 'error', text: err instanceof Error ? err.message : 'Download failed' });
                      } finally {
                        setSshKeyLoading(null);
                      }
                    }}
                    disabled={sshKeyLoading !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] disabled:opacity-50"
                  >
                    {sshKeyLoading === 'download' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    Download Current Key
                  </button>

                  <button
                    onClick={async () => {
                      setSshKeyLoading('regenerate');
                      setSshKeyMessage(null);
                      try {
                        const blob = await regenerateSshKey();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'handler_vm_key.pem';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        setSshKeyMessage({ type: 'success', text: 'New keypair generated and private key downloaded' });
                      } catch (err) {
                        setSshKeyMessage({ type: 'error', text: err instanceof Error ? err.message : 'Regeneration failed' });
                      } finally {
                        setSshKeyLoading(null);
                      }
                    }}
                    disabled={sshKeyLoading !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] disabled:opacity-50"
                  >
                    {sshKeyLoading === 'regenerate' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Regenerate Key
                  </button>
                </div>

                {sshKeyMessage && (
                  <p className={`text-[10px] mt-2 ${
                    sshKeyMessage.type === 'success' ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--red))]'
                  }`}>
                    {sshKeyMessage.text}
                  </p>
                )}

                <p className="text-[10px] text-[hsl(var(--text-muted))] mt-2">
                  Regenerating will require rebooting running VMs for the new key to take effect.
                </p>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
                <button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[hsl(var(--amber))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--amber)/0.9)] disabled:opacity-50"
                >
                  {updateMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {activeTab === 'backends' && (
            <div className="space-y-6">
              {/* Local/Cloud Toggle */}
              <div className="flex items-center justify-center relative">
                <div className="flex items-center gap-1 p-1 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
                  <button
                    onClick={() => setBackendsView('local')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                      backendsView === 'local'
                        ? 'bg-[hsl(var(--green)/0.2)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.3)]'
                        : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                    }`}
                  >
                    <Server className="h-3.5 w-3.5" />
                    Local
                  </button>
                  <button
                    onClick={() => setBackendsView('cloud')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                      backendsView === 'cloud'
                        ? 'bg-[hsl(var(--amber)/0.2)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.3)]'
                        : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                    }`}
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    Cloud
                  </button>
                </div>
                {backendsView === 'local' && (
                  <button
                    onClick={loadBackends}
                    disabled={backendsLoading}
                    className="absolute right-0 flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${backendsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                )}
              </div>

              {/* Local Backends */}
              {backendsView === 'local' && (
                <>
                  <div>
                    <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Local Backends</h3>
                    <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                      Manage container and VM runtime backends on this machine
                    </p>
                  </div>

                  {backendsError && (
                    <div className="p-3 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-xs text-[hsl(var(--red))]">
                      {backendsError}
                    </div>
                  )}

                  {backendsLoading && !backends ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
                    </div>
                  ) : backends ? (
                    <div className="space-y-4">
                      {/* Docker */}
                      <BackendCard
                        name="Docker"
                        description="Container runtime for running containers"
                        status={backends.docker}
                        icon={<Box className="h-5 w-5" />}
                        onAction={(action) => handleBackendAction('docker', action)}
                        actionInProgress={actionInProgress?.startsWith('docker-') ? actionInProgress : null}
                      />

                      {/* Cloud-Hypervisor */}
                      <BackendCard
                        name="Cloud-Hypervisor"
                        description="Lightweight hypervisor for running virtual machines"
                        status={backends.cloudHypervisor}
                        icon={<Server className="h-5 w-5" />}
                        onAction={(action) => handleBackendAction('cloud-hypervisor', action)}
                        actionInProgress={actionInProgress?.startsWith('cloud-hypervisor-') ? actionInProgress : null}
                      />

                      {/* Firecracker */}
                      <BackendCard
                        name="Firecracker"
                        description="MicroVM hypervisor with fast snapshot restore via MMDS"
                        status={backends.firecracker}
                        icon={<Cpu className="h-5 w-5" />}
                        onAction={(action) => handleBackendAction('firecracker', action)}
                        actionInProgress={actionInProgress?.startsWith('firecracker-') ? actionInProgress : null}
                        customInstallHandler={() => setShowFirecrackerInstall(true)}
                      />
                    </div>
                  ) : null}

                  {/* Info section */}
                  <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
                    <h4 className="text-xs font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">About Local Backends</h4>
                    <div className="space-y-2 text-[10px] text-[hsl(var(--text-muted))]">
                      <p><strong className="text-[hsl(var(--cyan))]">Docker</strong>: Standard container runtime. Best for development environments and services.</p>
                      <p><strong className="text-[hsl(var(--green))]">Cloud-Hypervisor</strong>: Modern hypervisor for VMs. Great for isolation and production-like environments.</p>
                      <p><strong className="text-[hsl(var(--purple))]">Firecracker</strong>: MicroVM technology with ~125ms snapshot restore. Ideal for golden images and rapid provisioning.</p>
                    </div>
                  </div>
                </>
              )}

              {/* Cloud Backends */}
              {backendsView === 'cloud' && (
                <CloudBackendsSettings />
              )}
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              {promptsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
                </div>
              ) : (
                <>
                  {!aiConfigured && (
                    <div className="p-3 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)] text-xs text-[#06B6D4]">
                      AI is not configured. Add <code className="bg-[hsl(var(--bg-base))] px-1">OPENROUTER_API_KEY</code> to <code className="bg-[hsl(var(--bg-base))] px-1">.env.local</code> to enable AI features.
                    </div>
                  )}

                  {/* Model Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))]">
                        <Cpu className="h-3.5 w-3.5" />
                        AI Model
                      </label>
                      <button
                        onClick={handleResetModel}
                        disabled={currentModel === defaultModel}
                        className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </button>
                    </div>
                    <p className="text-[10px] text-[hsl(var(--text-muted))] mb-2">
                      Select the model used for all AI features via OpenRouter.
                    </p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] hover:border-[hsl(var(--purple)/0.5)]"
                      >
                        <span>
                          {availableModels.find(m => m.id === currentModel)?.name || currentModel}
                        </span>
                        <ChevronDown className={`h-3.5 w-3.5 text-[hsl(var(--text-muted))] transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} />
                      </button>

                      {showModelDropdown && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-auto bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg">
                          {availableModels.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => {
                                setCurrentModel(model.id);
                                setShowModelDropdown(false);
                              }}
                              className={`w-full px-3 py-2 text-left text-xs hover:bg-[hsl(var(--bg-overlay))] flex items-center justify-between ${
                                currentModel === model.id
                                  ? 'text-[hsl(var(--purple))] bg-[hsl(var(--purple)/0.1)]'
                                  : 'text-[hsl(var(--text-primary))]'
                              }`}
                            >
                              <span>{model.name}</span>
                              {currentModel === model.id && (
                                <span className="text-[10px] text-[hsl(var(--purple))]">selected</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Dockerfile Prompt */}
                  <PromptEditor
                    label="Dockerfile Assistant Prompt"
                    value={dockerfilePrompt}
                    onChange={setDockerfilePrompt}
                    defaultValue={defaultDockerfilePrompt}
                    onReset={handleResetDockerfilePrompt}
                    onExpand={() => setExpandedPrompt({ key: 'dockerfile', label: 'Dockerfile Assistant Prompt' })}
                    placeholder="System prompt for Dockerfile AI assistant..."
                  />

                  {/* MCP Search Prompt */}
                  <PromptEditor
                    label="MCP Registry AI Search Prompt"
                    value={mcpSearchPrompt}
                    onChange={setMcpSearchPrompt}
                    defaultValue={defaultMcpSearchPrompt}
                    onReset={handleResetMcpSearchPrompt}
                    onExpand={() => setExpandedPrompt({ key: 'mcpSearch', label: 'MCP Registry AI Search Prompt' })}
                    placeholder="System prompt for MCP AI search..."
                    icon={<Search className="h-3.5 w-3.5" />}
                    description="Prompt used for AI-powered semantic search through MCP servers."
                  />

                  {/* MCP Install Prompt */}
                  <PromptEditor
                    label="MCP Install Instructions Prompt"
                    value={mcpInstallPrompt}
                    onChange={setMcpInstallPrompt}
                    defaultValue={defaultMcpInstallPrompt}
                    onReset={handleResetMcpInstallPrompt}
                    onExpand={() => setExpandedPrompt({ key: 'mcpInstall', label: 'MCP Install Instructions Prompt' })}
                    placeholder="System prompt for MCP install instructions extraction..."
                    description="Prompt used to extract installation instructions from MCP server READMEs."
                  />

                  {/* Save Button */}
                  <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
                    <button
                      onClick={handleSavePrompts}
                      disabled={promptsSaving || promptsLoading}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)] disabled:opacity-50"
                    >
                      {promptsSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                      Save Prompts
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'github' && (
            <GitHubSettings />
          )}

          {activeTab === 'keyboard' && (
            <KeyboardShortcutsSettings />
          )}

        </div>
      </div>

      {/* Directory Picker Modal */}
      {showDataDirPicker && (
        <DirectoryPicker
          initialPath={dataDirectory || undefined}
          onSelect={(path) => {
            setDataDirectory(path);
            setShowDataDirPicker(false);
          }}
          onCancel={() => setShowDataDirPicker(false)}
        />
      )}

      {/* Expanded Prompt Editor Modal */}
      {expandedPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
          <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
              <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                {expandedPrompt.label}
              </h3>
              <button
                onClick={() => setExpandedPrompt(null)}
                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 p-4">
              <textarea
                value={getPromptValue(expandedPrompt.key)}
                onChange={(e) => setPromptValue(expandedPrompt.key, e.target.value)}
                className="w-full h-full p-4 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] resize-none font-mono"
                placeholder="Enter system prompt..."
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))]">
              <button
                onClick={() => setExpandedPrompt(null)}
                className="px-4 py-2 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Firecracker Install Modal */}
      {showFirecrackerInstall && (
        <FirecrackerInstallModal
          onClose={() => {
            setShowFirecrackerInstall(false);
            loadBackends();
          }}
        />
      )}
    </div>
  );
}

// Backend Card Component
interface BackendInfo {
  installed: boolean;
  enabled: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

interface BackendCardProps {
  name: string;
  description: string;
  status: BackendInfo;
  icon: React.ReactNode;
  onAction: (action: 'enable' | 'disable' | 'install' | 'uninstall') => void;
  actionInProgress: string | null;
  customInstallHandler?: () => void;
}

function BackendCard({ name, description, status, icon, onAction, actionInProgress, customInstallHandler }: BackendCardProps) {
  const getStatusIcon = () => {
    if (!status.installed) return <XCircle className="h-4 w-4 text-[hsl(var(--text-muted))]" />;
    if (status.error) return <AlertCircle className="h-4 w-4 text-[hsl(var(--red))]" />;
    if (status.running) return <CheckCircle className="h-4 w-4 text-[hsl(var(--green))]" />;
    if (status.enabled) return <Power className="h-4 w-4 text-[#06B6D4]" />;
    return <PowerOff className="h-4 w-4 text-[hsl(var(--text-muted))]" />;
  };

  const getStatusText = () => {
    if (!status.installed) return 'Not Installed';
    if (status.error) return status.error;
    if (status.running) return 'Running';
    if (status.enabled) return 'Enabled (Not Running)';
    return 'Disabled';
  };

  const getStatusColor = () => {
    if (!status.installed) return 'text-[hsl(var(--text-muted))]';
    if (status.error) return 'text-[hsl(var(--red))]';
    if (status.running) return 'text-[hsl(var(--green))]';
    if (status.enabled) return 'text-[#06B6D4]';
    return 'text-[hsl(var(--text-muted))]';
  };

  const isLoading = actionInProgress !== null;

  return (
    <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
      <div className="flex items-start gap-4">
        <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))]">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">{name}</h4>
            {status.version && (
              <span className="text-[10px] text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-base))] px-1.5 py-0.5">
                v{status.version}
              </span>
            )}
          </div>
          <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">{description}</p>
          <div className="flex items-center gap-1.5 mt-2">
            {getStatusIcon()}
            <span className={`text-[10px] ${getStatusColor()}`}>{getStatusText()}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {status.installed ? (
            <>
              {status.enabled ? (
                <button
                  onClick={() => onAction('disable')}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[#06B6D4] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] disabled:opacity-50"
                >
                  {actionInProgress === `${name.toLowerCase().replace('-', '')}-disable` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <PowerOff className="h-3 w-3" />
                  )}
                  Disable
                </button>
              ) : (
                <button
                  onClick={() => onAction('enable')}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
                >
                  {actionInProgress === `${name.toLowerCase().replace('-', '')}-enable` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Power className="h-3 w-3" />
                  )}
                  Enable
                </button>
              )}
              <button
                onClick={() => onAction('uninstall')}
                disabled={isLoading}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
              >
                {actionInProgress === `${name.toLowerCase().replace('-', '')}-uninstall` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Uninstall
              </button>
            </>
          ) : (
            <button
              onClick={() => customInstallHandler ? customInstallHandler() : onAction('install')}
              disabled={isLoading}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] disabled:opacity-50"
            >
              {actionInProgress === `${name.toLowerCase().replace('-', '')}-install` ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Prompt Editor Component
interface PromptEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultValue: string;
  onReset: () => void;
  onExpand: () => void;
  placeholder: string;
  icon?: React.ReactNode;
  description?: string;
}

function PromptEditor({ label, value, onChange, defaultValue, onReset, onExpand, placeholder, icon, description }: PromptEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))]">
          {icon}
          {label}
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={onExpand}
            className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <Maximize2 className="h-3 w-3" />
            Expand
          </button>
          <button
            onClick={onReset}
            disabled={value === defaultValue}
            className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>
      {description && (
        <p className="text-[10px] text-[hsl(var(--text-muted))] mb-2">{description}</p>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className="w-full p-3 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] resize-y"
        placeholder={placeholder}
      />
    </div>
  );
}
