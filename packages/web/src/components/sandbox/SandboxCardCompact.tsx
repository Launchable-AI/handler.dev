/**
 * SandboxCardCompact - Compact card view for sandbox grid
 */

import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Trash2,
  Terminal,
  Copy,
  Check,
  Cpu,
  MemoryStick,
  Network,
  Camera,
  Loader2,
  Download,
  Upload,
  FolderUp,
  ScrollText,
} from 'lucide-react';
import type { Sandbox, VmMeta } from '../../api/client';
import * as api from '../../api/client';
import { uploadFileToSandbox, uploadDirectoryToSandbox } from '../../api/client';
import { BackendBadge } from './BackendBadge';
import { AgentBadges } from './AgentBadges';
import { SandboxFileBrowser } from './SandboxFileBrowser';
import { SandboxLogViewer } from './SandboxLogViewer';
import { StatusIndicator, isTransitioning } from './StatusIndicator';
import { useStartSandbox, useStopSandbox, useDeleteSandbox, useRenameSandbox } from '../../hooks/useSandboxes';
import { useConfirm } from '../ConfirmModal';
import { useTerminalPanel } from '../TerminalPanel';

interface SandboxCardCompactProps {
  sandbox: Sandbox;
  highlight?: boolean;
}

export function SandboxCardCompact({ sandbox, highlight }: SandboxCardCompactProps) {
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
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();
  const [copied, setCopied] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(sandbox.name);
  const [showLogs, setShowLogs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<(() => void) | null>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  const isRunning = sandbox.status === 'running';
  const isStopped = sandbox.status === 'stopped' || sandbox.status === 'archived';
  const isTransition = isTransitioning(sandbox.status);

  // Check if this is a VM-based sandbox that supports snapshots
  const isVm = sandbox.backend === 'firecracker' || sandbox.backend === 'cloud-hypervisor';
  const vmMeta = sandbox.backendMeta as VmMeta | undefined;
  const canSnapshot = isVm && isRunning && vmMeta?.type === 'vm';

  const isFailed = sandbox.status === 'error';
  const canStart = (isStopped || isFailed) && !isTransition;
  const canStop = isRunning && !isTransition;
  const canDelete = !isTransition;
  const canOpenTerminal = isRunning;
  const canRename = !isTransition;

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
    } else {
      // Local VMs use SSH with local key
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
        const filesWithPaths = fileList.map(file => ({
          file,
          relativePath: file.webkitRelativePath || file.name,
        }));
        const upload = uploadDirectoryToSandbox(
          sandbox.id,
          filesWithPaths,
          getDefaultWorkspacePath(sandbox.backend),
          (progress) => setUploadProgress(progress.percent),
        );
        uploadAbortRef.current = upload.abort;
        await upload.promise;
      } else {
        for (const file of fileList) {
          const upload = uploadFileToSandbox(
            sandbox.id,
            file,
            getDefaultWorkspacePath(sandbox.backend),
            (progress) => setUploadProgress(progress.percent),
          );
          uploadAbortRef.current = upload.abort;
          await upload.promise;
        }
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      uploadAbortRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // For Docker, prefer dockerExecCommand; for VMs, use sshCommand
  const isDocker = sandbox.backend === 'docker';
  const connectCommand = isDocker
    ? (sandbox.dockerExecCommand || sandbox.sshCommand)
    : sandbox.sshCommand;

  const copyCommand = async () => {
    if (!connectCommand) return;

    try {
      await navigator.clipboard.writeText(connectCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

  // File browser state
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const fileBrowserRef = useRef<HTMLDivElement>(null);

  /** Get the default workspace path based on sandbox backend */
  const getDefaultWorkspacePath = (backend: Sandbox['backend']): string => {
    switch (backend) {
      case 'docker': return '/home/dev/workspace';
      case 'daytona': return '/home/daytona';
      case 'aws': return '/home/ubuntu';
      case 'firecracker':
      case 'cloud-hypervisor':
      default: return '/home/agent';
    }
  };

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

  return (
    <>
    <div
      ref={cardRef}
      className={`p-3 bg-[hsl(var(--bg-surface))] border transition-all duration-500 ${
        highlight
          ? 'border-[hsl(var(--cyan))] ring-2 ring-[hsl(var(--cyan)/0.3)] animate-pulse'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIndicator status={sandbox.status} size="sm" />
          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleEditKeyDown}
              className="text-sm font-medium text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--cyan))] px-1 py-0.5 outline-none flex-1 min-w-0"
            />
          ) : (
            <span
              className={`text-sm font-medium text-[hsl(var(--text-primary))] truncate ${canRename ? 'cursor-pointer hover:text-[hsl(var(--cyan))]' : ''}`}
              onClick={() => canRename && setIsEditing(true)}
              title={canRename ? 'Click to rename' : undefined}
            >
              {sandbox.name}
            </span>
          )}
        </div>
        <BackendBadge backend={sandbox.backend} size="sm" />
        <AgentBadges sandboxId={sandbox.id} isRunning={isRunning} compact />
      </div>

      {/* Specs */}
      <div className="flex items-center gap-3 text-[10px] text-[hsl(var(--text-muted))] mb-3">
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
        {sandbox.guestIp && (
          <span className="flex items-center gap-1">
            <Network className="h-3 w-3" />
            {sandbox.guestIp}
          </span>
        )}
      </div>

      {/* Connect Command (if running) - Docker exec for containers, SSH for VMs */}
      {isRunning && connectCommand && (
        <div className="flex items-center gap-1 mb-2 p-1.5 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
          <code className="flex-1 text-[9px] text-[hsl(var(--text-muted))] font-mono truncate">
            {connectCommand}
          </code>
          <button
            onClick={copyCommand}
            className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3 text-[hsl(var(--green))]" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      )}

      {/* Actions - uniform icon-only buttons */}
      <div className="flex items-center gap-1">
        {canOpenTerminal && (
          <button
            onClick={handleOpenTerminal}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            title="Open Terminal"
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
        )}
        {isRunning && (
          <div className="relative group/upload">
            <button
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
              title={isUploading && uploadProgress !== null ? `Uploading: ${uploadProgress}%` : 'Upload files'}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
            </button>
            <div className="absolute left-0 top-full mt-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg z-10 opacity-0 invisible group-hover/upload:opacity-100 group-hover/upload:visible transition-all">
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
        {isRunning && (
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
        )}
        {canSnapshot && (
          <button
            onClick={handleCreateSnapshot}
            disabled={isCreatingSnapshot}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--purple))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
            title="Create Snapshot"
          >
            {isCreatingSnapshot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          onClick={() => setShowLogs(true)}
          className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
          title="View Logs"
        >
          <ScrollText className="h-3.5 w-3.5" />
        </button>
        {canStart && (
          <button
            onClick={handleStart}
            disabled={startSandbox.isPending}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
            title="Start"
          >
            {startSandbox.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}
        {canStop && (
          <button
            onClick={handleStop}
            disabled={stopSandbox.isPending}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
            title="Stop"
          >
            {stopSandbox.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          </button>
        )}
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={deleteSandbox.isPending}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
            title="Delete"
          >
            {deleteSandbox.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        )}
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
    </>
  );
}
