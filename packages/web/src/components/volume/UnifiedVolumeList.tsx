/**
 * UnifiedVolumeList - Shows all volumes from all backends with filtering
 */

import { useState, useMemo } from 'react';
import {
  HardDrive,
  Plus,
  Trash2,
  FolderOpen,
  X,
  Loader2,
  Server,
  Cloud,
  Box,
  Filter,
  Link,
  Unlink,
} from 'lucide-react';
import type { UnifiedVolume, UnifiedVolumeBackend } from '../../api/client';
import {
  useUnifiedVolumes,
  useCreateUnifiedVolume,
  useDeleteUnifiedVolume,
  useAttachUnifiedVolume,
  useDetachUnifiedVolume,
} from '../../hooks/useVolumes';
import { useSandboxes } from '../../hooks/useSandboxes';
import { useConfirm } from '../ConfirmModal';
import { VolumeFileBrowser } from '../VolumeFileBrowser';

/**
 * Backend badge component
 */
function VolumeBadge({ backend }: { backend: UnifiedVolumeBackend }) {
  const config = {
    docker: { icon: Box, color: 'cyan', label: 'Docker' },
    vm: { icon: Server, color: 'purple', label: 'VM' },
    daytona: { icon: Cloud, color: 'green', label: 'Daytona' },
  };

  const { icon: Icon, color, label } = config[backend];

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-[hsl(var(--${color})/0.1)] text-[hsl(var(--${color}))]`}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/**
 * Status indicator for volume
 */
function VolumeStatus({ status }: { status: string }) {
  const statusConfig: Record<string, { color: string; label: string }> = {
    creating: { color: 'amber', label: 'Creating' },
    ready: { color: 'green', label: 'Ready' },
    attached: { color: 'cyan', label: 'In Use' },
    error: { color: 'red', label: 'Error' },
    deleting: { color: 'amber', label: 'Deleting' },
  };

  const config = statusConfig[status] || { color: 'gray', label: status };

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] text-[hsl(var(--${config.color}))]`}>
      <span className={`w-1.5 h-1.5 rounded-full bg-[hsl(var(--${config.color}))]`} />
      {config.label}
    </span>
  );
}

/**
 * Volume card component
 */
