/**
 * WorkModal - Modal for starting work on a GitHub repository
 */

import { useState } from 'react';
import { X, Loader2, Github, Server, Container, Zap, Cloud } from 'lucide-react';
import { useStartWork } from '../hooks/useGitHub';
import { useBackendStatus } from '../hooks/useContainers';
import { useAgentConfigs } from '../hooks/useAgentConfigs';
import type { GitHubRepo, SandboxBackend } from '../api/client';

interface WorkModalProps {
  repo: GitHubRepo;
  onClose: () => void;
}

const backendInfo: Record<SandboxBackend, { icon: typeof Container; label: string; description: string; color: string }> = {
  docker: {
    icon: Container,
    label: 'Docker',
    description: 'Container-based sandbox with shared kernel',
    color: 'cyan',
  },
  'cloud-hypervisor': {
    icon: Server,
    label: 'Cloud-Hypervisor',
    description: 'Lightweight VM with full isolation',
    color: 'purple',
  },
  firecracker: {
    icon: Zap,
    label: 'Firecracker',
    description: 'Fast microVM with minimal overhead',
    color: 'orange',
  },
  daytona: {
    icon: Cloud,
    label: 'Daytona',
    description: 'Cloud-based development environment',
    color: 'amber',
  },
  aws: {
    icon: Cloud,
    label: 'AWS EC2',
    description: 'Amazon EC2 instance',
    color: 'orange',
  },
  azure: {
    icon: Cloud,
    label: 'Azure VM',
    description: 'Azure Virtual Machine',
    color: 'cyan',
  },
  gcp: {
    icon: Cloud,
    label: 'Google Cloud',
    description: 'GCP Compute Engine instance',
    color: 'green',
  },
  digitalocean: {
    icon: Cloud,
    label: 'DigitalOcean',
    description: 'DigitalOcean Droplet',
    color: 'purple',
  },
  linode: {
    icon: Cloud,
    label: 'Linode',
    description: 'Linode instance',
    color: 'green',
  },
};

export function WorkModal({ repo, onClose }: WorkModalProps) {
  const [backend, setBackend] = useState<SandboxBackend>('docker');
  const [branch, setBranch] = useState(repo.default_branch);
  const [agentConfigId, setAgentConfigId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const startWork = useStartWork();
  const { data: backendStatus } = useBackendStatus();
  const { data: agentConfigs } = useAgentConfigs();

  // Get available backends
  const availableBackends = backendStatus ? (Object.entries(backendStatus) as [string, { installed?: boolean; enabled?: boolean; running?: boolean }][])
    .filter(([, status]) => status.installed || status.enabled || status.running)
    .map(([key]) => {
      // Map backend status keys to SandboxBackend values
      const keyMap: Record<string, SandboxBackend> = {
        docker: 'docker',
        cloudHypervisor: 'cloud-hypervisor',
        firecracker: 'firecracker',
        daytona: 'daytona',
        aws: 'aws',
        azure: 'azure',
        gcp: 'gcp',
        digitalocean: 'digitalocean',
        linode: 'linode',
      };
      return keyMap[key];
    })
    .filter((b): b is SandboxBackend => !!b && !!backendInfo[b])
    : [];

  const handleSubmit = async () => {
    setError(null);

    try {
      const result = await startWork.mutateAsync({
        repoFullName: repo.full_name,
        branch: branch !== repo.default_branch ? branch : undefined,
        backend,
        agentConfigId: agentConfigId || undefined,
      });

      // Navigate to agents view with the new sandbox
      window.dispatchEvent(new CustomEvent('handler-navigate-tab', { detail: { tab: 'agents' } }));
      onClose();

      // Optionally could trigger opening the terminal to the sandbox
      console.log('Work started:', result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start work');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-[hsl(var(--text-primary))]" />
            <div>
              <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                Start Work
              </h2>
              <p className="text-xs text-[hsl(var(--text-muted))]">
                {repo.full_name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Branch */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
              Branch
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
            />
          </div>

          {/* Backend Selection */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
              Sandbox Backend
            </label>
            <div className="grid grid-cols-2 gap-2">
              {availableBackends.map((backendKey) => {
                const info = backendInfo[backendKey];
                const Icon = info.icon;
                const isSelected = backend === backendKey;

                return (
                  <button
                    key={backendKey}
                    onClick={() => setBackend(backendKey)}
                    className={`flex items-center gap-3 p-3 text-left border transition-colors ${
                      isSelected
                        ? `border-[hsl(var(--${info.color}))] bg-[hsl(var(--${info.color})/0.1)]`
                        : 'border-[hsl(var(--border))] hover:border-[hsl(var(--border-hover))] hover:bg-[hsl(var(--bg-elevated))]'
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${isSelected ? `text-[hsl(var(--${info.color}))]` : 'text-[hsl(var(--text-muted))]'}`} />
                    <div>
                      <div className={`text-xs font-medium ${isSelected ? `text-[hsl(var(--${info.color}))]` : 'text-[hsl(var(--text-primary))]'}`}>
                        {info.label}
                      </div>
                      <div className="text-[10px] text-[hsl(var(--text-muted))]">
                        {info.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {availableBackends.length === 0 && (
              <p className="text-xs text-[hsl(var(--amber))] mt-2">
                No backends available. Please configure a backend in Settings.
              </p>
            )}
          </div>

          {/* Agent Config */}
          {agentConfigs?.configs && agentConfigs.configs.length > 0 && (
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
                Agent Config (optional)
              </label>
              <select
                value={agentConfigId}
                onChange={(e) => setAgentConfigId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
              >
                <option value="">None</option>
                {agentConfigs.configs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                Inject agent configuration into the sandbox after cloning
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-xs text-[hsl(var(--red))]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[hsl(var(--border))]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={startWork.isPending || availableBackends.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[hsl(var(--cyan))] text-white hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50 transition-colors"
          >
            {startWork.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Start Work
          </button>
        </div>
      </div>
    </div>
  );
}
