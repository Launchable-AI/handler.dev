/**
 * SandboxRow - Table row view for sandbox list
 */

import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Trash2,
  Terminal,
  Cpu,
  MemoryStick,
  Camera,
  Loader2,
  HardDrive,
  Upload,
  FolderUp,
  Copy,
  Check,
} from 'lucide-react';
import type { Sandbox, VmMeta } from '../../api/client';
import * as api from '../../api/client';
import { VolumeFileBrowser } from '../VolumeFileBrowser';
import { BackendBadge } from './BackendBadge';
import { StatusIndicator, isTransitioning } from './StatusIndicator';
import { useStartSandbox, useStopSandbox, useDeleteSandbox, useRenameSandbox } from '../../hooks/useSandboxes';
import { useConfirm } from '../ConfirmModal';
import { useTerminalPanel } from '../TerminalPanel';

type ColumnId = 'status' | 'name' | 'backend' | 'resources' | 'connect' | 'image' | 'ip' | 'created' | 'volumes' | 'actions';

/** Get the default workspace path based on sandbox backend */
function getDefaultWorkspacePath(backend: Sandbox['backend']): string {
  switch (backend) {
    case 'docker':
      return '/home/dev/workspace';
    case 'daytona':
      return '/home/daytona';
    case 'firecracker':
    case 'cloud-hypervisor':
    default:
      return '/home/agent';
  }
}

interface SandboxRowProps {
  sandbox: Sandbox;
  highlight?: boolean;
  visibleColumns?: Set<ColumnId>;
}

// Default columns if not specified
const DEFAULT_COLUMNS = new Set<ColumnId>(['status', 'name', 'backend', 'connect', 'volumes', 'actions']);

