/**
 * BackendBadge - Shows the backend type for a sandbox
 */

import { Container, Cloud, Flame, Globe } from 'lucide-react';
import type { SandboxBackend } from '../../api/client';

interface BackendBadgeProps {
  backend: SandboxBackend;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const BACKEND_CONFIG: Record<SandboxBackend, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  bgColor: string;
}> = {
  docker: {
    icon: Container,
    label: 'Docker',
    color: 'text-[hsl(var(--blue))]',
    bgColor: 'bg-[hsl(var(--blue)/0.1)]',
  },
  'cloud-hypervisor': {
    icon: Cloud,
    label: 'Cloud-Hypervisor',
    color: 'text-[hsl(var(--cyan))]',
    bgColor: 'bg-[hsl(var(--cyan)/0.1)]',
  },
  firecracker: {
    icon: Flame,
    label: 'Firecracker',
    color: 'text-[hsl(var(--purple))]',
    bgColor: 'bg-[hsl(var(--purple)/0.1)]',
  },
  daytona: {
    icon: Globe,
    label: 'Daytona',
    color: 'text-[hsl(var(--amber))]',
    bgColor: 'bg-[hsl(var(--amber)/0.1)]',
  },
  aws: {
    icon: Cloud,
    label: 'AWS',
    color: 'text-[hsl(var(--orange))]',
    bgColor: 'bg-[hsl(var(--orange)/0.1)]',
  },
  azure: {
    icon: Cloud,
    label: 'Azure',
    color: 'text-[hsl(var(--blue))]',
    bgColor: 'bg-[hsl(var(--blue)/0.1)]',
  },
  gcp: {
    icon: Cloud,
    label: 'GCP',
    color: 'text-[hsl(var(--green))]',
    bgColor: 'bg-[hsl(var(--green)/0.1)]',
  },
  digitalocean: {
    icon: Cloud,
    label: 'DigitalOcean',
    color: 'text-[hsl(var(--cyan))]',
    bgColor: 'bg-[hsl(var(--cyan)/0.1)]',
  },
  linode: {
    icon: Cloud,
    label: 'Linode',
    color: 'text-[hsl(var(--green))]',
    bgColor: 'bg-[hsl(var(--green)/0.1)]',
  },
};

export function BackendBadge({ backend, size = 'sm', showLabel = false }: BackendBadgeProps) {
  const config = BACKEND_CONFIG[backend];
  const Icon = config.icon;

  const sizeClasses = size === 'sm'
    ? 'h-3 w-3'
    : 'h-4 w-4';

  const paddingClasses = showLabel
    ? 'px-1.5 py-0.5 gap-1'
    : 'p-0.5';

  return (
    <span
      className={`inline-flex items-center ${paddingClasses} ${config.color} ${config.bgColor}`}
      title={config.label}
    >
      <Icon className={sizeClasses} />
      {showLabel && (
        <span className="text-[10px] uppercase tracking-wider">{config.label}</span>
      )}
    </span>
  );
}

/**
 * Get the short name for a backend
 */
export function getBackendShortName(backend: SandboxBackend): string {
  switch (backend) {
    case 'docker':
      return 'Docker';
    case 'cloud-hypervisor':
      return 'CH';
    case 'firecracker':
      return 'FC';
    case 'daytona':
      return 'Daytona';
    case 'aws':
      return 'AWS';
    case 'azure':
      return 'Azure';
    case 'gcp':
      return 'GCP';
    case 'digitalocean':
      return 'DO';
    case 'linode':
      return 'Linode';
  }
}
