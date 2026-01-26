import { useState } from 'react';
import { Plus, LayoutGrid, Maximize2, ChevronDown, Server, Container } from 'lucide-react';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { useVms, useContainers } from '../../hooks/useContainers';

interface ToolBarProps {
  className?: string;
}

export function ToolBar({ className = '' }: ToolBarProps) {
  const { state, setLayoutMode, restoreLayout } = useCommandCentre();
  const [showPicker, setShowPicker] = useState(false);

  const sessionCount = state.sessions.length;
  const hasMaximized = state.maximizedSessionId !== null;

  return (
    <div className={`flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] ${className}`}>
      {/* Left: Title & session count */}
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-[hsl(var(--text-primary))] uppercase tracking-wider">
          Command Centre
        </h2>
        {sessionCount > 0 && (
          <span className="px-2 py-0.5 text-[10px] font-medium bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] rounded-full">
            {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
          </span>
        )}
      </div>

      {/* Center: Layout mode toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setLayoutMode('grid')}
          className={`p-1.5 transition-colors ${
            state.layoutMode === 'grid' && !hasMaximized
              ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.15)]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
          }`}
          title="Grid layout"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            if (hasMaximized) {
              restoreLayout();
            } else if (state.activeSessionId) {
              setLayoutMode('maximized');
            }
          }}
          disabled={sessionCount === 0}
          className={`p-1.5 transition-colors ${
            hasMaximized
              ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.15)]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50'
          }`}
          title="Maximized layout"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Right: Add session button */}
      <div className="relative">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Session
          <ChevronDown className="h-3 w-3" />
        </button>

        {showPicker && (
          <SessionPicker onClose={() => setShowPicker(false)} />
        )}
      </div>
    </div>
  );
}

interface SessionPickerProps {
  onClose: () => void;
}

function SessionPicker({ onClose }: SessionPickerProps) {
  const { createSession } = useCommandCentre();
  const { data: vms, isLoading: vmsLoading } = useVms();
  const { data: containers, isLoading: containersLoading } = useContainers();

  const runningVMs = vms?.filter(vm => vm.state === 'running') || [];
  const runningContainers = containers?.filter(c => c.state === 'running') || [];

  const handleSelectVm = (vm: { id: string; name: string; guestIp?: string }) => {
    createSession('vm', vm.id, vm.name, vm.guestIp);
    onClose();
  };

  const handleSelectContainer = (container: { id: string; name: string }) => {
    createSession('container', container.id, container.name);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Dropdown */}
      <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg animate-in fade-in slide-in-from-top-2 duration-150 max-h-[400px] overflow-y-auto">
        {/* VMs Section */}
        <div className="p-2 border-b border-[hsl(var(--border))] sticky top-0 bg-[hsl(var(--bg-surface))]">
          <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
            <Server className="h-3 w-3" />
            Virtual Machines
          </div>
        </div>

        <div>
          {vmsLoading ? (
            <div className="px-4 py-3 text-xs text-[hsl(var(--text-muted))]">
              Loading...
            </div>
          ) : runningVMs.length === 0 ? (
            <div className="px-4 py-3 text-xs text-[hsl(var(--text-muted))]">
              No running VMs
            </div>
          ) : (
            runningVMs.map(vm => (
              <button
                key={vm.id}
                onClick={() => handleSelectVm(vm)}
                className="w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                <Server className="h-3.5 w-3.5 text-[hsl(var(--green))]" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[hsl(var(--text-primary))] truncate">
                    {vm.name}
                  </div>
                  {vm.guestIp && (
                    <div className="text-[10px] text-[hsl(var(--text-muted))]">
                      {vm.guestIp}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Containers Section */}
        <div className="p-2 border-t border-[hsl(var(--border))] sticky top-0 bg-[hsl(var(--bg-surface))]">
          <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
            <Container className="h-3 w-3" />
            Containers
          </div>
        </div>

        <div>
          {containersLoading ? (
            <div className="px-4 py-3 text-xs text-[hsl(var(--text-muted))]">
              Loading...
            </div>
          ) : runningContainers.length === 0 ? (
            <div className="px-4 py-3 text-xs text-[hsl(var(--text-muted))]">
              No running containers
            </div>
          ) : (
            runningContainers.map(container => (
              <button
                key={container.id}
                onClick={() => handleSelectContainer(container)}
                className="w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                <Container className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[hsl(var(--text-primary))] truncate">
                    {container.name}
                  </div>
                  <div className="text-[10px] text-[hsl(var(--text-muted))] truncate">
                    {container.image}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
