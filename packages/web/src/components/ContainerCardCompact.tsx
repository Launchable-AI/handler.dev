import { useState, useEffect } from 'react';
import {
  Play,
  Square,
  Trash2,
  Copy,
  Check,
  Circle,
  TerminalSquare,
  Loader2,
  AlertCircle,
  X,
  ScrollText,
} from 'lucide-react';
import type { ContainerInfo } from '../api/client';
import {
  useStartContainer,
  useStopContainer,
  useRemoveContainer,
} from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import { LogViewer } from './LogViewer';
import { useTerminalPanel } from './TerminalPanel';

interface ContainerCardCompactProps {
  container: ContainerInfo;
}

export function ContainerCardCompact({ container }: ContainerCardCompactProps) {
  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showBuildLogs, setShowBuildLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startMutation = useStartContainer();
  const stopMutation = useStopContainer();
  const removeMutation = useRemoveContainer();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();

  // Track mutation errors
  useEffect(() => {
    if (startMutation.error) {
      setError(startMutation.error.message || 'Failed to start container');
    } else if (stopMutation.error) {
      setError(stopMutation.error.message || 'Failed to stop container');
    } else if (removeMutation.error) {
      setError(removeMutation.error.message || 'Failed to remove container');
    }
  }, [startMutation.error, stopMutation.error, removeMutation.error]);

  const isRunning = container.state === 'running';
  const isBuilding = container.state === 'building';
  const isFailed = container.state === 'failed';
  const isPending =
    startMutation.isPending || stopMutation.isPending || removeMutation.isPending;

  const dockerCommand = `docker exec -it ${container.name} /bin/bash`;

  const handleCopyCommand = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(dockerCommand);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = dockerCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
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

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Container',
      message: `Are you sure you want to delete "${container.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (confirmed) {
      removeMutation.mutate(container.id);
    }
  };

  const stateConfig: Record<string, { color: string; label: string }> = {
    running: { color: 'green', label: 'Running' },
    exited: { color: 'red', label: 'Exited' },
    created: { color: 'amber', label: 'Created' },
    paused: { color: 'amber', label: 'Paused' },
    stopped: { color: 'text-muted', label: 'Stopped' },
    building: { color: 'cyan', label: 'Building' },
    failed: { color: 'red', label: 'Failed' },
  };

  const currentState = stateConfig[container.state] || stateConfig.stopped;
  const stateColorVar = currentState.color === 'text-muted' ? 'text-muted' : currentState.color;

  return (
    <>
      <div className="border border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] p-2.5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Circle className={`h-2 w-2 fill-current flex-shrink-0 ${
              stateColorVar === 'text-muted'
                ? 'text-[hsl(var(--text-muted))]'
                : `text-[hsl(var(--${stateColorVar}))]`
            } ${container.state === 'building' ? 'animate-pulse' : ''}`} />
            <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
              {container.name}
            </span>
          </div>
          <span className={`text-[10px] uppercase tracking-wider flex-shrink-0 ${
            stateColorVar === 'text-muted'
              ? 'text-[hsl(var(--text-muted))]'
              : `text-[hsl(var(--${stateColorVar}))]`
          }`}>
            {currentState.label}
          </span>
        </div>

        {/* Image */}
        <p className="text-[10px] text-[hsl(var(--text-muted))] truncate mb-2">
          {container.image}
        </p>

        {/* Error Message */}
        {error && (
          <div className="mb-2 p-1.5 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] flex items-start gap-1.5">
            <AlertCircle className="h-3 w-3 text-[hsl(var(--red))] flex-shrink-0 mt-0.5" />
            <p className="flex-1 min-w-0 text-[9px] text-[hsl(var(--red))] break-words">{error}</p>
            <button
              onClick={() => setError(null)}
              className="p-0.5 text-[hsl(var(--red))] hover:text-[hsl(var(--red)/0.7)] transition-colors flex-shrink-0"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1">
          {(isBuilding || isFailed) ? (
            <>
              <button
                onClick={() => setShowBuildLogs(true)}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                title="View Build Logs"
              >
                <ScrollText className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                title="Remove"
              >
                {removeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          ) : (
            <>
              {isRunning && (
                <>
                  <button
                    onClick={() => terminalPanel.openContainerTerminal(container.id, container.name, true)}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                    title="Open Terminal"
                  >
                    <TerminalSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setShowLogs(true)}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                    title="View Logs"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleCopyCommand}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                    title="Copy docker exec command"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-[hsl(var(--green))]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </>
              )}
              <div className="flex-1" />
              {isRunning ? (
                <button
                  onClick={() => {
                    setError(null);
                    stopMutation.mutate(container.id);
                  }}
                  disabled={isPending}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Stop"
                >
                  {stopMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <button
                  onClick={() => {
                    setError(null);
                    startMutation.mutate(container.id);
                  }}
                  disabled={isPending}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Start"
                >
                  {startMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                title="Remove"
              >
                {removeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Log Viewer */}
      {showLogs && (
        <LogViewer
          containerId={container.id}
          title={container.name}
          onClose={() => setShowLogs(false)}
        />
      )}

      {/* Build Log Viewer */}
      {showBuildLogs && (
        <LogViewer
          buildId={container.id}
          title={container.name}
          onClose={() => setShowBuildLogs(false)}
        />
      )}
    </>
  );
}
