/**
 * SandboxCard - Polished card view for a single sandbox
 * Matches the ContainerCard design with Docker/SSH tabs
 */

import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Trash2,
  Terminal as TerminalIcon,
  Copy,
  Check,
  Download,
  HardDrive,
  Globe,
  ExternalLink,
  Circle,
  TerminalSquare,
  Loader2,
  Upload,
  AlertCircle,
  X,
  ScrollText,
  Camera,
  FolderUp,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Cpu,
  MemoryStick,
  Network,
  Clock,
  Settings,
  Activity,
  Bot,
} from 'lucide-react';
import type { Sandbox, DockerMeta, VmMeta, VmSnapshotInfo } from '../../api/client';
import { downloadSandboxSshKey, createVmSnapshot, uploadFileToSandbox, uploadDirectoryToSandbox, getSandboxSshCommand } from '../../api/client';
import { SandboxFileBrowser } from './SandboxFileBrowser';
import { VolumeFileBrowser } from '../VolumeFileBrowser';
import { BackendBadge } from './BackendBadge';
import { AgentBadges } from './AgentBadges';
import { isTransitioning } from './StatusIndicator';
import { useStartSandbox, useStopSandbox, useDeleteSandbox, useRenameSandbox, useUpdateSandboxResources, useSandboxMetrics } from '../../hooks/useSandboxes';
import { useVmSnapshots, useDeleteVmSnapshot, useRollbackVmToSnapshot, useCreateVm } from '../../hooks/useContainers';
import { useConfirm } from '../ConfirmModal';
import { useTerminalPanel } from '../TerminalPanel';
import { SandboxLogViewer } from './SandboxLogViewer';

interface ReconfigureDialogProps {
  sandbox: Sandbox;
  onClose: () => void;
  onSave: (resources: { vcpus?: number; memoryMb?: number; diskGb?: number }) => void;
  isPending: boolean;
  error: string | null;
}

function ReconfigureDialog({ sandbox, onClose, onSave, isPending, error }: ReconfigureDialogProps) {
  const [vcpus, setVcpus] = useState(sandbox.vcpus);
  const [memoryMb, setMemoryMb] = useState(sandbox.memoryMb);
  const [diskGb, setDiskGb] = useState(sandbox.diskGb);

  const isVm = sandbox.backend === 'firecracker' || sandbox.backend === 'cloud-hypervisor';
  const isDocker = sandbox.backend === 'docker';
  const isStopped = sandbox.status === 'stopped' || sandbox.status === 'error' || sandbox.status === 'archived';

  const hasChanges = vcpus !== sandbox.vcpus || memoryMb !== sandbox.memoryMb || diskGb !== sandbox.diskGb;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const resources: { vcpus?: number; memoryMb?: number; diskGb?: number } = {};
    if (vcpus !== sandbox.vcpus) resources.vcpus = vcpus;
    if (memoryMb !== sandbox.memoryMb) resources.memoryMb = memoryMb;
    if (diskGb !== sandbox.diskGb) resources.diskGb = diskGb;
    onSave(resources);
  };

  // Memory presets in MB
  const memoryPresets = [512, 1024, 2048, 4096, 8192, 16384];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[hsl(var(--text-muted))]" />
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Configure Resources
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
          {isVm && !isStopped && (
            <div className="p-2 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] text-[11px] text-[hsl(var(--amber))]">
              VM must be stopped to change resources. Changes will apply on next boot.
            </div>
          )}

          {/* vCPUs */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--text-secondary))] mb-1.5">
              <Cpu className="h-3.5 w-3.5" />
              vCPUs
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={isDocker ? 16 : 32}
                value={vcpus}
                onChange={(e) => setVcpus(parseInt(e.target.value))}
                className="flex-1 accent-[hsl(var(--cyan))]"
                disabled={isVm && !isStopped}
              />
              <span className="text-xs text-[hsl(var(--text-primary))] w-8 text-right tabular-nums">{vcpus}</span>
            </div>
          </div>

          {/* Memory */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--text-secondary))] mb-1.5">
              <MemoryStick className="h-3.5 w-3.5" />
              Memory
            </label>
            <div className="flex flex-wrap gap-1.5">
              {memoryPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMemoryMb(preset)}
                  disabled={isVm && !isStopped}
                  className={`px-2 py-1 text-[10px] border transition-colors disabled:opacity-50 ${
                    memoryMb === preset
                      ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] text-[hsl(var(--cyan))]'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--text-muted))]'
                  }`}
                >
                  {preset >= 1024 ? `${preset / 1024} GB` : `${preset} MB`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="number"
                min={isDocker ? 128 : 128}
                max={65536}
                step={128}
                value={memoryMb}
                onChange={(e) => setMemoryMb(parseInt(e.target.value) || 512)}
                disabled={isVm && !isStopped}
                className="w-24 px-2 py-1 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] outline-none disabled:opacity-50"
              />
              <span className="text-[10px] text-[hsl(var(--text-muted))]">MB</span>
            </div>
          </div>

          {/* Disk (VMs only) */}
          {isVm && (
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--text-secondary))] mb-1.5">
                <HardDrive className="h-3.5 w-3.5" />
                Disk
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={sandbox.diskGb}
                  max={1000}
                  value={diskGb}
                  onChange={(e) => setDiskGb(parseInt(e.target.value) || sandbox.diskGb)}
                  disabled={!isStopped}
                  className="w-24 px-2 py-1 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] outline-none disabled:opacity-50"
                />
                <span className="text-[10px] text-[hsl(var(--text-muted))]">GB (cannot be reduced)</span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-2 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-[11px] text-[hsl(var(--red))]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!hasChanges || isPending || (isVm && !isStopped)}
              className="px-3 py-1.5 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SandboxCardProps {
  sandbox: Sandbox;
  highlight?: boolean;
}

