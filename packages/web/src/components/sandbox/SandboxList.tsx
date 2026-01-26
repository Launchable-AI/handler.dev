/**
 * SandboxList - Unified list view for all compute environments
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Loader2,
  Box,
  LayoutGrid,
  LayoutList,
  Rows3,
  Eye,
  EyeOff,
  Container,
  Cloud,
  Flame,
  Globe,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import type { SandboxBackend, SandboxStatus } from '../../api/client';
import { useSandboxes, useSandboxCounts } from '../../hooks/useSandboxes';
import { SandboxCard } from './SandboxCard';
import { SandboxCardCompact } from './SandboxCardCompact';
import { SandboxRow } from './SandboxRow';

interface SandboxListProps {
  onCreateClick: () => void;
}

type ViewMode = 'compact' | 'detailed' | 'list';

const VIEW_MODE_KEY = 'caisson-sandbox-view-mode';
const BACKEND_FILTER_KEY = 'caisson-sandbox-backend-filter';

const BACKEND_OPTIONS: Array<{ value: SandboxBackend; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'docker', label: 'Docker', icon: Container },
  { value: 'cloud-hypervisor', label: 'Cloud-Hypervisor', icon: Cloud },
  { value: 'firecracker', label: 'Firecracker', icon: Flame },
  { value: 'daytona', label: 'Daytona', icon: Globe },
];

// Sortable columns for list view
type SortColumn = 'status' | 'name' | 'backend' | 'image' | 'ip' | 'created';
type SortDirection = 'asc' | 'desc';

const SORT_KEY = 'caisson-sandbox-sort';

// Status priority for sorting (running first, then by activity level)
const STATUS_PRIORITY: Record<string, number> = {
  running: 0,
  starting: 1,
  stopping: 2,
  building: 3,
  creating: 4,
  paused: 5,
  stopped: 6,
  error: 7,
  archived: 8,
};

export function SandboxList({ onCreateClick }: SandboxListProps) {
  // View mode persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === 'compact' || stored === 'detailed' || stored === 'list') {
      return stored;
    }
    return 'detailed';
  });

  // Backend filter persistence
  const [selectedBackends, setSelectedBackends] = useState<SandboxBackend[]>(() => {
    const stored = localStorage.getItem(BACKEND_FILTER_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    }
    return [];
  });

  // Status filter
  const [showOnlyRunning, setShowOnlyRunning] = useState(false);

  // Sort state with persistence
  const [sortColumn, setSortColumn] = useState<SortColumn>(() => {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return parsed.column || 'name';
      } catch {
        return 'name';
      }
    }
    return 'name';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const stored = localStorage.getItem(SORT_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return parsed.direction || 'asc';
      } catch {
        return 'asc';
      }
    }
    return 'asc';
  });

  // Persist settings
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem(BACKEND_FILTER_KEY, JSON.stringify(selectedBackends));
  }, [selectedBackends]);

  useEffect(() => {
    localStorage.setItem(SORT_KEY, JSON.stringify({ column: sortColumn, direction: sortDirection }));
  }, [sortColumn, sortDirection]);

  // Build filter for API
  const filter = useMemo(() => ({
    backends: selectedBackends.length > 0 ? selectedBackends : undefined,
    status: showOnlyRunning ? ['running', 'starting'] as SandboxStatus[] : undefined,
  }), [selectedBackends, showOnlyRunning]);

  // Fetch sandboxes
  const { data, isLoading, error } = useSandboxes(filter);
  const counts = useSandboxCounts();

  const sandboxes = data?.sandboxes ?? [];
  const backends = data?.backends ?? {
    docker: false,
    'cloud-hypervisor': false,
    firecracker: false,
    daytona: false,
  };

  // Sort sandboxes
  const sortedSandboxes = useMemo(() => {
    const sorted = [...sandboxes];
    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'status':
          comparison = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'backend':
          comparison = a.backend.localeCompare(b.backend);
          break;
        case 'image':
          comparison = a.image.localeCompare(b.image);
          break;
        case 'ip':
          comparison = (a.guestIp || '').localeCompare(b.guestIp || '');
          break;
        case 'created':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [sandboxes, sortColumn, sortDirection]);

  // Toggle sort column
  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sortable header component
  const SortableHeader = ({ column, children, className = '' }: { column: SortColumn; children: React.ReactNode; className?: string }) => (
    <th
      onClick={() => toggleSort(column)}
      className={`px-3 py-2 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider cursor-pointer hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors select-none ${className}`}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortColumn === column ? (
          sortDirection === 'asc' ? (
            <ChevronUp className="h-3 w-3 text-[hsl(var(--cyan))]" />
          ) : (
            <ChevronDown className="h-3 w-3 text-[hsl(var(--cyan))]" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-30" />
        )}
      </div>
    </th>
  );

  // Toggle backend filter
  const toggleBackend = (backend: SandboxBackend) => {
    setSelectedBackends((prev) =>
      prev.includes(backend)
        ? prev.filter((b) => b !== backend)
        : [...prev, backend]
    );
  };

  // Clear all filters
  const clearFilters = () => {
    setSelectedBackends([]);
    setShowOnlyRunning(false);
  };

  const hasFilters = selectedBackends.length > 0 || showOnlyRunning;

  // View mode button helper
  const viewModeButton = (mode: ViewMode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setViewMode(mode)}
      className={`p-1.5 transition-colors ${
        viewMode === mode
          ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
          : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
      }`}
      title={label}
    >
      {icon}
    </button>
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 p-3 border border-[hsl(var(--red)/0.3)] bg-[hsl(var(--red)/0.1)] text-[hsl(var(--red))] text-xs">
        Failed to load sandboxes: {error.message}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        {/* Top row: Create + View modes + Count */}
        <div className="flex items-center justify-between">
          <button
            onClick={onCreateClick}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3 w-3" />
            New Sandbox
          </button>

          <div className="flex items-center gap-3">
            {/* View Mode Buttons */}
            <div className="flex items-center border border-[hsl(var(--border))]">
              {viewModeButton('compact', <LayoutGrid className="h-3.5 w-3.5" />, 'Compact view')}
              {viewModeButton('detailed', <Rows3 className="h-3.5 w-3.5" />, 'Detailed view')}
              {viewModeButton('list', <LayoutList className="h-3.5 w-3.5" />, 'List view')}
            </div>

            {/* Count */}
            <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
              {counts.running}/{counts.total} running
            </span>
          </div>
        </div>

        {/* Bottom row: Filters */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
            Filter:
          </span>

          {/* Running filter */}
          <button
            onClick={() => setShowOnlyRunning(!showOnlyRunning)}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] transition-colors ${
              showOnlyRunning
                ? 'text-[hsl(var(--green))] bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)]'
                : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]'
            }`}
            title={showOnlyRunning ? 'Show all' : 'Show only running'}
          >
            {showOnlyRunning ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            Running
          </button>

          {/* Backend filters - only show if more than one backend available */}
          {BACKEND_OPTIONS.filter(({ value }) => backends[value]).length > 1 && (
            <>
              <span className="text-[hsl(var(--border))]">|</span>
              {BACKEND_OPTIONS.filter(({ value }) => backends[value]).map(({ value, label, icon: Icon }) => {
                const isSelected = selectedBackends.includes(value);

                return (
                  <button
                    key={value}
                    onClick={() => toggleBackend(value)}
                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] transition-colors ${
                      isSelected
                        ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]'
                        : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]'
                    }`}
                    title={label}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                );
              })}
            </>
          )}

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] transition-colors"
              title="Clear filters"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {sandboxes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
            <div className="text-center">
              <Box className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-xs uppercase tracking-wider">No sandboxes</p>
              <p className="text-[10px] mt-1">
                {hasFilters ? 'Try adjusting your filters' : 'Create one to get started'}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4">
            {viewMode === 'compact' && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sandboxes.map((sandbox) => (
                  <SandboxCardCompact key={sandbox.id} sandbox={sandbox} />
                ))}
              </div>
            )}

            {viewMode === 'detailed' && (
              <div className="grid gap-3 lg:grid-cols-2">
                {sandboxes.map((sandbox) => (
                  <SandboxCard key={sandbox.id} sandbox={sandbox} />
                ))}
              </div>
            )}

            {viewMode === 'list' && (
              <div className="border border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
                      <SortableHeader column="status" className="w-10">Status</SortableHeader>
                      <SortableHeader column="name">Name</SortableHeader>
                      <SortableHeader column="backend">Backend</SortableHeader>
                      <th className="px-3 py-2 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
                        Resources
                      </th>
                      <SortableHeader column="image">Image</SortableHeader>
                      <SortableHeader column="ip">IP</SortableHeader>
                      <SortableHeader column="created">Created</SortableHeader>
                      <th className="px-3 py-2 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider w-24">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSandboxes.map((sandbox) => (
                      <SandboxRow key={sandbox.id} sandbox={sandbox} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
