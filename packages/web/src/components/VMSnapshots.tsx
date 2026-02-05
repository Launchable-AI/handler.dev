import { useState } from 'react';
import { Camera, Trash2, Loader2, AlertTriangle, Server, Copy, Package, X } from 'lucide-react';
import { useAllVmSnapshots, useDeleteVmSnapshot, useCreateVm, usePromoteSnapshotToImage } from '../hooks/useContainers';
import { VmSnapshotWithVmInfo } from '../api/client';
import { useConfirm } from './ConfirmModal';

function formatSize(bytes?: number): string {
  if (!bytes) return 'Unknown';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

interface SnapshotCardProps {
  snapshot: VmSnapshotWithVmInfo;
  onClone: (snapshot: VmSnapshotWithVmInfo) => void;
  onPromote: (snapshot: VmSnapshotWithVmInfo) => void;
  isCloning?: boolean;
  isPromoting?: boolean;
}

function SnapshotCard({ snapshot, onClone, onPromote, isCloning, isPromoting }: SnapshotCardProps) {
  const deleteSnapshot = useDeleteVmSnapshot();
  const confirm = useConfirm();
  const isBusy = isCloning || isPromoting || deleteSnapshot.isPending;

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Snapshot',
      message: `Are you sure you want to delete "${snapshot.name || snapshot.id}"?`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      deleteSnapshot.mutate({ vmId: snapshot.vmId, snapshotId: snapshot.id });
    }
  };

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-4 hover:border-[hsl(var(--cyan)/0.3)] transition-colors min-w-0">
      {/* Header */}
      <div className="flex items-start gap-2 mb-3 min-w-0">
        <Camera className="h-4 w-4 text-[hsl(var(--purple))] flex-shrink-0 mt-0.5" />
        <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] break-all leading-tight">
          {snapshot.name || snapshot.id}
        </h3>
      </div>

      {/* VM Info */}
      <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))] mb-2 min-w-0">
        <Server className="h-3 w-3 flex-shrink-0" />
        <span className="text-[hsl(var(--cyan))] truncate">{snapshot.vmName}</span>
      </div>

      {/* Details */}
      <div className="text-[10px] text-[hsl(var(--text-muted))] space-y-1 mb-3">
        <div>Created: {formatDate(snapshot.createdAt)}</div>
        <div>Size: {formatSize(snapshot.sizeBytes)}</div>
        <div className="truncate" title={snapshot.baseImage}>
          Base: {snapshot.baseImage}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[hsl(var(--border))]">
        <button
          onClick={() => onClone(snapshot)}
          disabled={isBusy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
          title="Create a new independent VM from this snapshot"
        >
          {isCloning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {isCloning ? 'Creating...' : 'New VM'}
        </button>
        <button
          onClick={() => onPromote(snapshot)}
          disabled={isBusy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] disabled:opacity-50"
          title="Save as a base image (appears in Base Images list for creating future VMs)"
        >
          {isPromoting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Package className="h-3 w-3" />
          )}
          {isPromoting ? 'Saving...' : 'Save as Image'}
        </button>
        <button
          onClick={handleDelete}
          disabled={isBusy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
          title="Delete snapshot"
        >
          {deleteSnapshot.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          Delete
        </button>
      </div>
    </div>
  );
}

// Promote to Image Dialog
interface PromoteDialogProps {
  snapshot: VmSnapshotWithVmInfo;
  onClose: () => void;
  onPromote: (imageName: string) => void;
  isPromoting: boolean;
}

function PromoteDialog({ snapshot, onClose, onPromote, isPromoting }: PromoteDialogProps) {
  const [imageName, setImageName] = useState(
    `${snapshot.name || snapshot.vmName}-image`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (imageName.trim()) {
      onPromote(imageName.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-[hsl(var(--text-primary))]">
            Promote to Base Image
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-[hsl(var(--text-secondary))] mb-4">
          This will create a new base image from the snapshot "{snapshot.name || snapshot.id}".
          The image can be used to create new VMs with all the packages and configuration
          from this snapshot pre-installed.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">
              Image Name
            </label>
            <input
              type="text"
              value={imageName}
              onChange={(e) => setImageName(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="my-custom-image"
              pattern="[a-zA-Z0-9-]+"
              required
            />
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
              Only letters, numbers, and hyphens allowed
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPromoting}
              className="px-4 py-2 text-sm text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPromoting || !imageName.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.8)] disabled:opacity-50"
            >
              {isPromoting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPromoting ? 'Creating...' : 'Create Image'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function VMSnapshots() {
  const { data: snapshots, isLoading, error } = useAllVmSnapshots();
  const createVm = useCreateVm();
  const promoteSnapshot = usePromoteSnapshotToImage();
  const [filterVm, setFilterVm] = useState<string>('all');
  const [cloningSnapshot, setCloningSnapshot] = useState<string | null>(null);
  const [promoteDialogSnapshot, setPromoteDialogSnapshot] = useState<VmSnapshotWithVmInfo | null>(null);

  // Get unique VM names for filter
  const vmNames = [...new Set(snapshots?.map(s => s.vmName) || [])];

  // Filter snapshots
  const filteredSnapshots = filterVm === 'all'
    ? snapshots
    : snapshots?.filter(s => s.vmName === filterVm);

  // Generate a unique VM name based on snapshot
  const generateVmName = (snapshotName: string) => {
    const baseName = snapshotName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 20);
    return `${baseName}-${Date.now().toString(36)}`;
  };

  // Clone a new VM from snapshot (fresh boot with snapshot's disk)
  const handleCloneFromSnapshot = async (snapshot: VmSnapshotWithVmInfo) => {
    setCloningSnapshot(snapshot.id);
    try {
      await createVm.mutateAsync({
        name: generateVmName(snapshot.name || snapshot.vmName),
        fromSnapshot: {
          vmId: snapshot.vmId,
          snapshotId: snapshot.id,
        },
        autoStart: true,
      });
    } catch (error) {
      console.error('Failed to clone from snapshot:', error);
    } finally {
      setCloningSnapshot(null);
    }
  };

  // Promote snapshot to base image
  const handlePromote = async (imageName: string) => {
    if (!promoteDialogSnapshot) return;

    try {
      await promoteSnapshot.mutateAsync({
        vmId: promoteDialogSnapshot.vmId,
        snapshotId: promoteDialogSnapshot.id,
        imageName,
      });
      setPromoteDialogSnapshot(null);

      // Navigate to Images tab and highlight the new base image
      window.dispatchEvent(new CustomEvent('caisson-navigate-tab', { detail: { tab: 'images' } }));
      // Small delay to let the tab switch, then trigger highlight
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('caisson-highlight-image', { detail: { imageName } }));
      }, 100);
    } catch (error) {
      console.error('Failed to promote snapshot:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--text-muted))]">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading snapshots...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--red))]">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Failed to load snapshots: {String(error)}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[hsl(var(--text-muted))]">
            {filteredSnapshots?.length || 0} snapshot{(filteredSnapshots?.length || 0) !== 1 ? 's' : ''}
          </span>
          {vmNames.length > 1 && (
            <select
              value={filterVm}
              onChange={e => setFilterVm(e.target.value)}
              className="px-2 py-1 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
            >
              <option value="all">All VMs</option>
              {vmNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Info text */}
      <div className="text-xs text-[hsl(var(--text-muted))] mb-4 p-2 bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] space-y-1 overflow-hidden">
        <p className="break-words"><strong>New VM:</strong> Create a new, independent VM from this snapshot.</p>
        <p className="break-words"><strong>Save as Image:</strong> Add to Base Images list for creating future VMs.</p>
        <p className="break-words"><strong>Rollback:</strong> Restore a VM to a snapshot from the Instances view.</p>
      </div>

      {/* Snapshots Grid */}
      {filteredSnapshots && filteredSnapshots.length > 0 ? (
        <div className="flex-1 overflow-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
          {filteredSnapshots.map(snapshot => (
            <SnapshotCard
              key={`${snapshot.vmId}-${snapshot.id}`}
              snapshot={snapshot}
              onClone={handleCloneFromSnapshot}
              onPromote={setPromoteDialogSnapshot}
              isCloning={cloningSnapshot === snapshot.id}
              isPromoting={promoteSnapshot.isPending && promoteDialogSnapshot?.id === snapshot.id}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-[hsl(var(--text-muted))]">
          <Camera className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm mb-1">No snapshots</p>
          <p className="text-xs">Take a snapshot from a running VM to save its state</p>
        </div>
      )}

      {/* Promote Dialog */}
      {promoteDialogSnapshot && (
        <PromoteDialog
          snapshot={promoteDialogSnapshot}
          onClose={() => setPromoteDialogSnapshot(null)}
          onPromote={handlePromote}
          isPromoting={promoteSnapshot.isPending}
        />
      )}
    </div>
  );
}