export function SandboxRow({ sandbox, highlight, visibleColumns = DEFAULT_COLUMNS }: SandboxRowProps) {
  const isColumnVisible = (col: ColumnId) => visibleColumns.has(col);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const rowRef = useRef<HTMLTableRowElement>(null);

  // Scroll into view and flash when highlighted
  useEffect(() => {
    if (highlight && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);
  const startSandbox = useStartSandbox();
  const stopSandbox = useStopSandbox();
  const deleteSandbox = useDeleteSandbox();
  const renameSandbox = useRenameSandbox();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();

  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(sandbox.name);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  // Can rename when not in a transition state
  const canRename = !isTransitioning(sandbox.status);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [browsingVolume, setBrowsingVolume] = useState<{ id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isRunning = sandbox.status === 'running';
  const isStopped = sandbox.status === 'stopped' || sandbox.status === 'archived';
  const isTransition = isTransitioning(sandbox.status);

  // Check if this is a VM-based sandbox that supports snapshots
  const isVm = sandbox.backend === 'firecracker' || sandbox.backend === 'cloud-hypervisor';
  const vmMeta = sandbox.backendMeta as VmMeta | undefined;
  const canSnapshot = isVm && isRunning && vmMeta?.type === 'vm';

  const canStart = isStopped && !isTransition;
  const canStop = isRunning && !isTransition;
  const canDelete = !isTransition;
  const canOpenTerminal = isRunning;

  const handleStart = async () => {
    try {
      await startSandbox.mutateAsync(sandbox.id);
    } catch (error) {
      console.error('Failed to start sandbox:', error);
    }
  };

  const handleStop = async () => {
    try {
      await stopSandbox.mutateAsync(sandbox.id);
    } catch (error) {
      console.error('Failed to stop sandbox:', error);
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Sandbox',
      message: `Are you sure you want to delete "${sandbox.name}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await deleteSandbox.mutateAsync(sandbox.id);
      } catch (error) {
        console.error('Failed to delete sandbox:', error);
      }
    }
  };

  const handleOpenTerminal = () => {
    if (sandbox.terminalType === 'docker-exec') {
      const containerId = sandbox.backendMeta?.type === 'docker'
        ? sandbox.backendMeta.containerId
        : sandbox.id.replace('docker-', '');
      terminalPanel.openContainerTerminal(containerId, sandbox.name);
    } else {
      if (sandbox.guestIp) {
        terminalPanel.openTerminal(sandbox.id, sandbox.name, sandbox.guestIp);
      }
    }
  };

  const handleCreateSnapshot = async () => {
    // Use sandbox.id directly - backend route needs prefix to determine service
    setIsCreatingSnapshot(true);
    try {
      await api.createVmSnapshot(sandbox.id, `${sandbox.name}-${Date.now()}`);
    } catch (error) {
      console.error('Failed to create snapshot:', error);
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleUploadToSandbox = async (event: React.ChangeEvent<HTMLInputElement>, isFolder = false) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    const fileList = Array.from(files);

    try {
      if (isFolder && fileList.length > 1) {
        // For folder uploads, use the directory upload endpoint (tar-based, single transfer)
        const filesWithPaths = fileList.map(file => ({
          file,
          relativePath: file.webkitRelativePath || file.name,
        }));

        await api.uploadDirectoryToSandbox(
          sandbox.id,
          filesWithPaths,
          getDefaultWorkspacePath(sandbox.backend),
          (progress) => {
            setUploadProgress(progress.percent);
          }
        );
      } else {
        // Single file upload
        for (const file of fileList) {
          await api.uploadFileToSandbox(sandbox.id, file, getDefaultWorkspacePath(sandbox.backend));
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const isDocker = sandbox.backend === 'docker';

  const getVolumeId = (volumeName: string): string => {
    if (isDocker) {
      return `vol-docker-${volumeName}`;
    } else {
      const vol = vmMeta?.volumes?.find(v => v.name === volumeName);
      return vol?.id ? `vol-vm-${vol.id}` : `vol-vm-${volumeName}`;
    }
  };

  // Get connection command (SSH or docker exec)
  const connectionCommand = sandbox.sshCommand || sandbox.dockerExecCommand;

  const handleCopyCommand = async () => {
    if (!connectionCommand) return;
    try {
      await navigator.clipboard.writeText(connectionCommand);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleRename = async () => {
    if (!editName.trim() || editName.trim() === sandbox.name) {
      setIsEditing(false);
      setEditName(sandbox.name);
      return;
    }
    try {
      await renameSandbox.mutateAsync({ id: sandbox.id, name: editName.trim() });
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to rename:', err);
      setEditName(sandbox.name);
      setIsEditing(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(sandbox.name);
    }
  };

  return (
    <>
    <tr
      ref={rowRef}
      className={`border-b transition-all duration-500 ${
        highlight
          ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] ring-2 ring-inset ring-[hsl(var(--cyan)/0.3)]'
          : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-elevated))]'
      }`}
    >
      {/* Status */}
      {isColumnVisible('status') && (
        <td className="px-3 py-2">
          <StatusIndicator status={sandbox.status} size="sm" />
        </td>
      )}

      {/* Name */}
      {isColumnVisible('name') && (
        <td className="px-3 py-2">
          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleEditKeyDown}
              className="text-sm text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--cyan))] px-1 py-0.5 outline-none w-full max-w-[150px]"
            />
          ) : (
            <span
              className={`text-sm text-[hsl(var(--text-primary))] ${canRename ? 'cursor-pointer hover:text-[hsl(var(--cyan))]' : ''}`}
              onClick={() => canRename && setIsEditing(true)}
              title={canRename ? 'Click to rename' : undefined}
            >
              {sandbox.name}
            </span>
          )}
        </td>
      )}

      {/* Backend */}
      {isColumnVisible('backend') && (
        <td className="px-3 py-2">
          <BackendBadge backend={sandbox.backend} size="sm" showLabel />
        </td>
      )}

      {/* Connect - SSH/Docker command with copy */}
      {isColumnVisible('connect') && (
        <td className="px-3 py-2">
          {isRunning && connectionCommand ? (
            <div className="flex items-center gap-1 group max-w-[200px]">
              <code className="text-[10px] text-[hsl(var(--text-muted))] font-mono truncate flex-1" title={connectionCommand}>
                {connectionCommand.length > 30 ? `${connectionCommand.slice(0, 30)}...` : connectionCommand}
              </code>
              <button
                onClick={handleCopyCommand}
                className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                title="Copy command"
              >
                {copiedCommand ? (
                  <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          ) : (
            <span className="text-[10px] text-[hsl(var(--text-muted))]">-</span>
          )}
        </td>
      )}

      {/* Resources */}
      {isColumnVisible('resources') && (
        <td className="px-3 py-2">
          <div className="flex items-center gap-3 text-[10px] text-[hsl(var(--text-muted))]">
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {sandbox.vcpus}
            </span>
            <span className="flex items-center gap-1">
              <MemoryStick className="h-3 w-3" />
              {sandbox.memoryMb >= 1024
                ? `${(sandbox.memoryMb / 1024).toFixed(0)}GB`
                : `${sandbox.memoryMb}MB`}
            </span>
          </div>
        </td>
      )}

      {/* Image */}
      {isColumnVisible('image') && (
        <td className="px-3 py-2 max-w-[200px]">
          <span className="text-[11px] text-[hsl(var(--text-muted))] truncate block" title={sandbox.image}>
            {sandbox.image}
          </span>
        </td>
      )}

      {/* IP */}
      {isColumnVisible('ip') && (
        <td className="px-3 py-2">
          <span className="text-[10px] text-[hsl(var(--text-muted))] font-mono">
            {sandbox.guestIp || '-'}
          </span>
        </td>
      )}

      {/* Created */}
      {isColumnVisible('created') && (
        <td className="px-3 py-2">
          <span className="text-[10px] text-[hsl(var(--text-muted))]">
            {new Date(sandbox.createdAt).toLocaleDateString()}
          </span>
        </td>
      )}

      {/* Volumes */}
      {isColumnVisible('volumes') && (
        <td className="px-3 py-2">
          {(() => {
            const volumes = sandbox.backendMeta?.type === 'docker'
              ? sandbox.backendMeta.volumes
              : sandbox.backendMeta?.type === 'vm'
              ? sandbox.backendMeta.volumes
              : [];
            if (!volumes || volumes.length === 0) {
              return <span className="text-[10px] text-[hsl(var(--text-muted))]">-</span>;
            }
            return (
              <div className="flex items-center gap-1 group">
                <HardDrive className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                <span className="text-[10px] text-[hsl(var(--text-secondary))]" title={volumes.map((v: { name: string }) => v.name).join(', ')}>
                  {volumes.length} vol{volumes.length !== 1 ? 's' : ''}
                </span>
                {isRunning && volumes.length > 0 && (
                  <button
                    onClick={() => {
                      const vol = volumes[0] as { name: string; id?: string };
                      setBrowsingVolume({ id: getVolumeId(vol.name), name: vol.name });
                    }}
                    className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Browse & upload files"
                  >
                    <Upload className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })()}
        </td>
      )}

      {/* Actions */}
      {isColumnVisible('actions') && (
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            {canOpenTerminal && (
              <button
                onClick={handleOpenTerminal}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] transition-colors"
                title="Terminal"
              >
                <Terminal className="h-3.5 w-3.5" />
              </button>
            )}
            {isRunning && (
              <div className="relative group/upload">
                <button
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] transition-colors disabled:opacity-50"
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
            )}
            {canStart && (
              <button
                onClick={handleStart}
                disabled={startSandbox.isPending}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] transition-colors disabled:opacity-50"
                title="Start"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            {canStop && (
              <button
                onClick={handleStop}
                disabled={stopSandbox.isPending}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] transition-colors disabled:opacity-50"
                title="Stop"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            )}
            {canSnapshot && (
              <button
                onClick={handleCreateSnapshot}
                disabled={isCreatingSnapshot}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] transition-colors disabled:opacity-50"
                title="Create Snapshot"
              >
                {isCreatingSnapshot ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Camera className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleteSandbox.isPending}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] transition-colors disabled:opacity-50"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>

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
    </>
  );
}
