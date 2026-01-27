import { useState } from 'react';
import { HardDrive, Plus, Trash2, Link, Unlink, Loader2, AlertTriangle, MoreVertical, FolderOpen } from 'lucide-react';
import { useVmVolumes, useCreateVmVolume, useDeleteVmVolume, useAttachVmVolume, useDetachVmVolume, useVms } from '../hooks/useContainers';
import { VmVolumeInfo } from '../api/client';
import { useConfirm } from './ConfirmModal';
import { VolumeFileBrowser } from './VolumeFileBrowser';

export function VMVolumes() {
  const { data: volumes, isLoading, error, refetch } = useVmVolumes();
  const { data: vms } = useVms();
  const createVolume = useCreateVmVolume();
  const deleteVolume = useDeleteVmVolume();
  const attachVolume = useAttachVmVolume();
  const detachVolume = useDetachVmVolume();
  const confirm = useConfirm();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAttachModal, setShowAttachModal] = useState<VmVolumeInfo | null>(null);
  const [showFileBrowser, setShowFileBrowser] = useState<VmVolumeInfo | null>(null);
  const [newVolumeName, setNewVolumeName] = useState('');
  const [newVolumeSize, setNewVolumeSize] = useState(10);
  const [newVolumeFormat, setNewVolumeFormat] = useState<'ext4' | 'xfs'>('ext4');
  const [selectedVmId, setSelectedVmId] = useState('');

  const formatSize = (mb: number) => {
    if (mb < 1024) return `${mb} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  const handleCreate = async () => {
    if (!newVolumeName.trim()) return;

    try {
      await createVolume.mutateAsync({
        name: newVolumeName.trim(),
        sizeGb: newVolumeSize,
        format: newVolumeFormat,
      });
      setShowCreateModal(false);
      setNewVolumeName('');
      setNewVolumeSize(10);
    } catch (err) {
      console.error('Failed to create volume:', err);
    }
  };

  const handleDelete = async (volume: VmVolumeInfo) => {
    const confirmed = await confirm({
      title: 'Delete Volume',
      message: `Are you sure you want to delete "${volume.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      try {
        await deleteVolume.mutateAsync(volume.id);
      } catch (err) {
        console.error('Failed to delete volume:', err);
      }
    }
  };

  const handleAttach = async () => {
    if (!showAttachModal || !selectedVmId) return;

    try {
      await attachVolume.mutateAsync({
        volumeId: showAttachModal.id,
        vmId: selectedVmId,
      });
      setShowAttachModal(null);
      setSelectedVmId('');
    } catch (err) {
      console.error('Failed to attach volume:', err);
    }
  };

  const handleDetach = async (volume: VmVolumeInfo) => {
    const confirmed = await confirm({
      title: 'Detach Volume',
      message: `Are you sure you want to detach "${volume.name}" from its VM?`,
      confirmText: 'Detach',
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

  // Get VM name from ID
  const getVmName = (vmId: string | undefined) => {
    if (!vmId || !vms) return null;
    const vm = vms.find(v => v.id === vmId);
    return vm?.name || vmId;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="w-12 h-12 text-[hsl(var(--red))]" />
        <p className="text-[hsl(var(--text-secondary))]">Failed to load volumes</p>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-[hsl(var(--cyan))] text-white rounded hover:bg-[hsl(var(--cyan)/0.8)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[hsl(var(--text-primary))]">VM Volumes</h1>
          <p className="text-sm text-[hsl(var(--text-secondary))] mt-1">
            Persistent storage volumes for virtual machines
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--cyan))] text-white rounded hover:bg-[hsl(var(--cyan)/0.8)]"
        >
          <Plus className="w-4 h-4" />
          Create Volume
        </button>
      </div>

      {/* Volume List */}
      {volumes && volumes.length > 0 ? (
        <div className="grid gap-4">
          {volumes.map((volume) => (
            <div
              key={volume.id}
              className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-[hsl(var(--bg-elevated))] rounded">
                    <HardDrive className="w-5 h-5 text-[hsl(var(--cyan))]" />
                  </div>
                  <div>
                    <h3 className="font-medium text-[hsl(var(--text-primary))]">{volume.name}</h3>
                    <p className="text-sm text-[hsl(var(--text-secondary))]">
                      {volume.sizeGb} GB ({formatSize(volume.actualSizeMb)} used) &bull; {volume.format}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {volume.attachedTo ? (
                    <span className="flex items-center gap-1 px-2 py-1 text-xs bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] rounded">
                      <Link className="w-3 h-3" />
                      {getVmName(volume.attachedTo)}
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] rounded">
                      Not attached
                    </span>
                  )}

                  {/* Browse Files button */}
                  {volume.format === 'ext4' && (
                    <button
                      onClick={() => setShowFileBrowser(volume)}
                      className="p-2 hover:bg-[hsl(var(--bg-elevated))] rounded"
                      title="Browse Files"
                    >
                      <FolderOpen className="w-4 h-4 text-[hsl(var(--cyan))]" />
                    </button>
                  )}

                  {/* Actions menu */}
                  <div className="relative group">
                    <button className="p-2 hover:bg-[hsl(var(--bg-elevated))] rounded">
                      <MoreVertical className="w-4 h-4 text-[hsl(var(--text-secondary))]" />
                    </button>
                    <div className="absolute right-0 mt-1 w-40 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                      {volume.format === 'ext4' && (
                        <button
                          onClick={() => setShowFileBrowser(volume)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] rounded-t-lg"
                        >
                          <FolderOpen className="w-4 h-4" />
                          Browse Files
                        </button>
                      )}
                      {volume.attachedTo ? (
                        <button
                          onClick={() => handleDetach(volume)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                        >
                          <Unlink className="w-4 h-4" />
                          Detach
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowAttachModal(volume)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                        >
                          <Link className="w-4 h-4" />
                          Attach to VM
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(volume)}
                        disabled={!!volume.attachedTo}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] rounded-b-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Volume details */}
              <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] text-sm text-[hsl(var(--text-secondary))]">
                <div className="flex gap-6">
                  <span>ID: {volume.id}</span>
                  <span>Mount path: {volume.mountPath || '/mnt/data'}</span>
                  <span>Created: {new Date(volume.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg">
          <HardDrive className="w-12 h-12 text-[hsl(var(--text-muted))] mb-4" />
          <p className="text-[hsl(var(--text-secondary))] mb-4">No VM volumes yet</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--cyan))] text-white rounded hover:bg-[hsl(var(--cyan)/0.8)]"
          >
            <Plus className="w-4 h-4" />
            Create your first volume
          </button>
        </div>
      )}

      {/* Create Volume Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4">Create Volume</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[hsl(var(--text-secondary))] mb-1">Name</label>
                <input
                  type="text"
                  value={newVolumeName}
                  onChange={(e) => setNewVolumeName(e.target.value)}
                  placeholder="my-volume"
                  className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan))]"
                />
              </div>

              <div>
                <label className="block text-sm text-[hsl(var(--text-secondary))] mb-1">Size (GB)</label>
                <input
                  type="number"
                  value={newVolumeSize}
                  onChange={(e) => setNewVolumeSize(parseInt(e.target.value) || 10)}
                  min={1}
                  max={500}
                  className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan))]"
                />
              </div>

              <div>
                <label className="block text-sm text-[hsl(var(--text-secondary))] mb-1">Format</label>
                <select
                  value={newVolumeFormat}
                  onChange={(e) => setNewVolumeFormat(e.target.value as 'ext4' | 'xfs')}
                  className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan))]"
                >
                  <option value="ext4">ext4 (recommended)</option>
                  <option value="xfs">xfs</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newVolumeName.trim() || createVolume.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--cyan))] text-white rounded hover:bg-[hsl(var(--cyan)/0.8)] disabled:opacity-50"
              >
                {createVolume.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attach Volume Modal */}
      {showAttachModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg p-6 w-96">
            <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4">
              Attach Volume: {showAttachModal.name}
            </h2>

            <div>
              <label className="block text-sm text-[hsl(var(--text-secondary))] mb-1">Select VM</label>
              <select
                value={selectedVmId}
                onChange={(e) => setSelectedVmId(e.target.value)}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan))]"
              >
                <option value="">Select a VM...</option>
                {vms?.map((vm) => (
                  <option key={vm.id} value={vm.id}>
                    {vm.name} ({vm.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowAttachModal(null);
                  setSelectedVmId('');
                }}
                className="px-4 py-2 text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleAttach}
                disabled={!selectedVmId || attachVolume.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--cyan))] text-white rounded hover:bg-[hsl(var(--cyan)/0.8)] disabled:opacity-50"
              >
                {attachVolume.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Attach
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Browser Modal */}
      {showFileBrowser && (
        <VolumeFileBrowser
          volumeId={showFileBrowser.id}
          volumeName={showFileBrowser.name}
          isAttached={!!showFileBrowser.attachedTo}
          isVmRunning={
            showFileBrowser.attachedTo
              ? vms?.some(vm => vm.id === `fc-${showFileBrowser.attachedTo}` && vm.status === 'running')
              : false
          }
          onClose={() => setShowFileBrowser(null)}
        />
      )}
    </div>
  );
}
