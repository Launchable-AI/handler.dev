import { useState } from 'react';
import {
  Plus,
  LayoutGrid,
  Rows3,
  Columns3,
  PanelRight,
  ChevronDown,
  Server,
  Container,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { useVms, useContainers } from '../../hooks/useContainers';

interface ToolBarProps {
  className?: string;
}

export function ToolBar({ className = '' }: ToolBarProps) {
  const {
    state,
    setLayoutMode,
    setSplitLayout,
    increaseFontSize,
    decreaseFontSize,
  } = useCommandCentre();
  const [showPicker, setShowPicker] = useState(false);

  const sessionCount = state.sessions.length;
  const { fontSize, layoutMode, splitLayout, focusedSessionIds } = state;
  const unfocusedCount = sessionCount - focusedSessionIds.length;

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
            {layoutMode === 'focus' && unfocusedCount > 0 && (
              <span className="ml-1 text-[hsl(var(--text-muted))]">
                ({unfocusedCount} in sidebar)
              </span>
            )}
          </span>
        )}
      </div>

      {/* Center: Layout controls & font size */}
      <div className="flex items-center gap-3">
        {/* Split layout buttons */}
        <div className="flex items-center gap-0.5 bg-[hsl(var(--bg-elevated))] p-0.5 rounded">
          <LayoutButton
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            active={splitLayout === 'grid'}
            onClick={() => setSplitLayout('grid')}
            title="Grid layout"
          />
          <LayoutButton
            icon={<Columns3 className="h-3.5 w-3.5" />}
            active={splitLayout === 'horizontal'}
            onClick={() => setSplitLayout('horizontal')}
            title="Horizontal split"
          />
          <LayoutButton
            icon={<Rows3 className="h-3.5 w-3.5" />}
            active={splitLayout === 'vertical'}
            onClick={() => setSplitLayout('vertical')}
            title="Vertical split"
          />
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-[hsl(var(--border))]" />

        {/* Focus mode toggle */}
        <button
          onClick={() => setLayoutMode(layoutMode === 'split' ? 'focus' : 'split')}
          disabled={sessionCount < 2}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs transition-colors rounded ${
            layoutMode === 'focus'
              ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
          } disabled:opacity-50`}
          title={layoutMode === 'focus' ? 'Show all in main view' : 'Enable focus mode with sidebar'}
        >
          <PanelRight className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Focus</span>
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-[hsl(var(--border))]" />

        {/* Font size controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={decreaseFontSize}
            disabled={fontSize <= 8}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors disabled:opacity-50 rounded"
            title="Decrease font size"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-[hsl(var(--text-secondary))] min-w-[28px] text-center font-mono">
            {fontSize}px
          </span>
          <button
            onClick={increaseFontSize}
            disabled={fontSize >= 24}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors disabled:opacity-50 rounded"
            title="Increase font size"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
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

// Layout button component
interface LayoutButtonProps {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}

function LayoutButton({ icon, active, onClick, title }: LayoutButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-[hsl(var(--cyan)/0.2)] text-[hsl(var(--cyan))]'
          : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))]'
      }`}
      title={title}
    >
      {icon}
    </button>
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
