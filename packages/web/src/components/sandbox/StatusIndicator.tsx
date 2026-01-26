/**
 * StatusIndicator - Unified status display for sandboxes
 */

import { Loader2 } from 'lucide-react';
import type { SandboxStatus } from '../../api/client';

interface StatusIndicatorProps {
  status: SandboxStatus;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

interface StatusConfig {
  color: string;
  bgColor: string;
  label: string;
  animate: boolean;
}

const STATUS_CONFIG: Record<SandboxStatus, StatusConfig> = {
  creating: {
    color: 'text-[hsl(var(--amber))]',
    bgColor: 'bg-[hsl(var(--amber))]',
    label: 'Creating',
    animate: true,
  },
  starting: {
    color: 'text-[hsl(var(--amber))]',
    bgColor: 'bg-[hsl(var(--amber))]',
    label: 'Starting',
    animate: true,
  },
  running: {
    color: 'text-[hsl(var(--green))]',
    bgColor: 'bg-[hsl(var(--green))]',
    label: 'Running',
    animate: false,
  },
  stopping: {
    color: 'text-[hsl(var(--amber))]',
    bgColor: 'bg-[hsl(var(--amber))]',
    label: 'Stopping',
    animate: true,
  },
  stopped: {
    color: 'text-[hsl(var(--text-muted))]',
    bgColor: 'bg-[hsl(var(--text-muted))]',
    label: 'Stopped',
    animate: false,
  },
  paused: {
    color: 'text-[hsl(var(--amber))]',
    bgColor: 'bg-[hsl(var(--amber))]',
    label: 'Paused',
    animate: false,
  },
  error: {
    color: 'text-[hsl(var(--red))]',
    bgColor: 'bg-[hsl(var(--red))]',
    label: 'Error',
    animate: false,
  },
  archived: {
    color: 'text-[hsl(var(--text-muted))]',
    bgColor: 'bg-[hsl(var(--text-muted))]',
    label: 'Archived',
    animate: false,
  },
  building: {
    color: 'text-[hsl(var(--cyan))]',
    bgColor: 'bg-[hsl(var(--cyan))]',
    label: 'Building',
    animate: true,
  },
};

export function StatusIndicator({ status, size = 'sm', showLabel = false }: StatusIndicatorProps) {
  const config = STATUS_CONFIG[status];

  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  const spinnerSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <span className={`inline-flex items-center gap-1.5 ${config.color}`}>
      {config.animate ? (
        <Loader2 className={`${spinnerSize} animate-spin`} />
      ) : (
        <span className={`${dotSize} rounded-full ${config.bgColor}`} />
      )}
      {showLabel && (
        <span className="text-[10px] uppercase tracking-wider">{config.label}</span>
      )}
    </span>
  );
}

/**
 * Get just the status color class
 */
export function getStatusColor(status: SandboxStatus): string {
  return STATUS_CONFIG[status].color;
}

/**
 * Check if status indicates the sandbox is active
 */
export function isActiveStatus(status: SandboxStatus): boolean {
  return status === 'running' || status === 'starting' || status === 'creating';
}

/**
 * Check if status indicates the sandbox is transitioning
 */
export function isTransitioning(status: SandboxStatus): boolean {
  return status === 'creating' || status === 'starting' || status === 'stopping' || status === 'building';
}
