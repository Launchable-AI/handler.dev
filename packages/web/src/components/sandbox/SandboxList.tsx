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
  Search,
  Columns3,
  Check,
} from 'lucide-react';
import type { SandboxBackend, SandboxStatus } from '../../api/client';
import { useSandboxes, useSandboxCounts } from '../../hooks/useSandboxes';
import { SandboxCard } from './SandboxCard';
import { SandboxCardCompact } from './SandboxCardCompact';
import { SandboxRow } from './SandboxRow';

interface SandboxListProps {
  onCreateClick: () => void;
  highlightedId?: string | null;
}

type ViewMode = 'compact' | 'detailed' | 'list';

const VIEW_MODE_KEY = 'caisson-sandbox-view-mode';
const BACKEND_FILTER_KEY = 'caisson-sandbox-backend-filter';
const RUNNING_FILTER_KEY = 'caisson-sandbox-running-filter';
const SEARCH_KEY = 'caisson-sandbox-search';
const VISIBLE_COLUMNS_KEY = 'caisson-sandbox-visible-columns';

// Column definitions for list view
type ColumnId = 'status' | 'name' | 'backend' | 'resources' | 'connect' | 'image' | 'ip' | 'created' | 'volumes' | 'actions';

interface ColumnDef {
  id: ColumnId;
  label: string;
  sortable: boolean;
  sortKey?: SortColumn;
  defaultVisible: boolean;
  minWidth?: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'status', label: 'Status', sortable: true, sortKey: 'status', defaultVisible: true, minWidth: '60px' },
  { id: 'name', label: 'Name', sortable: true, sortKey: 'name', defaultVisible: true, minWidth: '120px' },
  { id: 'backend', label: 'Backend', sortable: true, sortKey: 'backend', defaultVisible: true, minWidth: '100px' },
  { id: 'connect', label: 'Connect', sortable: false, defaultVisible: true, minWidth: '180px' },
  { id: 'resources', label: 'Resources', sortable: false, defaultVisible: false, minWidth: '100px' },
  { id: 'image', label: 'Image', sortable: true, sortKey: 'image', defaultVisible: false, minWidth: '150px' },
  { id: 'ip', label: 'IP', sortable: true, sortKey: 'ip', defaultVisible: false, minWidth: '100px' },
  { id: 'created', label: 'Created', sortable: true, sortKey: 'created', defaultVisible: false, minWidth: '90px' },
  { id: 'volumes', label: 'Volumes', sortable: false, defaultVisible: true, minWidth: '80px' },
  { id: 'actions', label: 'Actions', sortable: false, defaultVisible: true, minWidth: '120px' },
];

const BACKEND_OPTIONS: Array<{ value: SandboxBackend; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'docker', label: 'Docker', icon: Container },
  { value: 'cloud-hypervisor', label: 'Cloud-Hypervisor', icon: Cloud },
  { value: 'firecracker', label: 'Firecracker', icon: Flame },
  { value: 'daytona', label: 'Daytona', icon: Globe },
  { value: 'aws', label: 'AWS', icon: Cloud },
  { value: 'azure', label: 'Azure', icon: Cloud },
  { value: 'gcp', label: 'GCP', icon: Cloud },
  { value: 'digitalocean', label: 'DigitalOcean', icon: Cloud },
  { value: 'linode', label: 'Linode', icon: Cloud },
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

const HIGHLIGHT_KEY = 'caisson-highlight-sandbox';

