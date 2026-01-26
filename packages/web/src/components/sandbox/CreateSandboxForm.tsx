/**
 * CreateSandboxForm - Unified form for creating sandboxes across all backends
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { X, Loader2, Plus, Check, HardDrive, Box, Server, Cloud } from 'lucide-react';
import { useCreateSandbox, useSandboxBackends, useSandboxes } from '../../hooks/useSandboxes';
import { useVolumes, useImages, useConfig, useCreateVolume } from '../../hooks/useContainers';
import type { SandboxBackend } from '../../api/client';

interface CreateSandboxFormProps {
  onClose: () => void;
}

// Generate a random suffix for volume names
function generateRandomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

// Backend display info
const BACKEND_INFO: Record<SandboxBackend, { label: string; icon: typeof Box; description: string }> = {
  docker: {
    label: 'Docker',
    icon: Box,
    description: 'Container-based sandbox. Fast startup, easy volume management.',
  },
  'cloud-hypervisor': {
    label: 'Cloud-Hypervisor',
    icon: Server,
    description: 'Full VM with QCOW2 overlay. Strong isolation, larger resources.',
  },
  firecracker: {
    label: 'Firecracker',
    icon: Server,
    description: 'Lightweight microVM. Fast startup, moderate isolation.',
  },
  daytona: {
    label: 'Daytona',
    icon: Cloud,
    description: 'Cloud-hosted workspace. Accessible anywhere, no local resources.',
  },
};

export function CreateSandboxForm({ onClose }: CreateSandboxFormProps) {
  const createMutation = useCreateSandbox();
  const createVolumeMutation = useCreateVolume();
  const { data: backends } = useSandboxBackends();
  const { data: volumes } = useVolumes();
  const { data: images } = useImages();
  const { data: sandboxes } = useSandboxes();
  const { data: config } = useConfig();

  // Form state
  const [backend, setBackend] = useState<SandboxBackend | null>(null);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [vcpus, setVcpus] = useState(2);
  const [memoryMb, setMemoryMb] = useState(2048);
  const [diskGb, setDiskGb] = useState(20);
  const [selectedVolumes, setSelectedVolumes] = useState<Array<{ name: string; mountPath: string }>>([]);
  const [ports, setPorts] = useState<Array<{ container: number; host: number }>>([]);
  const [newContainerPort, setNewContainerPort] = useState('');
  const [newHostPort, setNewHostPort] = useState('');

  // Inline volume creation state
  const [isCreatingVolume, setIsCreatingVolume] = useState(false);
  const [newVolumeName, setNewVolumeName] = useState('');
  const newVolumeInputRef = useRef<HTMLInputElement>(null);

  // Calculate ports already in use
  const usedHostPorts = useMemo(() => {
    const usedPorts = new Set<number>();
    if (sandboxes?.sandboxes) {
      for (const sandbox of sandboxes.sandboxes) {
        for (const port of sandbox.ports || []) {
          usedPorts.add(port.host);
        }
      }
    }
    return usedPorts;
  }, [sandboxes]);

  // Find the next available host port
  const findNextAvailablePort = (startPort: number, excludePorts: Set<number> = new Set()): number => {
    const allUsed = new Set([...usedHostPorts, ...excludePorts]);
    let port = startPort;
    while (allUsed.has(port) && port > 1024) {
      port--;
    }
    return port;
  };

  // Set default ports when Docker is selected
  useEffect(() => {
    if (backend === 'docker' && ports.length === 0) {
      const defaultPort1 = findNextAvailablePort(9999);
      const defaultPort2 = findNextAvailablePort(9998, new Set([defaultPort1]));
      setPorts([
        { host: defaultPort1, container: 3000 },
        { host: defaultPort2, container: 5173 },
      ]);
    }
  }, [backend]);

  // Available backends (filter by what's installed/enabled)
  const availableBackends = useMemo(() => {
    if (!backends) return [];
    return (Object.keys(backends) as SandboxBackend[]).filter((b) => backends[b]);
  }, [backends]);

  // Use config default image if set
  const fallbackImage = images?.flatMap((i) => i.repoTags).find((tag) => tag && tag !== '<none>:<none>') || 'ubuntu:24.04';
  const defaultImage = config?.defaultDevNodeImage || fallbackImage;
  const selectedImage = image || defaultImage;

  // Common base images
  const commonImages = [
    'ubuntu:24.04',
    'ubuntu:22.04',
    'debian:bookworm',
    'debian:bullseye',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backend) return;

    try {
      await createMutation.mutateAsync({
        name,
        backend,
        image: selectedImage,
        vcpus,
        memoryMb,
        diskGb,
        ports: ports.length > 0 ? ports : undefined,
        dockerOptions: backend === 'docker' ? {
          volumes: selectedVolumes.length > 0 ? selectedVolumes : undefined,
        } : undefined,
        vmOptions: (backend === 'cloud-hypervisor' || backend === 'firecracker') ? {
          hypervisor: backend,
        } : undefined,
        daytonaOptions: backend === 'daytona' ? {
          sizeClass: memoryMb <= 2048 ? 'small' : memoryMb <= 8192 ? 'medium' : 'large',
        } : undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create sandbox:', error);
    }
  };

  // Get next available host port
  const getNextHostPort = () => {
    const formPorts = new Set(ports.map(p => p.host));
    const allUsed = new Set([...usedHostPorts, ...formPorts]);
    let nextPort = 9999;
    while (allUsed.has(nextPort) && nextPort > 1024) {
      nextPort--;
    }
    return nextPort;
  };

  const addPort = () => {
    const containerPort = parseInt(newContainerPort, 10);
    const hostPort = parseInt(newHostPort, 10);
    if (containerPort && hostPort) {
      setPorts([...ports, { container: containerPort, host: hostPort }]);
      setNewContainerPort('');
      setNewHostPort('');
    }
  };

  const removePort = (index: number) => {
    setPorts(ports.filter((_, i) => i !== index));
  };

  // Volume creation handlers
  const startVolumeCreation = () => {
    const baseName = name.trim() || `volume-${generateRandomSuffix()}`;
    setNewVolumeName(baseName);
    setIsCreatingVolume(true);
  };

  useEffect(() => {
    if (isCreatingVolume && newVolumeInputRef.current) {
      newVolumeInputRef.current.focus();
      newVolumeInputRef.current.select();
    }
  }, [isCreatingVolume]);

  const cancelVolumeCreation = () => {
    setIsCreatingVolume(false);
    setNewVolumeName('');
  };

  const confirmVolumeCreation = async () => {
    if (!newVolumeName.trim()) return;

    try {
      await createVolumeMutation.mutateAsync(newVolumeName.trim());
      setSelectedVolumes([
        ...selectedVolumes,
        { name: newVolumeName.trim(), mountPath: '/home/dev/workspace' },
      ]);
      setIsCreatingVolume(false);
      setNewVolumeName('');
    } catch (error) {
      console.error('Failed to create volume:', error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="w-full max-w-lg bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-6 shadow-lg animate-scale-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[hsl(var(--text-primary))]">
            {backend ? `Create ${BACKEND_INFO[backend].label} Sandbox` : 'Create Sandbox'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Backend Selection (Step 1) */}
        {!backend && (
          <div className="space-y-3">
            <p className="text-xs text-[hsl(var(--text-muted))]">
              Choose a backend for your sandbox:
            </p>
            <div className="grid grid-cols-2 gap-3">
              {availableBackends.map((b) => {
                const info = BACKEND_INFO[b];
                const Icon = info.icon;
                return (
                  <button
                    key={b}
                    onClick={() => setBackend(b)}
                    className="p-4 text-left border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] hover:border-[hsl(var(--cyan)/0.5)] hover:bg-[hsl(var(--cyan)/0.05)] transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="h-5 w-5 text-[hsl(var(--cyan))]" />
                      <span className="text-sm font-medium text-[hsl(var(--text-primary))]">{info.label}</span>
                    </div>
                    <p className="text-[10px] text-[hsl(var(--text-muted))]">{info.description}</p>
                  </button>
                );
              })}
            </div>
            {availableBackends.length === 0 && (
              <p className="text-xs text-[hsl(var(--text-muted))] text-center py-4">
                No backends available. Please check your configuration.
              </p>
            )}
          </div>
        )}

        {/* Configuration Form (Step 2) */}
        {backend && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Back to backend selection */}
            <button
              type="button"
              onClick={() => setBackend(null)}
              className="text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
            >
              ← Change backend
            </button>

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
                Sandbox Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-sandbox"
                required
                autoFocus
                pattern="^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$"
                className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)]"
              />
            </div>

            {/* Image (Docker only for now) */}
            {backend === 'docker' && (
              <div>
                <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
                  Image
                </label>
                <select
                  value={selectedImage}
                  onChange={(e) => setImage(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)]"
                >
                  {images && images.length > 0 && (
                    <optgroup label="Built Images (ready to use)">
                      {images
                        .flatMap((i) => i.repoTags)
                        .filter((tag) => tag && tag !== '<none>:<none>')
                        .map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  <optgroup label="Base Images (will build with SSH setup)">
                    {commonImages.map((img) => (
                      <option key={img} value={img}>
                        {img}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="mt-1.5 text-[10px] text-[hsl(var(--text-muted))]">
                  Built images launch instantly. Base images require a one-time build.
                </p>
              </div>
            )}

            {/* Resources (VMs only) */}
            {(backend === 'cloud-hypervisor' || backend === 'firecracker') && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
                    vCPUs
                  </label>
                  <select
                    value={vcpus}
                    onChange={(e) => setVcpus(parseInt(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                  >
                    {[1, 2, 4, 8, 16].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
                    Memory
                  </label>
                  <select
                    value={memoryMb}
                    onChange={(e) => setMemoryMb(parseInt(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                  >
                    {[1024, 2048, 4096, 8192, 16384].map((n) => (
                      <option key={n} value={n}>{n >= 1024 ? `${n/1024}GB` : `${n}MB`}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
                    Disk
                  </label>
                  <select
                    value={diskGb}
                    onChange={(e) => setDiskGb(parseInt(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>{n}GB</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Daytona size class */}
            {backend === 'daytona' && (
              <div>
                <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
                  Size
                </label>
                <select
                  value={memoryMb <= 2048 ? 'small' : memoryMb <= 8192 ? 'medium' : 'large'}
                  onChange={(e) => {
                    const size = e.target.value;
                    if (size === 'small') { setVcpus(2); setMemoryMb(2048); setDiskGb(20); }
                    if (size === 'medium') { setVcpus(4); setMemoryMb(8192); setDiskGb(50); }
                    if (size === 'large') { setVcpus(8); setMemoryMb(16384); setDiskGb(100); }
                  }}
                  className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                >
                  <option value="small">Small (2 vCPU, 2GB RAM, 20GB disk)</option>
                  <option value="medium">Medium (4 vCPU, 8GB RAM, 50GB disk)</option>
                  <option value="large">Large (8 vCPU, 16GB RAM, 100GB disk)</option>
                </select>
              </div>
            )}

            {/* Volumes (Docker only) */}
            {backend === 'docker' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider">
                    Volumes (mounted to ~/workspace)
                  </label>
                  {!isCreatingVolume && (
                    <button
                      type="button"
                      onClick={startVolumeCreation}
                      className="flex items-center gap-1 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]"
                    >
                      <Plus className="h-3 w-3" />
                      New Volume
                    </button>
                  )}
                </div>

                <div className="space-y-2 border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] p-3 max-h-40 overflow-y-auto">
                  {/* Inline volume creation */}
                  {isCreatingVolume && (
                    <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[hsl(var(--border))]">
                      <HardDrive className="h-4 w-4 text-[hsl(var(--text-muted))] flex-shrink-0" />
                      <input
                        ref={newVolumeInputRef}
                        type="text"
                        value={newVolumeName}
                        onChange={(e) => setNewVolumeName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            confirmVolumeCreation();
                          } else if (e.key === 'Escape') {
                            cancelVolumeCreation();
                          }
                        }}
                        placeholder="volume-name"
                        className="flex-1 text-xs px-2 py-1 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={confirmVolumeCreation}
                        disabled={!newVolumeName.trim() || createVolumeMutation.isPending}
                        className="p-1 text-[hsl(var(--green))] hover:text-[hsl(var(--green-dim))] disabled:opacity-50"
                        title="Create volume"
                      >
                        {createVolumeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={cancelVolumeCreation}
                        disabled={createVolumeMutation.isPending}
                        className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))] disabled:opacity-50"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {createVolumeMutation.error && (
                    <div className="text-[10px] text-[hsl(var(--red))] pb-2">
                      {createVolumeMutation.error.message}
                    </div>
                  )}

                  {volumes && volumes.length > 0 ? (
                    volumes.map((vol) => {
                      const isSelected = selectedVolumes.some((v) => v.name === vol.name);
                      return (
                        <label key={vol.name} className="flex items-center gap-3 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedVolumes([
                                  ...selectedVolumes,
                                  { name: vol.name, mountPath: '/home/dev/workspace' },
                                ]);
                              } else {
                                setSelectedVolumes(selectedVolumes.filter((v) => v.name !== vol.name));
                              }
                            }}
                            className="h-4 w-4 rounded border-[hsl(var(--border))] bg-[hsl(var(--input-bg))] text-[hsl(var(--cyan))] focus:ring-[hsl(var(--cyan))]"
                          />
                          <span className="text-xs text-[hsl(var(--text-secondary))] group-hover:text-[hsl(var(--text-primary))]">
                            {vol.name}
                          </span>
                        </label>
                      );
                    })
                  ) : !isCreatingVolume ? (
                    <p className="text-xs text-[hsl(var(--text-muted))]">
                      No volumes yet. Click "New Volume" to create one.
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {/* Port Mapping */}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-1.5">
                Port Mapping
              </label>

              {ports.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {ports.map((port, i) => (
                    <li key={i} className="flex items-center justify-between bg-[hsl(var(--bg-elevated))] px-3 py-1.5 text-xs">
                      <span className="text-[hsl(var(--text-secondary))]">
                        localhost:{port.host} <span className="text-[hsl(var(--text-muted))]">→</span> {backend === 'docker' ? 'container' : 'guest'}:{port.container}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePort(i)}
                        className="text-[hsl(var(--red))] hover:text-[hsl(var(--red-dim))]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={newHostPort}
                  onChange={(e) => setNewHostPort(e.target.value)}
                  placeholder={String(getNextHostPort())}
                  min="1"
                  max="65535"
                  className="w-24 px-2 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                />
                <span className="text-[hsl(var(--text-muted))]">→</span>
                <input
                  type="number"
                  value={newContainerPort}
                  onChange={(e) => setNewContainerPort(e.target.value)}
                  placeholder={backend === 'docker' ? 'Container port' : 'Guest port'}
                  min="1"
                  max="65535"
                  className="w-28 px-2 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addPort}
                  disabled={!newHostPort || !newContainerPort}
                  className="p-1.5 bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-[hsl(var(--text-muted))]">
                {backend === 'docker' ? 'SSH port (22) is automatically mapped.' : 'SSH is available via the guest IP.'}
              </p>
            </div>

            {/* Error message */}
            {createMutation.error && (
              <div className="p-3 text-xs bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-[hsl(var(--red))]">
                {createMutation.error.message}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-[hsl(var(--border))]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !name}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[hsl(var(--cyan))] text-white hover:bg-[hsl(var(--cyan-dim))] disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Sandbox
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