function VolumeCard({
  volume,
  onDelete,
  onAttach,
  onDetach,
  onBrowseFiles,
}: {
  volume: UnifiedVolume;
  onDelete: () => void;
  onAttach?: () => void;
  onDetach?: () => void;
  onBrowseFiles?: () => void;
}) {
  const canDelete = volume.status !== 'attached' && volume.attachedTo.length === 0;
  const supportsFiles = volume.backend === 'vm';
  const supportsAttach = volume.backend === 'vm';
  const isAttached = volume.attachedTo.length > 0;

  return (
    <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="h-4 w-4 text-[hsl(var(--text-muted))] flex-shrink-0" />
          <span className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">
            {volume.name}
          </span>
          <VolumeBadge backend={volume.backend} />
          <VolumeStatus status={volume.status} />
        </div>
        <div className="flex items-center gap-1">
          {supportsFiles && onBrowseFiles && (
            <button
              onClick={onBrowseFiles}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] transition-colors"
              title="Browse Files"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          )}
          {supportsAttach && !isAttached && onAttach && (
            <button
              onClick={onAttach}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] transition-colors"
              title="Attach to Sandbox"
            >
              <Link className="h-4 w-4" />
            </button>
          )}
          {supportsAttach && isAttached && onDetach && (
            <button
              onClick={onDetach}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] transition-colors"
              title="Detach from Sandbox"
            >
              <Unlink className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] transition-colors"
              title="Delete Volume"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="flex items-center gap-4 text-[10px] text-[hsl(var(--text-muted))] mb-2">
        {volume.sizeGb && <span>{volume.sizeGb}GB allocated</span>}
        {volume.actualSizeMb && <span>{volume.actualSizeMb}MB used</span>}
        {volume.mountPath && <span className="font-mono">{volume.mountPath}</span>}
      </div>

      {/* Attachments */}
      {volume.attachedTo.length > 0 && (
        <div className="text-[10px] text-[hsl(var(--cyan))]">
          Attached to:{' '}
          {volume.attachedTo.map((a, idx) => {
            // For VM volumes, the sandboxId is raw (without fc- prefix)
            // We need to reconstruct the full sandbox ID for navigation
            const fullSandboxId = volume.backend === 'vm' ? `fc-${a.sandboxId}` : a.sandboxId;
            const displayName = a.sandboxName || a.sandboxId;
            return (
              <span key={a.sandboxId}>
                {idx > 0 && ', '}
                <button
                  onClick={() => {
                    // Store the sandbox ID to highlight
                    localStorage.setItem('handler-highlight-sandbox', fullSandboxId);
                    // Navigate to sandboxes tab using custom event
                    window.dispatchEvent(new CustomEvent('handler-navigate-tab', {
                      detail: { tab: 'sandboxes' },
                    }));
                  }}
                  className="hover:underline hover:text-[hsl(var(--cyan-bright,var(--cyan)))] cursor-pointer"
                  title={`ID: ${fullSandboxId}\nClick to view sandbox`}
                >
                  {displayName}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Error */}
      {volume.error && (
        <div className="mt-2 p-2 text-[10px] text-[hsl(var(--red))] bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)]">
          {volume.error}
        </div>
      )}

      {/* Timestamp */}
      <div className="mt-2 text-[10px] text-[hsl(var(--text-muted))]">
        Created {new Date(volume.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

/**
 * Create volume modal
 */
function CreateVolumeModal({
  onClose,
  onSubmit,
  isLoading,
  availableBackends,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; backend?: UnifiedVolumeBackend; sizeGb?: number }) => void;
  isLoading: boolean;
  availableBackends: UnifiedVolumeBackend[];
}) {
  const [name, setName] = useState('');
  const [backend, setBackend] = useState<UnifiedVolumeBackend | ''>('');
  const [sizeGb, setSizeGb] = useState<number | ''>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      backend: backend || undefined,
      sizeGb: sizeGb || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
            Create Volume
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wide mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-volume"
              required
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
              className="w-full px-3 py-2 text-sm bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
            />
          </div>

          <div>
            <label className="block text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wide mb-1">
              Backend (auto-detect if empty)
            </label>
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value as UnifiedVolumeBackend | '')}
              className="w-full px-3 py-2 text-sm bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan))]"
            >
              <option value="">Auto-detect</option>
              {availableBackends.includes('docker') && (
                <option value="docker">Docker</option>
              )}
              {availableBackends.includes('vm') && (
                <option value="vm">VM (ext4)</option>
              )}
              {availableBackends.includes('daytona') && (
                <option value="daytona">Daytona</option>
              )}
            </select>
          </div>

          {(backend === 'vm' || backend === '') && availableBackends.includes('vm') && (
            <div>
              <label className="block text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wide mb-1">
                Size (GB) - Required for VM volumes
              </label>
              <input
                type="number"
                value={sizeGb}
                onChange={(e) => setSizeGb(e.target.value ? parseInt(e.target.value, 10) : '')}
                placeholder="10"
                min="1"
                max="1000"
                className="w-full px-3 py-2 text-sm bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name}
              className="px-4 py-2 text-sm bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.8)] disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Attach volume modal
 */
function AttachVolumeModal({
  volume,
  onClose,
  onSubmit,
  isLoading,
}: {
  volume: UnifiedVolume;
  onClose: () => void;
  onSubmit: (sandboxId: string) => void;
  isLoading: boolean;
}) {
  const { data: sandboxesData } = useSandboxes();
  const [selectedSandboxId, setSelectedSandboxId] = useState('');

  // Filter to only show Firecracker sandboxes (volume attachment only works for Firecracker)
  const vmSandboxes = useMemo(() => {
    if (!sandboxesData?.sandboxes) return [];
    return sandboxesData.sandboxes.filter((s) => s.backend === 'firecracker');
  }, [sandboxesData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSandboxId) {
      onSubmit(selectedSandboxId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
            Attach Volume: {volume.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wide mb-1">
              Select Sandbox
            </label>
            <select
              value={selectedSandboxId}
              onChange={(e) => setSelectedSandboxId(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan))]"
            >
              <option value="">Select a sandbox...</option>
              {vmSandboxes.map((sandbox) => (
                <option key={sandbox.id} value={sandbox.id}>
                  {sandbox.name} ({sandbox.backend} - {sandbox.status})
                </option>
              ))}
            </select>
            {vmSandboxes.length === 0 && (
              <p className="mt-2 text-[10px] text-[hsl(var(--text-muted))]">
                No Firecracker sandboxes available. Create a Firecracker sandbox first.
              </p>
            )}
            <p className="mt-2 text-[10px] text-[hsl(var(--text-muted))]">
              Note: Attaching to a running VM will restart it. The volume will appear as /dev/vdc (or higher) inside the VM.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !selectedSandboxId}
              className="px-4 py-2 text-sm bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.8)] disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Attaching...' : 'Attach'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Backend filter button
function BackendFilterButton({
  label,
  icon: Icon,
  color,
  isActive,
  onClick,
}: {
  label: string;
  icon: typeof Box;
  color: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium transition-colors ${
        isActive
          ? `bg-[hsl(var(--${color})/0.15)] text-[hsl(var(--${color}))] border border-[hsl(var(--${color})/0.3)]`
          : 'bg-[hsl(var(--bg-base))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))] hover:text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--border-highlight))]'
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

/**
 * Main UnifiedVolumeList component
 */
export function UnifiedVolumeList() {
  const { data, isLoading, error } = useUnifiedVolumes();
  const { data: sandboxesData } = useSandboxes();
  const createVolume = useCreateUnifiedVolume();
  const deleteVolume = useDeleteUnifiedVolume();
  const attachVolume = useAttachUnifiedVolume();
  const detachVolume = useDetachUnifiedVolume();
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [attachingVolume, setAttachingVolume] = useState<UnifiedVolume | null>(null);
  const [browsingVolume, setBrowsingVolume] = useState<UnifiedVolume | null>(null);
  const [selectedBackends, setSelectedBackends] = useState<Set<UnifiedVolumeBackend>>(new Set());

  // Check if the VM a volume is attached to is running
  const isAttachedVmRunning = (volume: UnifiedVolume): boolean => {
    if (volume.attachedTo.length === 0) return false;
    const attachedId = volume.attachedTo[0].sandboxId;
    const fullId = volume.backend === 'vm' ? `fc-${attachedId}` : attachedId;
    return sandboxesData?.sandboxes.some(s => s.id === fullId && s.status === 'running') ?? false;
  };

  // Get available backends from data
  const availableBackends = useMemo(() => {
    if (!data?.backends) return [] as UnifiedVolumeBackend[];
    return (Object.entries(data.backends) as [UnifiedVolumeBackend, boolean][])
      .filter(([_, available]) => available)
      .map(([backend]) => backend);
  }, [data?.backends]);

  // Backend info for filters
  const backendInfo: Record<UnifiedVolumeBackend, { label: string; icon: typeof Box; color: string }> = {
    docker: { label: 'Docker', icon: Box, color: 'cyan' },
    vm: { label: 'VM', icon: Server, color: 'purple' },
    daytona: { label: 'Daytona', icon: Cloud, color: 'green' },
  };

  // Toggle backend filter
  const toggleBackend = (backend: UnifiedVolumeBackend) => {
    setSelectedBackends((prev) => {
      const next = new Set(prev);
      if (next.has(backend)) {
        next.delete(backend);
      } else {
        next.add(backend);
      }
      return next;
    });
  };

  // Filter volumes based on selected backends
  const filteredVolumes = useMemo(() => {
    if (!data?.volumes) return [];
    if (selectedBackends.size === 0) return data.volumes;
    return data.volumes.filter((v) => selectedBackends.has(v.backend));
  }, [data?.volumes, selectedBackends]);

  const handleDelete = async (volume: UnifiedVolume) => {
    const confirmed = await confirm({
      title: 'Delete Volume',
      message: `Are you sure you want to delete "${volume.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      await deleteVolume.mutateAsync(volume.id);
    }
  };

  const handleCreate = async (createData: { name: string; backend?: UnifiedVolumeBackend; sizeGb?: number }) => {
    try {
      await createVolume.mutateAsync(createData);
      setShowCreate(false);
    } catch (err) {
      console.error('Failed to create volume:', err);
    }
  };

  const handleAttach = async (sandboxId: string) => {
    if (!attachingVolume) return;
    try {
      await attachVolume.mutateAsync({ volumeId: attachingVolume.id, sandboxId });
      setAttachingVolume(null);
    } catch (err) {
      console.error('Failed to attach volume:', err);
    }
  };

  const handleDetach = async (volume: UnifiedVolume) => {
    const confirmed = await confirm({
      title: 'Detach Volume',
      message: `Are you sure you want to detach "${volume.name}" from its sandbox?`,
      confirmText: 'Detach',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await detachVolume.mutateAsync(volume.id);
      } catch (err) {
        console.error('Failed to detach volume:', err);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[hsl(var(--text-muted))]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-[hsl(var(--red))] bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)]">
        Failed to load volumes: {error.message}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-[hsl(var(--text-primary))]">
          Volumes
          <span className="ml-2 text-sm text-[hsl(var(--text-muted))]">
            ({filteredVolumes.length}{selectedBackends.size > 0 ? ` of ${data?.volumes.length || 0}` : ''})
          </span>
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.8)] transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Volume
        </button>
      </div>

      {/* Filters */}
      {availableBackends.length > 1 && (
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wide">
            <Filter className="h-3 w-3" />
            Filter
          </div>
          <div className="flex items-center gap-2">
            {availableBackends.map((backend) => {
              const info = backendInfo[backend];
              return (
                <BackendFilterButton
                  key={backend}
                  label={info.label}
                  icon={info.icon}
                  color={info.color}
                  isActive={selectedBackends.has(backend)}
                  onClick={() => toggleBackend(backend)}
                />
              );
            })}
          </div>
          {selectedBackends.size > 0 && (
            <button
              onClick={() => setSelectedBackends(new Set())}
              className="text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Volume List */}
      <div className="flex-1 overflow-auto">
        {filteredVolumes.length === 0 ? (
          <div className="text-center py-12 text-[hsl(var(--text-muted))]">
            <HardDrive className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No volumes found</p>
            {selectedBackends.size > 0 ? (
              <p className="text-sm mt-1">Try clearing the filters</p>
            ) : (
              <p className="text-sm mt-1">Create a volume to get started</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredVolumes.map((volume) => (
              <VolumeCard
                key={volume.id}
                volume={volume}
                onDelete={() => handleDelete(volume)}
                onAttach={volume.backend === 'vm' ? () => setAttachingVolume(volume) : undefined}
                onDetach={volume.backend === 'vm' && volume.attachedTo.length > 0 ? () => handleDetach(volume) : undefined}
                onBrowseFiles={volume.backend === 'vm' ? () => setBrowsingVolume(volume) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateVolumeModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
          isLoading={createVolume.isPending}
          availableBackends={availableBackends}
        />
      )}

      {/* Attach Modal */}
      {attachingVolume && (
        <AttachVolumeModal
          volume={attachingVolume}
          onClose={() => setAttachingVolume(null)}
          onSubmit={handleAttach}
          isLoading={attachVolume.isPending}
        />
      )}

      {/* File Browser Modal */}
      {browsingVolume && (
        <VolumeFileBrowser
          volumeId={browsingVolume.id}
          volumeName={browsingVolume.name}
          isAttached={browsingVolume.attachedTo.length > 0}
          isVmRunning={isAttachedVmRunning(browsingVolume)}
          onClose={() => setBrowsingVolume(null)}
        />
      )}
    </div>
  );
}