export function SandboxList({ onCreateClick, highlightedId }: SandboxListProps) {
  // Sandbox to highlight (set from other tabs like Volumes, or from quick launch)
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Use prop-based highlighting when provided
  useEffect(() => {
    if (highlightedId) {
      setHighlightId(highlightedId);
    }
  }, [highlightedId]);

  // Check for highlight request on mount and when tab becomes visible
  useEffect(() => {
    const checkHighlight = () => {
      const id = localStorage.getItem(HIGHLIGHT_KEY);
      if (id) {
        setHighlightId(id);
        localStorage.removeItem(HIGHLIGHT_KEY);
        // Clear highlight after animation (2 seconds)
        setTimeout(() => setHighlightId(null), 2000);
      }
    };
    checkHighlight();
    // Also check when window becomes visible (tab switch)
    window.addEventListener('focus', checkHighlight);
    // Listen for navigation events (from other components)
    const handleNavigate = () => {
      // Small delay to ensure localStorage is set
      setTimeout(checkHighlight, 50);
    };
    window.addEventListener('caisson-navigate-tab', handleNavigate);
    return () => {
      window.removeEventListener('focus', checkHighlight);
      window.removeEventListener('caisson-navigate-tab', handleNavigate);
    };
  }, []);

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

  // Status filter with persistence
  const [showOnlyRunning, setShowOnlyRunning] = useState(() => {
    const stored = localStorage.getItem(RUNNING_FILTER_KEY);
    return stored === 'true';
  });

  // Search query with persistence
  const [searchQuery, setSearchQuery] = useState(() => {
    return localStorage.getItem(SEARCH_KEY) || '';
  });

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

  // Column visibility state with persistence
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(() => {
    const stored = localStorage.getItem(VISIBLE_COLUMNS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return new Set(parsed as ColumnId[]);
      } catch {
        // Fall through to default
      }
    }
    return new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.id));
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);

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

  useEffect(() => {
    localStorage.setItem(VISIBLE_COLUMNS_KEY, JSON.stringify([...visibleColumns]));
  }, [visibleColumns]);

  useEffect(() => {
    localStorage.setItem(RUNNING_FILTER_KEY, showOnlyRunning.toString());
  }, [showOnlyRunning]);

  useEffect(() => {
    localStorage.setItem(SEARCH_KEY, searchQuery);
  }, [searchQuery]);

  // Build filter for API
  const filter = useMemo(() => ({
    backends: selectedBackends.length > 0 ? selectedBackends : undefined,
    status: showOnlyRunning ? ['running', 'starting'] as SandboxStatus[] : undefined,
  }), [selectedBackends, showOnlyRunning]);

  // Fetch sandboxes
  const { data, isLoading, error } = useSandboxes(filter);
  const counts = useSandboxCounts();

  const allSandboxes = data?.sandboxes ?? [];
  const backends = data?.backends ?? {
    docker: false,
    'cloud-hypervisor': false,
    firecracker: false,
    daytona: false,
    aws: false,
    azure: false,
    gcp: false,
    digitalocean: false,
    linode: false,
  };

  // Filter sandboxes by search query
  const sandboxes = useMemo(() => {
    if (!searchQuery.trim()) return allSandboxes;
    const query = searchQuery.toLowerCase();
    return allSandboxes.filter((sandbox) =>
      sandbox.name.toLowerCase().includes(query)
    );
  }, [allSandboxes, searchQuery]);

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

  // Toggle column visibility
  const toggleColumn = (columnId: ColumnId) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnId)) {
        // Don't allow hiding all columns - keep at least name and actions
        if (columnId !== 'name' && columnId !== 'actions') {
          next.delete(columnId);
        }
      } else {
        next.add(columnId);
      }
      return next;
    });
  };

  const isColumnVisible = (columnId: ColumnId) => visibleColumns.has(columnId);

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
    setSearchQuery('');
  };

  const hasFilters = selectedBackends.length > 0 || showOnlyRunning || searchQuery.trim().length > 0;

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
        {/* Top row: Create + Search + View modes + Count */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onCreateClick}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3 w-3" />
            New Sandbox
          </button>

          {/* Search */}
          <div className="flex-1 max-w-xs relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[hsl(var(--text-muted))]" />
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan)/0.5)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Buttons */}
            <div className="flex items-center border border-[hsl(var(--border))]">
              {viewModeButton('compact', <LayoutGrid className="h-3.5 w-3.5" />, 'Compact view')}
              {viewModeButton('detailed', <Rows3 className="h-3.5 w-3.5" />, 'Detailed view')}
              {viewModeButton('list', <LayoutList className="h-3.5 w-3.5" />, 'List view')}
            </div>

            {/* Column visibility toggle (only for list view) */}
            {viewMode === 'list' && (
              <div className="relative">
                <button
                  onClick={() => setShowColumnMenu(!showColumnMenu)}
                  className={`p-1.5 transition-colors border border-[hsl(var(--border))] ${
                    showColumnMenu
                      ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
                  }`}
                  title="Toggle columns"
                >
                  <Columns3 className="h-3.5 w-3.5" />
                </button>
                {showColumnMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowColumnMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg z-50 min-w-[160px]">
                      <div className="px-2 py-1.5 text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider border-b border-[hsl(var(--border))]">
                        Show Columns
                      </div>
                      {COLUMNS.map((col) => (
                        <button
                          key={col.id}
                          onClick={() => toggleColumn(col.id)}
                          disabled={col.id === 'name' || col.id === 'actions'}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left transition-colors ${
                            col.id === 'name' || col.id === 'actions'
                              ? 'text-[hsl(var(--text-muted))] cursor-not-allowed'
                              : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))]'
                          }`}
                        >
                          <span className={`w-4 h-4 flex items-center justify-center border ${
                            isColumnVisible(col.id)
                              ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan))] text-white'
                              : 'border-[hsl(var(--border))]'
                          }`}>
                            {isColumnVisible(col.id) && <Check className="h-3 w-3" />}
                          </span>
                          {col.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Count */}
            <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider whitespace-nowrap">
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
                  <SandboxCardCompact key={sandbox.id} sandbox={sandbox} highlight={highlightId === sandbox.id} />
                ))}
              </div>
            )}

            {viewMode === 'detailed' && (
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {sandboxes.map((sandbox) => (
                  <SandboxCard key={sandbox.id} sandbox={sandbox} highlight={highlightId === sandbox.id} />
                ))}
              </div>
            )}

            {viewMode === 'list' && (
              <div className="border border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] overflow-x-auto">
                <table className="w-full text-left min-w-max">
                  <thead>
                    <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
                      {isColumnVisible('status') && (
                        <SortableHeader column="status" className="w-16">Status</SortableHeader>
                      )}
                      {isColumnVisible('name') && (
                        <SortableHeader column="name">Name</SortableHeader>
                      )}
                      {isColumnVisible('backend') && (
                        <SortableHeader column="backend">Backend</SortableHeader>
                      )}
                      {isColumnVisible('connect') && (
                        <th className="px-3 py-2 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
                          Connect
                        </th>
                      )}
                      {isColumnVisible('resources') && (
                        <th className="px-3 py-2 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
                          Resources
                        </th>
                      )}
                      {isColumnVisible('image') && (
                        <SortableHeader column="image">Image</SortableHeader>
                      )}
                      {isColumnVisible('ip') && (
                        <SortableHeader column="ip">IP</SortableHeader>
                      )}
                      {isColumnVisible('created') && (
                        <SortableHeader column="created">Created</SortableHeader>
                      )}
                      {isColumnVisible('volumes') && (
                        <th className="px-3 py-2 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
                          Volumes
                        </th>
                      )}
                      {isColumnVisible('actions') && (
                        <th className="px-3 py-2 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSandboxes.map((sandbox) => (
                      <SandboxRow
                        key={sandbox.id}
                        sandbox={sandbox}
                        highlight={highlightId === sandbox.id}
                        visibleColumns={visibleColumns}
                      />
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
