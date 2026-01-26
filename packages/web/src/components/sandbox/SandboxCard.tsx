/**
 * SandboxCard - Polished card view for a single sandbox
 * Matches the ContainerCard design with Docker/SSH tabs
 */

import { useState } from 'react';
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
} from 'lucide-react';
import type { Sandbox, DockerMeta, VmMeta } from '../../api/client';
import { downloadSandboxSshKey } from '../../api/client';
import { BackendBadge } from './BackendBadge';
import { useStartSandbox, useStopSandbox, useDeleteSandbox } from '../../hooks/useSandboxes';
import { useConfirm } from '../ConfirmModal';
import { useTerminalPanel } from '../TerminalPanel';
import { SandboxLogViewer } from './SandboxLogViewer';

interface SandboxCardProps {
  sandbox: Sandbox;
  onUploadToVolume?: (volumeName: string) => void;
}

type ConnectionMode = 'docker' | 'ssh';

export function SandboxCard({ sandbox, onUploadToVolume }: SandboxCardProps) {
  const startSandbox = useStartSandbox();
  const stopSandbox = useStopSandbox();
  const deleteSandbox = useDeleteSandbox();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();

  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('docker');
  const [error, setError] = useState<string | null>(null);

  const isRunning = sandbox.status === 'running';
  const isStopped = sandbox.status === 'stopped' || sandbox.status === 'archived';
  const isBuilding = sandbox.status === 'building' || sandbox.status === 'creating';
  const isFailed = sandbox.status === 'error';
  const isPending = startSandbox.isPending || stopSandbox.isPending || deleteSandbox.isPending;

  // Determine if this is a Docker sandbox
  const isDocker = sandbox.backend === 'docker';
  const dockerMeta = sandbox.backendMeta as DockerMeta | undefined;
  const vmMeta = sandbox.backendMeta as VmMeta | undefined;

  // Get volumes based on backend type
  const volumes = isDocker
    ? dockerMeta?.volumes || []
    : vmMeta?.volumes?.map(v => ({ name: v.name, mountPath: v.mountPath })) || [];

  // Commands
  const dockerCommand = sandbox.dockerExecCommand;
  const sshCommand = sandbox.sshCommand;
  const currentCommand = connectionMode === 'docker' ? dockerCommand : sshCommand;

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
      terminalPanel.openContainerTerminal(containerId, sandbox.name, true);
    } else if (sandbox.guestIp) {
      terminalPanel.openTerminal(sandbox.id, sandbox.name, sandbox.guestIp);
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
      <div className="border border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] overflow-hidden">
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
                <h3 className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
                  {sandbox.name}
                </h3>
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
            {(isBuilding || isFailed) ? (
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
                    <button
                      onClick={() => setShowLogs(true)}
                      className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                      title="View Logs"
                    >
                      <ScrollText className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                {isRunning ? (
                  <button
                    onClick={handleStop}
                    disabled={isPending}
                    className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                    title="Stop"
                  >
                    {stopSandbox.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : isStopped && (
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

        {/* Body */}
        <div className="px-3 py-2.5 space-y-3">
          {/* Connection Command */}
          {isRunning && (dockerCommand || sshCommand) && (
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
              </div>
              <div className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[10px] text-[hsl(var(--text-secondary))] truncate">
                    {/* For non-Docker, always show SSH command. For Docker, show based on mode */}
                    {isDocker ? currentCommand : sshCommand}
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
            </div>
          )}

          {/* Ports & Volumes Row */}
          {(sandbox.ports.length > 0 || volumes.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
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

              {/* Volumes */}
              {volumes.length > 0 && (
                <div className="space-y-1.5">
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
                        {onUploadToVolume && (
                          <button
                            onClick={() => onUploadToVolume(vol.name)}
                            className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Upload files to volume"
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
        </div>

        {/* Footer */}
        <div className="px-3 py-2 bg-[hsl(var(--bg-base))] border-t border-[hsl(var(--border))]">
          <p className="text-[10px] text-[hsl(var(--text-muted))]">
            Created {new Date(sandbox.createdAt).toLocaleString()}
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
    </>
  );
}
