import { useState, useEffect } from 'react';
import {
  Plus,
  LayoutGrid,
  Rows3,
  Columns3,
  ChevronDown,
  ChevronUp,
  Server,
  Container,
  ZoomIn,
  ZoomOut,
  Loader2,
  PlayCircle,
  Maximize2,
  Minimize2,
  HardDrive,
  Activity,
  Network,
  FolderOpen,
  Pencil,
  Trash2,
  Check,
} from 'lucide-react';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { useSandboxes } from '../../hooks/useSandboxes';
import { useVolumes, useVmVolumes } from '../../hooks/useContainers';
import { useCanvas } from '../../context/CanvasContext';
import type { Sandbox } from '../../api/client';

interface ToolBarProps {
  className?: string;
}

export function ToolBar({ className = '' }: ToolBarProps) {
  const {
    state,
    setSplitLayout,
    increaseFontSize,
    decreaseFontSize,
    createSession,
    toggleFullscreen,
    maximizeSession,
    setViewMode,
  } = useCommandCentre();
  const [showPicker, setShowPicker] = useState(false);
  const [isOpeningAll, setIsOpeningAll] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const { data: sandboxData } = useSandboxes();
  const { data: dockerVolumes } = useVolumes();
  const { data: vmVolumes } = useVmVolumes();

  const sandboxes = sandboxData?.sandboxes || [];

  const sessionCount = state.sessions.length;
  const { fontSize, splitLayout, focusedSessionIds, isFullscreen, maximizedSessionId, viewMode } = state;
  const unfocusedCount = sessionCount - focusedSessionIds.length;

  // Keyboard shortcut for fullscreen (Escape to exit, Ctrl+Shift+F to toggle)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape exits fullscreen or maximized
      if (e.key === 'Escape') {
        if (maximizedSessionId) {
          maximizeSession(null);
        } else if (isFullscreen) {
          toggleFullscreen();
        }
      }
      // Ctrl+Shift+F toggles fullscreen
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, maximizedSessionId, toggleFullscreen, maximizeSession]);

  // Classify sandboxes by type
  const isVmBackend = (s: Sandbox) => s.backend === 'firecracker';
  const isContainerBackend = (s: Sandbox) => s.backend === 'docker';

  const allVMs = sandboxes.filter(isVmBackend);
  const allContainers = sandboxes.filter(isContainerBackend);
  const runningVMs = allVMs.filter(s => s.status === 'running');
  const runningContainers = allContainers.filter(s => s.status === 'running');
  const runningSandboxes = sandboxes.filter(s => s.status === 'running');
  const totalRunning = runningSandboxes.length;

  // Resource stats
  const totalVMs = allVMs.length;
  const totalContainers = allContainers.length;
  const totalDockerVolumes = dockerVolumes?.length || 0;
  const totalVmVolumes = vmVolumes?.length || 0;

  // Open all running instances
  const handleOpenAllRunning = async () => {
    setIsOpeningAll(true);

    // Small delay between creating sessions for smoother UI
    for (const sandbox of runningSandboxes) {
      const sessionType = isVmBackend(sandbox) ? 'vm' : 'container';
      createSession(sessionType, sandbox.id, sandbox.name, sandbox.guestIp);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setIsOpeningAll(false);
  };

  return (
    <div className={className}>
      {/* Main toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        {/* Left: Session count */}
      <div className="flex items-center gap-3">
        <span className="px-2 py-0.5 text-[10px] font-medium bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] rounded-full">
          {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
          {unfocusedCount > 0 && (
            <span className="ml-1 text-[hsl(var(--text-muted))]">
              ({unfocusedCount} in sidebar)
            </span>
          )}
        </span>
      </div>

      {/* Center: View-specific controls */}
      <div className="flex items-center gap-3">
        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 bg-[hsl(var(--bg-elevated))] p-0.5 rounded">
          <LayoutButton
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            active={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
            title="Terminal grid view"
          />
          <LayoutButton
            icon={<Network className="h-3.5 w-3.5" />}
            active={viewMode === 'canvas'}
            onClick={() => setViewMode('canvas')}
            title="Canvas node view"
          />
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-[hsl(var(--border))]" />

        {viewMode === 'grid' ? (
          <>
            {/* Grid-specific: Split layout buttons */}
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

            {/* Grid-specific: Font size controls */}
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
          </>
        ) : (
          <>
            {/* Canvas-specific: Workspace switcher */}
            <WorkspaceSwitcher />

            {/* Separator */}
            <div className="w-px h-5 bg-[hsl(var(--border))]" />

            {/* Slot for canvas controls (portaled from CanvasViewInner) */}
            <div id="canvas-toolbar-slot" className="flex items-center gap-2" />
          </>
        )}

        {/* Separator */}
        <div className="w-px h-5 bg-[hsl(var(--border))]" />

        {/* Fullscreen toggle (shared) */}
        <button
          onClick={toggleFullscreen}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs transition-colors rounded ${
            isFullscreen
              ? 'bg-[hsl(var(--purple)/0.15)] text-[hsl(var(--purple))]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
          }`}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (Ctrl+Shift+F)'}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Right: Quick actions */}
      {viewMode === 'canvas' ? (
        <div id="canvas-toolbar-right-slot" className="flex items-center gap-2" />
      ) : (<div className="flex items-center gap-2">
        {/* Open All Running button */}
        <button
          onClick={handleOpenAllRunning}
          disabled={totalRunning === 0 || isOpeningAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] transition-colors disabled:opacity-50"
          title={`Open terminals to all ${totalRunning} running instances`}
        >
          {isOpeningAll ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlayCircle className="h-3.5 w-3.5" />
          )}
          {isOpeningAll ? 'Opening...' : `Open All (${totalRunning})`}
        </button>

        {/* Add Session button */}
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
      </div>)}
      </div>

      {/* Collapsible Resource Overview (hidden in fullscreen) */}
      {!isFullscreen && (
      <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
        <button
          onClick={() => setShowResources(!showResources)}
          className="w-full flex items-center justify-between px-4 py-1.5 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))] transition-colors"
        >
          <div className="flex items-center gap-2">
            <Activity className="h-3 w-3" />
            <span className="uppercase tracking-wider font-medium">Resources</span>
            <span className="text-[hsl(var(--text-muted))]">
              {runningVMs.length}/{totalVMs} VMs • {runningContainers.length}/{totalContainers} Containers
            </span>
          </div>
          {showResources ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        {showResources && (
          <div className="px-4 pb-2 pt-1 grid grid-cols-4 gap-4 text-[10px]">
            {/* VMs */}
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-[hsl(var(--cyan))]" />
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))]">
                  {totalVMs} VMs
                </div>
                <div className="text-[hsl(var(--green))]">
                  {runningVMs.length} running
                </div>
              </div>
            </div>

            {/* Containers */}
            <div className="flex items-center gap-2">
              <Container className="h-4 w-4 text-[hsl(var(--purple))]" />
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))]">
                  {totalContainers} Containers
                </div>
                <div className="text-[hsl(var(--green))]">
                  {runningContainers.length} running
                </div>
              </div>
            </div>

            {/* VM Volumes */}
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[hsl(var(--amber))]" />
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))]">
                  {totalVmVolumes} VM Volumes
                </div>
                <div className="text-[hsl(var(--text-muted))]">
                  Attached storage
                </div>
              </div>
            </div>

            {/* Docker Volumes */}
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[hsl(var(--text-muted))]" />
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))]">
                  {totalDockerVolumes} Docker Volumes
                </div>
                <div className="text-[hsl(var(--text-muted))]">
                  Container storage
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      )}
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

function WorkspaceSwitcher() {
  const {
    state: canvasState,
    activeWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setActiveWorkspace,
  } = useCanvas();
  const [showDropdown, setShowDropdown] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = () => {
    if (!newName.trim()) return;
    createWorkspace(newName.trim());
    setNewName('');
    setShowNewInput(false);
  };

  const handleRename = (id: string) => {
    if (!renameValue.trim()) return;
    renameWorkspace(id, renameValue.trim());
    setRenamingId(null);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] rounded transition-colors"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="max-w-[100px] truncate">{activeWorkspace?.name || 'Default'}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setShowDropdown(false); setRenamingId(null); setShowNewInput(false); }} />
          <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg rounded overflow-hidden">
            {canvasState.workspaces.map(ws => (
              <div
                key={ws.id}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--bg-elevated))] transition-colors ${
                  ws.id === canvasState.activeWorkspaceId ? 'bg-[hsl(var(--bg-elevated))]' : ''
                }`}
              >
                {renamingId === ws.id ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRename(ws.id)}
                      className="flex-1 px-1.5 py-0.5 text-[10px] bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan))]"
                      autoFocus
                    />
                    <button onClick={() => handleRename(ws.id)} className="p-0.5 text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-overlay))] rounded">
                      <Check className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setActiveWorkspace(ws.id); setShowDropdown(false); }}
                      className="flex-1 text-left text-[hsl(var(--text-primary))] truncate"
                    >
                      {ws.name}
                      <span className="ml-1 text-[hsl(var(--text-muted))]">({ws.nodeIds.length})</span>
                    </button>
                    <button
                      onClick={() => { setRenamingId(ws.id); setRenameValue(ws.name); }}
                      className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] rounded"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {ws.id !== 'default' && (
                      <button
                        onClick={() => deleteWorkspace(ws.id)}
                        className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] rounded"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}

            <div className="border-t border-[hsl(var(--border))]">
              {showNewInput ? (
                <div className="flex items-center gap-1 px-3 py-1.5">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    placeholder="Workspace name"
                    className="flex-1 px-1.5 py-0.5 text-[10px] bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
                    autoFocus
                  />
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="px-2 py-0.5 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] rounded disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewInput(true)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  New Workspace
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface SessionPickerProps {
  onClose: () => void;
}

function SessionPicker({ onClose }: SessionPickerProps) {
  const { createSession } = useCommandCentre();
  const { data: sandboxData, isLoading } = useSandboxes();

  const sandboxes = sandboxData?.sandboxes || [];
  const isVmBackend = (s: Sandbox) => s.backend === 'firecracker';
  const runningVMs = sandboxes.filter(s => isVmBackend(s) && s.status === 'running');
  const runningContainers = sandboxes.filter(s => s.backend === 'docker' && s.status === 'running');

  const handleSelect = (sandbox: Sandbox) => {
    const sessionType = isVmBackend(sandbox) ? 'vm' : 'container';
    createSession(sessionType, sandbox.id, sandbox.name, sandbox.guestIp);
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
          {isLoading ? (
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
                onClick={() => handleSelect(vm)}
                className="w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                <Server className="h-3.5 w-3.5 text-[hsl(var(--green))]" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[hsl(var(--text-primary))] truncate">
                    {vm.name}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {vm.guestIp && (
                      <span className="text-[10px] text-[hsl(var(--text-muted))]">
                        {vm.guestIp}
                      </span>
                    )}
                    <span className="text-[9px] text-[hsl(var(--text-muted))] opacity-60">
                      {vm.backend === 'firecracker' ? 'FC' : 'CH'}
                    </span>
                  </div>
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
          {isLoading ? (
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
                onClick={() => handleSelect(container)}
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
