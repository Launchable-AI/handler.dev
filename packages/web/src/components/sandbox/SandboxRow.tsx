/**
 * SandboxRow - Table row view for sandbox list
 */

import { useState } from 'react';
import {
  Play,
  Square,
  Trash2,
  Terminal,
  Cpu,
  MemoryStick,
  Camera,
  Loader2,
} from 'lucide-react';
import type { Sandbox, VmMeta } from '../../api/client';
import * as api from '../../api/client';
import { BackendBadge } from './BackendBadge';
import { StatusIndicator, isTransitioning } from './StatusIndicator';
import { useStartSandbox, useStopSandbox, useDeleteSandbox } from '../../hooks/useSandboxes';
import { useConfirm } from '../ConfirmModal';
import { useTerminalPanel } from '../TerminalPanel';

interface SandboxRowProps {
  sandbox: Sandbox;
}

export function SandboxRow({ sandbox }: SandboxRowProps) {
  const startSandbox = useStartSandbox();
  const stopSandbox = useStopSandbox();
  const deleteSandbox = useDeleteSandbox();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();

  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);

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
    // Extract the VM ID from the sandbox ID (e.g., 'fc-xxx' -> 'xxx')
    const vmId = sandbox.id.replace(/^(fc-|vm-)/, '');

    setIsCreatingSnapshot(true);
    try {
      await api.createVmSnapshot(vmId, `${sandbox.name}-${Date.now()}`);
    } catch (error) {
      console.error('Failed to create snapshot:', error);
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  return (
    <tr className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-elevated))] transition-colors">
      {/* Status */}
      <td className="px-3 py-2">
        <StatusIndicator status={sandbox.status} size="sm" />
      </td>

      {/* Name */}
      <td className="px-3 py-2">
        <span className="text-sm text-[hsl(var(--text-primary))]">{sandbox.name}</span>
      </td>

      {/* Backend */}
      <td className="px-3 py-2">
        <BackendBadge backend={sandbox.backend} size="sm" showLabel />
      </td>

      {/* Resources */}
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

      {/* Image */}
      <td className="px-3 py-2 max-w-[200px]">
        <span className="text-[11px] text-[hsl(var(--text-muted))] truncate block" title={sandbox.image}>
          {sandbox.image}
        </span>
      </td>

      {/* IP */}
      <td className="px-3 py-2">
        <span className="text-[10px] text-[hsl(var(--text-muted))] font-mono">
          {sandbox.guestIp || '-'}
        </span>
      </td>

      {/* Created */}
      <td className="px-3 py-2">
        <span className="text-[10px] text-[hsl(var(--text-muted))]">
          {new Date(sandbox.createdAt).toLocaleDateString()}
        </span>
      </td>

      {/* Actions */}
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
    </tr>
  );
}
