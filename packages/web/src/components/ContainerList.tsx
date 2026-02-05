import { useState, useEffect } from 'react';
import { useContainers } from '../hooks/useContainers';
import { ContainerCard } from './ContainerCard';
import { ContainerCardCompact } from './ContainerCardCompact';
import { ContainerRow } from './ContainerRow';
import { Loader2, Container, Plus, Eye, EyeOff, LayoutGrid, LayoutList, Rows3 } from 'lucide-react';

interface ContainerListProps {
  onCreateClick: () => void;
}

type ViewMode = 'compact' | 'detailed' | 'list';

const CONTAINER_VIEW_MODE_KEY = 'handler-container-view-mode';

export function ContainerList({ onCreateClick }: ContainerListProps) {
  const { data: containers, isLoading, error } = useContainers();
  const [showOnlyRunning, setShowOnlyRunning] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(CONTAINER_VIEW_MODE_KEY);
    if (stored === 'compact' || stored === 'detailed' || stored === 'list') {
      return stored;
    }
    return 'detailed';
  });

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem(CONTAINER_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  const filteredContainers = containers?.filter(c =>
    showOnlyRunning ? c.state === 'running' : true
  );
  const runningCount = containers?.filter(c => c.state === 'running').length ?? 0;

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
        Failed to load containers: {error.message}
      </div>
    );
  }

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

  if (!containers || containers.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <button
            onClick={onCreateClick}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
            0 containers
          </span>
        </div>
        {/* Empty State */}
        <div className="flex-1 flex items-center justify-center text-[hsl(var(--text-muted))]">
          <div className="text-center">
            <Container className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-xs uppercase tracking-wider">No containers yet</p>
            <p className="text-[10px] mt-1 text-[hsl(var(--text-muted))]">Create one to get started</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <button
          onClick={onCreateClick}
          className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
        <div className="flex items-center gap-3">
          {/* View Mode Buttons */}
          <div className="flex items-center border border-[hsl(var(--border))]">
            {viewModeButton('compact', <LayoutGrid className="h-3.5 w-3.5" />, 'Compact view')}
            {viewModeButton('detailed', <Rows3 className="h-3.5 w-3.5" />, 'Detailed view')}
            {viewModeButton('list', <LayoutList className="h-3.5 w-3.5" />, 'List view')}
          </div>
          <button
            onClick={() => setShowOnlyRunning(!showOnlyRunning)}
            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] transition-colors ${
              showOnlyRunning
                ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]'
                : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]'
            }`}
            title={showOnlyRunning ? 'Show all containers' : 'Show only running containers'}
          >
            {showOnlyRunning ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            Running
          </button>
          <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
            {showOnlyRunning
              ? `${runningCount} running`
              : `${containers.length} containers`}
          </span>
        </div>
      </div>
      {/* Container Grid/List */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'compact' && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredContainers?.map((container) => (
              <ContainerCardCompact key={container.id} container={container} />
            ))}
          </div>
        )}
        {viewMode === 'detailed' && (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredContainers?.map((container) => (
              <ContainerCard key={container.id} container={container} />
            ))}
          </div>
        )}
        {viewMode === 'list' && (
          <div className="border border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
            {/* List header */}
            <div className="grid grid-cols-[1fr_150px_100px_80px_120px] gap-4 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Container</span>
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Image</span>
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Status</span>
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Ports</span>
              <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Actions</span>
            </div>
            {filteredContainers?.map((container) => (
              <ContainerRow key={container.id} container={container} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
