/**
 * SandboxCardCompact - Compact card view for sandbox grid
 */

import { useState } from 'react';
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
} from 'lucide-react';
import type { Sandbox } from '../../api/client';
import { BackendBadge } from './BackendBadge';
import { StatusIndicator, isTransitioning } from './StatusIndicator';
import { useStartSandbox, useStopSandbox, useDeleteSandbox } from '../../hooks/useSandboxes';
import { useConfirm } from '../ConfirmModal';
import { useTerminalPanel } from '../TerminalPanel';

interface SandboxCardCompactProps {
  sandbox: Sandbox;
}

export function SandboxCardCompact({ sandbox }: SandboxCardCompactProps) {
  const startSandbox = useStartSandbox();
  const stopSandbox = useStopSandbox();
  const deleteSandbox = useDeleteSandbox();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();
  const [copied, setCopied] = useState(false);

  const isRunning = sandbox.status === 'running';
  const isStopped = sandbox.status === 'stopped' || sandbox.status === 'archived';
  const isTransition = isTransitioning(sandbox.status);

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

  const copyCommand = async () => {
    const command = sandbox.sshCommand;
    if (!command) return;

    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="p-3 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))] transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIndicator status={sandbox.status} size="sm" />
          <span className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">
            {sandbox.name}
          </span>
        </div>
        <BackendBadge backend={sandbox.backend} size="sm" />
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

      {/* SSH Command (if running) */}
      {isRunning && sandbox.sshCommand && (
        <div className="flex items-center gap-1 mb-2 p-1.5 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
          <code className="flex-1 text-[9px] text-[hsl(var(--text-muted))] font-mono truncate">
            {sandbox.sshCommand}
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

      {/* Actions */}
      <div className="flex items-center gap-1">
        {canOpenTerminal && (
          <button
            onClick={handleOpenTerminal}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] transition-colors"
            title="Terminal"
          >
            <Terminal className="h-3 w-3" />
          </button>
        )}
        {canStart && (
          <button
            onClick={handleStart}
            disabled={startSandbox.isPending}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] transition-colors disabled:opacity-50"
            title="Start"
          >
            <Play className="h-3 w-3" />
          </button>
        )}
        {canStop && (
          <button
            onClick={handleStop}
            disabled={stopSandbox.isPending}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] transition-colors disabled:opacity-50"
            title="Stop"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={deleteSandbox.isPending}
            className="flex items-center justify-center py-1 px-2 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--border))] transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