type ConnectionMode = 'docker' | 'ssh';

/** Get the default workspace path based on sandbox backend */
function getDefaultWorkspacePath(backend: Sandbox['backend']): string {
  switch (backend) {
    case 'docker':
      return '/home/dev/workspace';
    case 'daytona':
      return '/home/daytona';
    case 'aws':
      return '/home/ubuntu';
    case 'firecracker':
    case 'cloud-hypervisor':
    default:
      return '/home/agent';
  }
}

export function SandboxCard({ sandbox, highlight }: SandboxCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Scroll into view and flash when highlighted
  useEffect(() => {
    if (highlight && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);
  const startSandbox = useStartSandbox();
  const stopSandbox = useStopSandbox();
  const deleteSandbox = useDeleteSandbox();
  const renameSandbox = useRenameSandbox();
  const updateResources = useUpdateSandboxResources();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();

  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showReconfigure, setShowReconfigure] = useState(false);
  const [reconfigureError, setReconfigureError] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [launchingSnapshot, setLaunchingSnapshot] = useState<string | null>(null);
  const [rollingBackSnapshot, setRollingBackSnapshot] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(sandbox.name);
  // Default to docker exec for Docker containers, SSH for VMs
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(
    sandbox.backend === 'docker' ? 'docker' : 'ssh'
  );
  const [error, setError] = useState<string | null>(null);
  const [browsingVolume, setBrowsingVolume] = useState<{ id: string; name: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadDetails, setUploadDetails] = useState<{
    fileName: string;
    fileCount: number;
    loaded: number;
    total: number;
  } | null>(null);
  const uploadAbortRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // File browser state
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showMetricsPopover, setShowMetricsPopover] = useState(false);
  const fileBrowserRef = useRef<HTMLDivElement>(null);

  // Daytona SSH command state (fetched on demand)
  const [daytonaSshCommand, setDaytonaSshCommand] = useState<string | null>(null);
  const [isFetchingSshCommand, setIsFetchingSshCommand] = useState(false);

  const isRunning = sandbox.status === 'running';
  const isDaytona = sandbox.backend === 'daytona';
  const isStopped = sandbox.status === 'stopped' || sandbox.status === 'archived';
  const isBuilding = sandbox.status === 'building' || sandbox.status === 'creating';
  const isFailed = sandbox.status === 'error';
  const isStuckTransition = isTransitioning(sandbox.status) && sandbox.status !== 'stopping';
  const isPending = startSandbox.isPending || stopSandbox.isPending || deleteSandbox.isPending;

  // Determine if this is a Docker sandbox
  const isDocker = sandbox.backend === 'docker';
  const dockerMeta = sandbox.backendMeta as DockerMeta | undefined;
  const vmMeta = sandbox.backendMeta as VmMeta | undefined;

  // Check if this is a VM-based sandbox that supports snapshots
  const isVm = sandbox.backend === 'firecracker' || sandbox.backend === 'cloud-hypervisor';
  const canSnapshot = isVm && isRunning && vmMeta?.type === 'vm';
  const canReconfigure = isVm || isDocker;

  // Guest metrics (CPU/memory/disk usage from inside the sandbox)
  const { data: metrics } = useSandboxMetrics(sandbox.id, isRunning);

  // Snapshot hooks (only fetch for VMs)
  const { data: snapshots, isLoading: snapshotsLoading } = useVmSnapshots(isVm ? sandbox.id : '');
  const deleteSnapshot = useDeleteVmSnapshot();
  const rollbackSnapshot = useRollbackVmToSnapshot();
  const createVm = useCreateVm();

  // Renaming is supported for Firecracker VMs and Docker containers
  const canRename = sandbox.backend === 'firecracker' || sandbox.backend === 'docker';

  // Get volumes based on backend type
  const volumes = isDocker
    ? dockerMeta?.volumes || []
    : vmMeta?.volumes?.map(v => ({ name: v.name, mountPath: v.mountPath })) || [];

  // Commands
  const dockerCommand = sandbox.dockerExecCommand;
  // For Daytona, use fetched SSH command; for others, use sandbox.sshCommand
  const sshCommand = isDaytona ? daytonaSshCommand : sandbox.sshCommand;
  // Determine displayed command based on what's available
  const currentCommand = isDocker
    ? (dockerCommand && sshCommand
        ? (connectionMode === 'docker' ? dockerCommand : sshCommand)
        : dockerCommand || sshCommand)
    : sshCommand;

  // Fetch SSH command for Daytona sandboxes
  const handleFetchSshCommand = async () => {
    if (!isDaytona || !isRunning) return;
    setIsFetchingSshCommand(true);
    setError(null);
    try {
      const cmd = await getSandboxSshCommand(sandbox.id);
      setDaytonaSshCommand(cmd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get SSH command');
    }
    setIsFetchingSshCommand(false);
  };

  // Status styling
  const stateConfig: Record<string, { color: string; label: string }> = {
    running: { color: 'green', label: 'Running' },
    starting: { color: 'cyan', label: 'Starting' },
    stopping: { color: 'amber', label: 'Stopping' },
    stopped: { color: 'text-muted', label: 'Stopped' },
    paused: { color: 'amber', label: 'Paused' },
    building: { color: 'cyan', label: 'Building' },
    creating: { color: 'cyan', label: 'Creating' },
    error: { color: 'red', label: 'Error' },
    archived: { color: 'text-muted', label: 'Archived' },
  };

  const currentState = stateConfig[sandbox.status] || stateConfig.stopped;
  const stateColorVar = currentState.color === 'text-muted' ? 'text-muted' : currentState.color;

  const handleCopyCommand = async () => {
    if (!currentCommand) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentCommand);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = currentCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownloadKey = async () => {
    try {
      const blob = await downloadSandboxSshKey(sandbox.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sandbox.name.replace(/[^a-z0-9]/gi, '_')}_key.pem`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download SSH key:', err);
    }
  };

  const handleStart = async () => {
    setError(null);
    try {
      await startSandbox.mutateAsync(sandbox.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
  };

  const handleStop = async () => {
    setError(null);
    try {
      await stopSandbox.mutateAsync(sandbox.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Sandbox',
      message: `Are you sure you want to delete "${sandbox.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await deleteSandbox.mutateAsync(sandbox.id);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to delete');
      }
    }
  };

  const handleOpenTerminal = () => {
    if (sandbox.terminalType === 'docker-exec') {
      const containerId = dockerMeta?.containerId || sandbox.id.replace('docker-', '');
      terminalPanel.openContainerTerminal(containerId, sandbox.name);
    } else if (sandbox.backend === 'daytona') {
      // Daytona uses its own SSH access API
      terminalPanel.openDaytonaTerminal(sandbox.id, sandbox.name);
    } else if (sandbox.backend === 'aws') {
      // AWS uses SSH with stored private key
      const awsMeta = sandbox.backendMeta as { type: 'aws'; instanceId: string; publicIp?: string } | undefined;
      const instanceId = awsMeta?.instanceId || sandbox.id.replace('aws-', '');
      const publicIp = awsMeta?.publicIp || sandbox.guestIp;
      if (publicIp) {
        terminalPanel.openAwsTerminal(instanceId, sandbox.name, publicIp);
      }
    } else if (sandbox.guestIp) {
      // Local VMs use SSH with local key
      terminalPanel.openTerminal(sandbox.id, sandbox.name, sandbox.guestIp);
    }
  };

  const handleCreateSnapshot = async () => {
    // Use sandbox.id directly - backend route needs prefix to determine service
    setIsCreatingSnapshot(true);
    try {
      await createVmSnapshot(sandbox.id, `${sandbox.name}-${Date.now()}`);
    } catch (err) {
      console.error('Failed to create snapshot:', err);
      setError(err instanceof Error ? err.message : 'Failed to create snapshot');
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleDeleteSnapshot = async (snapshot: VmSnapshotInfo) => {
    const confirmed = await confirm({
      title: 'Delete Snapshot',
      message: `Are you sure you want to delete "${snapshot.name || snapshot.id}"?`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      deleteSnapshot.mutate({ vmId: sandbox.id, snapshotId: snapshot.id });
    }
  };

  const handleLaunchFromSnapshot = async (snapshot: VmSnapshotInfo) => {
    setLaunchingSnapshot(snapshot.id);
    try {
      const baseName = (snapshot.name || sandbox.name).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 20);
      const vmName = `${baseName}-${Date.now().toString(36)}`;

      await createVm.mutateAsync({
        name: vmName,
        fromSnapshot: {
          vmId: sandbox.id,
          snapshotId: snapshot.id,
        },
        autoStart: true,
      });
    } catch (err) {
      console.error('Failed to launch from snapshot:', err);
      setError(err instanceof Error ? err.message : 'Failed to launch from snapshot');
    } finally {
      setLaunchingSnapshot(null);
    }
  };

  const handleRollbackToSnapshot = async (snapshot: VmSnapshotInfo) => {
    const confirmed = await confirm({
      title: 'Rollback Sandbox',
      message: `This will restore "${sandbox.name}" to the state saved in "${snapshot.name || snapshot.id}". The sandbox will be stopped and its current disk state will be replaced. Continue?`,
      confirmText: 'Rollback',
      variant: 'danger',
    });

    if (confirmed) {
      setRollingBackSnapshot(snapshot.id);
      try {
        await rollbackSnapshot.mutateAsync({ vmId: sandbox.id, snapshotId: snapshot.id });
      } catch (err) {
        console.error('Failed to rollback:', err);
        setError(err instanceof Error ? err.message : 'Failed to rollback');
      } finally {
        setRollingBackSnapshot(null);
      }
    }
  };

  const formatSnapshotSize = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handleRename = async () => {
    if (!editName.trim() || editName === sandbox.name) {
      setIsEditing(false);
      setEditName(sandbox.name);
      return;
    }
    try {
      await renameSandbox.mutateAsync({ id: sandbox.id, name: editName.trim() });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename');
      setEditName(sandbox.name);
      setIsEditing(false);
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(sandbox.name);
    }
  };

  const handleReconfigure = async (resources: { vcpus?: number; memoryMb?: number; diskGb?: number }) => {
    setReconfigureError(null);
    try {
      await updateResources.mutateAsync({ id: sandbox.id, resources });
      setShowReconfigure(false);
    } catch (err) {
      setReconfigureError(err instanceof Error ? err.message : 'Failed to update resources');
    }
  };

  const handleUploadToSandbox = async (event: React.ChangeEvent<HTMLInputElement>, isFolder = false) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    const fileList = Array.from(files);

    // Filter out common large/unnecessary directories for folder uploads
    const EXCLUDED_DIRS = /^[^/]+\/(node_modules|\.git|\.next|\.nuxt|dist|build|\.cache|\.turbo|__pycache__|\.venv|venv|target)\//;
    const effectiveList = isFolder
      ? fileList.filter(file => !EXCLUDED_DIRS.test(file.webkitRelativePath))
      : fileList;

    if (effectiveList.length === 0) {
      console.warn('No files remaining after filtering');
      setIsUploading(false);
      return;
    }

    // Calculate total size
    const totalSize = effectiveList.reduce((sum, f) => sum + f.size, 0);
    const displayName = isFolder
      ? effectiveList[0].webkitRelativePath.split('/')[0] || 'folder'
      : effectiveList[0].name;

    setUploadDetails({
      fileName: displayName,
      fileCount: effectiveList.length,
      loaded: 0,
      total: totalSize,
    });

    try {
      if (isFolder) {
        // For folder uploads, use the directory upload endpoint (tar-based, single transfer)
        const filesWithPaths = effectiveList.map(file => ({
          file,
          relativePath: file.webkitRelativePath || file.name,
        }));

        const upload = uploadDirectoryToSandbox(
          sandbox.id,
          filesWithPaths,
          getDefaultWorkspacePath(sandbox.backend),
          (progress) => {
            setUploadProgress(progress.percent);
            setUploadDetails(prev => prev ? { ...prev, loaded: progress.loaded } : null);
          }
        );
        uploadAbortRef.current = upload.abort;
        await upload.promise;
      } else {
        // Single file upload
        for (const file of fileList) {
          const upload = uploadFileToSandbox(
            sandbox.id,
            file,
            getDefaultWorkspacePath(sandbox.backend),
            (progress) => {
              setUploadProgress(progress.percent);
              setUploadDetails(prev => prev ? { ...prev, loaded: progress.loaded } : null);
            }
          );
          uploadAbortRef.current = upload.abort;
          await upload.promise;
        }
      }
    } catch (err) {
      console.error('Upload failed:', err);
      const message = err instanceof Error ? err.message : 'Upload failed';
      if (message !== 'Upload cancelled') {
        setError(message);
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      setUploadDetails(null);
      uploadAbortRef.current = null;
      // Clear the inputs
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleCancelUpload = () => {
    if (uploadAbortRef.current) {
      uploadAbortRef.current();
    }
  };

  // Close file browser on click outside
  useEffect(() => {
    if (!showFileBrowser) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (fileBrowserRef.current && !fileBrowserRef.current.contains(e.target as Node)) {
        setShowFileBrowser(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFileBrowser]);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatBytesLong = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getVolumeId = (volumeName: string): string => {
    // For Docker volumes, use the volume name directly with vol-docker- prefix
    // For VM volumes, use the volume ID with vol-vm- prefix
    if (isDocker) {
      return `vol-docker-${volumeName}`;
    } else {
      // For VMs, find the volume by name and get its ID
      const vol = vmMeta?.volumes?.find(v => v.name === volumeName);
      return vol?.id ? `vol-vm-${vol.id}` : `vol-vm-${volumeName}`;
    }
  };

  // Generate port URL based on backend type
  const getPortUrl = (port: { container: number; host: number }) => {
    if (isDocker) {
      return `http://localhost:${port.host}`;
    } else if (sandbox.guestIp) {
      return `http://${sandbox.guestIp}:${port.container}`;
    }
    return `http://localhost:${port.host}`;
  };

  return (
    <>
      <div
        ref={cardRef}
        className={`border bg-[hsl(var(--bg-surface))] transition-all duration-500 flex flex-col ${
          highlight
            ? 'border-[hsl(var(--cyan))] ring-2 ring-[hsl(var(--cyan)/0.3)] animate-pulse'
            : 'border-[hsl(var(--border))]'
        }`}
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-[hsl(var(--border))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <Circle className={`h-2 w-2 fill-current flex-shrink-0 ${
                  stateColorVar === 'text-muted'
                    ? 'text-[hsl(var(--text-muted))]'
                    : `text-[hsl(var(--${stateColorVar}))]`
                } ${(isBuilding || sandbox.status === 'starting' || sandbox.status === 'stopping') ? 'animate-pulse' : ''}`} />
                {isEditing ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={handleRenameKeyDown}
                    autoFocus
                    className="text-xs font-medium text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-base))] border border-[hsl(var(--cyan)/0.5)] px-1 py-0.5 outline-none focus:border-[hsl(var(--cyan))]"
                  />
                ) : (
                  <h3
                    className={`text-xs font-medium text-[hsl(var(--text-primary))] truncate ${canRename ? 'cursor-pointer hover:text-[hsl(var(--cyan))]' : ''}`}
                    onClick={() => canRename && setIsEditing(true)}
                    title={canRename ? 'Click to rename' : undefined}
                  >
                    {sandbox.name}
                  </h3>
                )}
                <span className={`text-[10px] uppercase tracking-wider ${
                  stateColorVar === 'text-muted'
                    ? 'text-[hsl(var(--text-muted))]'
                    : `text-[hsl(var(--${stateColorVar}))]`
                }`}>
                  {currentState.label}
                </span>
                <BackendBadge backend={sandbox.backend} size="sm" />
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] truncate">
                {sandbox.image}
              </p>
            </div>

            {/* Actions */}
            {isBuilding ? (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setShowLogs(true)}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                  title="View Build Logs"
                >
                  <ScrollText className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Remove"
                >
                  {deleteSandbox.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5">
                {isRunning && (
                  <>
                    <button
                      onClick={handleOpenTerminal}
                      className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                      title="Open Terminal"
                    >
                      <TerminalSquare className="h-3.5 w-3.5" />
                    </button>
                    {canSnapshot && (
                      <button
                        onClick={handleCreateSnapshot}
                        disabled={isCreatingSnapshot}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--purple))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                        title="Create Snapshot"
                      >
                        {isCreatingSnapshot ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Camera className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    {/* Upload buttons */}
                    <div className="relative group/upload">
                      <button
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                        title={isUploading && uploadProgress !== null ? `Uploading: ${uploadProgress}%` : 'Upload files to workspace'}
                        disabled={isUploading}
                      >
                        {isUploading ? (
                          <div className="relative">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {uploadProgress !== null && (
                              <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[8px] text-[hsl(var(--cyan))]">
                                {uploadProgress}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <div className="absolute right-0 top-full mt-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg z-10 opacity-0 invisible group-hover/upload:opacity-100 group-hover/upload:visible transition-all">
                        <label className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] cursor-pointer whitespace-nowrap">
                          <Upload className="h-3 w-3" />
                          Files
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={(e) => handleUploadToSandbox(e, false)}
                            className="hidden"
                          />
                        </label>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] cursor-pointer whitespace-nowrap">
                          <FolderUp className="h-3 w-3" />
                          Folder
                          <input
                            ref={folderInputRef}
                            type="file"
                            // @ts-expect-error webkitdirectory is not in the standard types
                            webkitdirectory="true"
                            onChange={(e) => handleUploadToSandbox(e, true)}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                    {/* Download / File browser button */}
                    <div className="relative" ref={fileBrowserRef}>
                      <button
                        onClick={() => setShowFileBrowser(!showFileBrowser)}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                        title="Browse & download files"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      {showFileBrowser && (
                        <SandboxFileBrowser
                          sandboxId={sandbox.id}
                          defaultPath={getDefaultWorkspacePath(sandbox.backend)}
                          onClose={() => setShowFileBrowser(false)}
                        />
                      )}
                    </div>
                  </>
                )}
                {/* Logs button - always visible (except during building which has its own) */}
                <button
                  onClick={() => setShowLogs(true)}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                  title="View Logs"
                >
                  <ScrollText className="h-3.5 w-3.5" />
                </button>
                {(isRunning || isStuckTransition) ? (
                  <button
                    onClick={handleStop}
                    disabled={stopSandbox.isPending}
                    className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                    title="Stop"
                  >
                    {stopSandbox.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : (isStopped || isFailed) && (
                  <button
                    onClick={handleStart}
                    disabled={isPending}
                    className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                    title="Start"
                  >
                    {startSandbox.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Remove"
                >
                  {deleteSandbox.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Resource Specs */}
        <div className="px-3 py-1.5 border-b border-[hsl(var(--border))] flex items-center gap-4 text-[10px] text-[hsl(var(--text-muted))]">
          <span className="flex items-center gap-1" title="vCPUs">
            <Cpu className="h-3 w-3" />
            {sandbox.vcpus} vCPU{sandbox.vcpus !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1" title="Memory">
            <MemoryStick className="h-3 w-3" />
            {sandbox.memoryMb >= 1024
              ? `${(sandbox.memoryMb / 1024).toFixed(sandbox.memoryMb % 1024 === 0 ? 0 : 1)} GB`
              : `${sandbox.memoryMb} MB`}
          </span>
          {sandbox.diskGb > 0 && (
            <span className="flex items-center gap-1" title="Disk">
              <HardDrive className="h-3 w-3" />
              {sandbox.diskGb} GB
            </span>
          )}
          {sandbox.guestIp && (
            <span className="flex items-center gap-1" title="Guest IP">
              <Network className="h-3 w-3" />
              {sandbox.guestIp}
            </span>
          )}
          {isVm && vmMeta?.bootTimeMs != null && vmMeta.bootTimeMs > 0 && (
            <span className="flex items-center gap-1" title="Boot time">
              <Clock className="h-3 w-3" />
              {vmMeta.bootTimeMs < 1000
                ? `${vmMeta.bootTimeMs}ms`
                : `${(vmMeta.bootTimeMs / 1000).toFixed(1)}s`}
            </span>
          )}
          {canReconfigure && (
            <button
              onClick={() => { setReconfigureError(null); setShowReconfigure(true); }}
              className="ml-auto p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
              title="Configure resources"
            >
              <Settings className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Boot Progress */}
        {sandbox.statusMessage && !isFailed && (
          <div className="mx-3 mt-2.5 p-2 bg-[hsl(var(--cyan)/0.05)] border border-[hsl(var(--cyan)/0.2)] flex items-center gap-2">
            <div className="h-3 w-3 flex-shrink-0">
              <svg className="animate-spin h-3 w-3 text-[hsl(var(--cyan))]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-[10px] text-[hsl(var(--cyan))] truncate">
              {sandbox.statusMessage}
            </p>
          </div>
        )}

        {/* Error Message */}
        {(error || (isFailed && sandbox.error)) && (
          <div className="mx-3 mt-2.5 p-2 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-[hsl(var(--red))] flex-shrink-0 mt-0.5" />
            <p className="flex-1 min-w-0 text-[10px] text-[hsl(var(--red))] break-words">
              {error || sandbox.error}
            </p>
            {error && (
              <button
                onClick={() => setError(null)}
                className="p-0.5 text-[hsl(var(--red))] hover:text-[hsl(var(--red)/0.7)] transition-colors flex-shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Upload Progress */}
        {isUploading && uploadDetails && (
          <div className="mx-3 mt-2.5 p-2 bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Upload className="h-3.5 w-3.5 text-[hsl(var(--cyan))] flex-shrink-0 animate-pulse" />
                <span className="text-[10px] text-[hsl(var(--text-primary))] truncate">
                  {uploadDetails.fileName}
                  {uploadDetails.fileCount > 1 && ` (+${uploadDetails.fileCount - 1} files)`}
                </span>
              </div>
              <button
                onClick={handleCancelUpload}
                className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] transition-colors flex-shrink-0"
                title="Cancel upload"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="h-1.5 bg-[hsl(var(--bg-base))] rounded-full overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--cyan))] transition-all duration-300"
                style={{ width: `${uploadProgress || 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1 text-[9px] text-[hsl(var(--text-muted))]">
              <span>{formatBytes(uploadDetails.loaded)} / {formatBytes(uploadDetails.total)}</span>
              <span>{uploadProgress}%</span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-3 py-2.5 space-y-3 flex-1">
          {/* Connection Command */}
          {isRunning && (dockerCommand || sshCommand || isDaytona) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                  <TerminalIcon className="h-3 w-3" />
                  <span>Connect</span>
                </div>
                {/* Show tabs if both Docker exec and SSH are available */}
                {isDocker && dockerCommand && sshCommand && (
                  <div className="flex items-center gap-0.5 text-[10px]">
                    <button
                      onClick={() => setConnectionMode('docker')}
                      className={`px-1.5 py-0.5 transition-colors ${
                        connectionMode === 'docker'
                          ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                          : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                      }`}
                    >
                      Docker
                    </button>
                    <button
                      onClick={() => setConnectionMode('ssh')}
                      className={`px-1.5 py-0.5 transition-colors ${
                        connectionMode === 'ssh'
                          ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                          : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                      }`}
                    >
                      SSH
                    </button>
                  </div>
                )}
                {/* Show label when only one option available */}
                {isDocker && dockerCommand && !sshCommand && (
                  <span className="text-[10px] text-[hsl(var(--blue))]">Docker</span>
                )}
                {!isDocker && sshCommand && (
                  <span className="text-[10px] text-[hsl(var(--cyan))]">SSH</span>
                )}
                {isDaytona && !sshCommand && (
                  <span className="text-[10px] text-[hsl(var(--purple))]">Daytona</span>
                )}
              </div>
              {/* For Daytona without SSH command, show fetch button */}
              {isDaytona && !sshCommand ? (
                <div className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2">
                  <button
                    onClick={handleFetchSshCommand}
                    disabled={isFetchingSshCommand}
                    className="flex items-center gap-2 text-[10px] text-[hsl(var(--purple))] hover:text-[hsl(var(--purple-dim))] disabled:opacity-50"
                  >
                    {isFetchingSshCommand ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Getting SSH access...</span>
                      </>
                    ) : (
                      <>
                        <TerminalIcon className="h-3 w-3" />
                        <span>Get SSH Command</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (dockerCommand || sshCommand) && (
                <div className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[10px] text-[hsl(var(--text-secondary))] truncate">
                      {/* Show appropriate command based on backend and mode */}
                      {isDocker
                        ? (dockerCommand && sshCommand ? currentCommand : dockerCommand || sshCommand)
                        : sshCommand
                      }
                    </code>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={handleCopyCommand}
                        className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
                        title="Copy command"
                      >
                        {copied ? (
                          <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                      {(connectionMode === 'ssh' || !isDocker) && sandbox.sshKeyId && (
                        <button
                          onClick={handleDownloadKey}
                          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
                          title="Download SSH key"
                        >
                          <Download className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ports, Agents, Metrics & Volumes Row */}
          {(sandbox.ports.length > 0 || volumes.length > 0 || isRunning) && (
            <div className="flex gap-4">
              {/* Ports */}
              {sandbox.ports.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <Globe className="h-3 w-3" />
                    <span>Ports</span>
                  </div>
                  <div className="space-y-1">
                    {sandbox.ports.map((port, idx) => (
                      <a
                        key={idx}
                        href={getPortUrl(port)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan)/0.8)] transition-colors group"
                      >
                        <span>:{port.host}</span>
                        <span className="text-[hsl(var(--text-muted))]">→</span>
                        <span className="text-[hsl(var(--text-muted))]">:{port.container}</span>
                        <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Agents */}
              {isRunning && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <Bot className="h-3 w-3" />
                    <span>Agents</span>
                  </div>
                  <AgentBadges sandboxId={sandbox.id} isRunning={isRunning} />
                </div>
              )}

              {/* Guest Metrics Bars */}
              {metrics && (
                <div
                  className="relative space-y-1.5 min-w-[100px] cursor-pointer"
                  onMouseEnter={() => setShowMetricsPopover(true)}
                  onMouseLeave={() => setShowMetricsPopover(false)}
                >
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <Activity className="h-3 w-3" />
                    <span>Usage</span>
                  </div>
                  <div className="space-y-1.5">
                    {/* CPU */}
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-3 w-3 text-[hsl(var(--text-muted))] shrink-0" />
                      <div className="flex-1 h-2 bg-[hsl(var(--bg-base))] rounded-sm overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-sm ${metrics.cpuUsage > 80 ? 'bg-[hsl(var(--red))]' : metrics.cpuUsage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--cyan))]'}`}
                          style={{ width: `${metrics.cpuUsage}%` }}
                        />
                      </div>
                      <span className={`text-[9px] tabular-nums w-7 text-right shrink-0 ${metrics.cpuUsage > 80 ? 'text-[hsl(var(--red))]' : metrics.cpuUsage > 50 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--text-muted))]'}`}>{metrics.cpuUsage}%</span>
                    </div>
                    {/* Memory */}
                    <div className="flex items-center gap-1.5">
                      <MemoryStick className="h-3 w-3 text-[hsl(var(--text-muted))] shrink-0" />
                      <div className="flex-1 h-2 bg-[hsl(var(--bg-base))] rounded-sm overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-sm ${metrics.memoryUsage > 80 ? 'bg-[hsl(var(--red))]' : metrics.memoryUsage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--green))]'}`}
                          style={{ width: `${metrics.memoryUsage}%` }}
                        />
                      </div>
                      <span className={`text-[9px] tabular-nums w-7 text-right shrink-0 ${metrics.memoryUsage > 80 ? 'text-[hsl(var(--red))]' : metrics.memoryUsage > 50 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--text-muted))]'}`}>{metrics.memoryUsage}%</span>
                    </div>
                    {/* Disk */}
                    <div className="flex items-center gap-1.5">
                      <HardDrive className="h-3 w-3 text-[hsl(var(--text-muted))] shrink-0" />
                      <div className="flex-1 h-2 bg-[hsl(var(--bg-base))] rounded-sm overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-sm ${metrics.diskUsage > 90 ? 'bg-[hsl(var(--red))]' : metrics.diskUsage > 70 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--purple))]'}`}
                          style={{ width: `${metrics.diskUsage}%` }}
                        />
                      </div>
                      <span className={`text-[9px] tabular-nums w-7 text-right shrink-0 ${metrics.diskUsage > 90 ? 'text-[hsl(var(--red))]' : metrics.diskUsage > 70 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--text-muted))]'}`}>{metrics.diskUsage}%</span>
                    </div>
                  </div>

                  {/* Metrics Detail Popover */}
                  {showMetricsPopover && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-xl animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
                        <div className="flex items-center gap-1.5">
                          <Activity className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
                          <span className="text-[11px] font-medium text-[hsl(var(--text-primary))]">Guest Usage</span>
                        </div>
                      </div>
                      <div className="p-3 space-y-3">
                        {/* CPU Detail */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Cpu className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
                              <span className="text-[11px] font-medium text-[hsl(var(--text-primary))]">CPU</span>
                            </div>
                            <span className={`text-[11px] font-mono ${metrics.cpuUsage > 80 ? 'text-[hsl(var(--red))]' : metrics.cpuUsage > 50 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--cyan))]'}`}>{metrics.cpuUsage}%</span>
                          </div>
                          <div className="h-2 bg-[hsl(var(--bg-base))] overflow-hidden rounded-sm mb-1.5">
                            <div className={`h-full transition-all rounded-sm ${metrics.cpuUsage > 80 ? 'bg-[hsl(var(--red))]' : metrics.cpuUsage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--cyan))]'}`} style={{ width: `${metrics.cpuUsage}%` }} />
                          </div>
                          <div className="text-[10px] text-[hsl(var(--text-muted))]">
                            {sandbox.vcpus} vCPU{sandbox.vcpus !== 1 ? 's' : ''} allocated
                          </div>
                        </div>
                        {/* Memory Detail */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <MemoryStick className="h-3.5 w-3.5 text-[hsl(var(--green))]" />
                              <span className="text-[11px] font-medium text-[hsl(var(--text-primary))]">Memory</span>
                            </div>
                            <span className={`text-[11px] font-mono ${metrics.memoryUsage > 80 ? 'text-[hsl(var(--red))]' : metrics.memoryUsage > 50 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--green))]'}`}>{metrics.memoryUsage}%</span>
                          </div>
                          <div className="h-2 bg-[hsl(var(--bg-base))] overflow-hidden rounded-sm mb-1.5">
                            <div className={`h-full transition-all rounded-sm ${metrics.memoryUsage > 80 ? 'bg-[hsl(var(--red))]' : metrics.memoryUsage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--green))]'}`} style={{ width: `${metrics.memoryUsage}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-[hsl(var(--text-muted))]">
                            <span>Used: {formatBytesLong(metrics.memoryUsed)}</span>
                            <span>Total: {formatBytesLong(metrics.memoryTotal)}</span>
                          </div>
                        </div>
                        {/* Disk Detail */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <HardDrive className="h-3.5 w-3.5 text-[hsl(var(--purple))]" />
                              <span className="text-[11px] font-medium text-[hsl(var(--text-primary))]">Disk</span>
                            </div>
                            <span className={`text-[11px] font-mono ${metrics.diskUsage > 90 ? 'text-[hsl(var(--red))]' : metrics.diskUsage > 70 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--purple))]'}`}>{metrics.diskUsage}%</span>
                          </div>
                          <div className="h-2 bg-[hsl(var(--bg-base))] overflow-hidden rounded-sm mb-1.5">
                            <div className={`h-full transition-all rounded-sm ${metrics.diskUsage > 90 ? 'bg-[hsl(var(--red))]' : metrics.diskUsage > 70 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--purple))]'}`} style={{ width: `${metrics.diskUsage}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-[hsl(var(--text-muted))]">
                            <span>Used: {formatBytesLong(metrics.diskUsed)}</span>
                            <span>Total: {formatBytesLong(metrics.diskTotal)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="px-3 py-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
                        <div className="text-[9px] text-[hsl(var(--text-muted))] text-center">Refreshes every 5s</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Volumes */}
              {volumes.length > 0 && (
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    <HardDrive className="h-3 w-3" />
                    <span>Volumes</span>
                  </div>
                  <div className="space-y-1">
                    {volumes.map((vol) => (
                      <div
                        key={vol.name}
                        className="flex items-center gap-1.5 text-[10px] group"
                      >
                        <span className="text-[hsl(var(--text-primary))]">{vol.name}</span>
                        <span className="text-[hsl(var(--text-muted))]">→</span>
                        <span className="text-[hsl(var(--text-muted))] truncate flex-1">{vol.mountPath}</span>
                        {isRunning && (
                          <button
                            onClick={() => setBrowsingVolume({ id: getVolumeId(vol.name), name: vol.name })}
                            className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Browse & upload files"
                          >
                            <Upload className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Snapshots (VMs only) */}
          {isVm && (
            <div>
              <button
                onClick={() => setShowSnapshots(!showSnapshots)}
                className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] mb-2"
              >
                {showSnapshots ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <Camera className="h-3 w-3" />
                Snapshots ({snapshots?.length || 0})
              </button>

              {showSnapshots && (
                <div className="space-y-2 pl-4">
                  {/* Snapshots list */}
                  {snapshotsLoading ? (
                    <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading...
                    </div>
                  ) : snapshots && snapshots.length > 0 ? (
                    <div className="space-y-1">
                      {snapshots.map(snapshot => (
                        <div
                          key={snapshot.id}
                          className="flex items-center justify-between p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[10px]"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[hsl(var(--text-primary))] truncate">
                              {snapshot.name || snapshot.id}
                            </div>
                            <div className="text-[hsl(var(--text-muted))]">
                              {new Date(snapshot.createdAt).toLocaleString()} • {formatSnapshotSize(snapshot.sizeBytes)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleRollbackToSnapshot(snapshot)}
                              disabled={rollingBackSnapshot === snapshot.id || launchingSnapshot === snapshot.id}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] disabled:opacity-50"
                              title="Restore this sandbox to the snapshot state (stops sandbox and replaces disk)"
                            >
                              {rollingBackSnapshot === snapshot.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                              <span>Rollback</span>
                            </button>
                            <button
                              onClick={() => handleLaunchFromSnapshot(snapshot)}
                              disabled={launchingSnapshot === snapshot.id || rollingBackSnapshot === snapshot.id}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
                              title="Create a new independent sandbox from this snapshot"
                            >
                              {launchingSnapshot === snapshot.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Play className="h-3 w-3" />
                              )}
                              <span>New</span>
                            </button>
                            <button
                              onClick={() => handleDeleteSnapshot(snapshot)}
                              disabled={deleteSnapshot.isPending || launchingSnapshot === snapshot.id || rollingBackSnapshot === snapshot.id}
                              className="p-1 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] disabled:opacity-50"
                              title="Delete snapshot"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-[hsl(var(--text-muted))] italic mb-2">
                      No snapshots yet.
                    </p>
                  )}
                  {/* Take Snapshot button */}
                  <button
                    onClick={handleCreateSnapshot}
                    disabled={!canSnapshot || isCreatingSnapshot}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                    title={canSnapshot ? "Take a snapshot of the current state" : "Sandbox must be running to take a snapshot"}
                  >
                    {isCreatingSnapshot ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Camera className="h-3 w-3" />
                    )}
                    <span>Take Snapshot</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 bg-[hsl(var(--bg-base))] border-t border-[hsl(var(--border))] flex items-center justify-between">
          <p className="text-[10px] text-[hsl(var(--text-muted))]">
            Created {new Date(sandbox.createdAt).toLocaleString()}
          </p>
          <p className="text-[10px] text-[hsl(var(--text-muted))] font-mono">
            {sandbox.id}
          </p>
        </div>
      </div>

      {/* Log Viewer Modal */}
      {showLogs && (
        <SandboxLogViewer
          sandboxId={sandbox.id}
          sandboxName={sandbox.name}
          backend={sandbox.backend}
          onClose={() => setShowLogs(false)}
        />
      )}

      {/* Volume File Browser Modal */}
      {browsingVolume && (
        <VolumeFileBrowser
          volumeId={browsingVolume.id}
          volumeName={browsingVolume.name}
          isAttached={true}
          isVmRunning={isRunning}
          onClose={() => setBrowsingVolume(null)}
        />
      )}

      {/* Reconfigure Resources Dialog */}
      {showReconfigure && (
        <ReconfigureDialog
          sandbox={sandbox}
          onClose={() => setShowReconfigure(false)}
          onSave={handleReconfigure}
          isPending={updateResources.isPending}
          error={reconfigureError}
        />
      )}
    </>
  );
}
