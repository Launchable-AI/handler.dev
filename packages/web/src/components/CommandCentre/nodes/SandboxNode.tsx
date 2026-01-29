import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
import { GitBranch, GitMerge, Trash2, Loader2, AlertCircle, ExternalLink, GitFork, X, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { WorktreeNode } from '../../../types/command-centre';
import { useCanvas } from '../../../context/CanvasContext';
import { TerminalInstance } from '../../Terminal/TerminalInstance';
import type { ConnectionState, ShellState } from '../../Terminal/TerminalInstance';
import * as worktreeApi from '../../../api/worktrees';

const statusColors: Record<WorktreeNode['status'], string> = {
  creating: 'hsl(var(--amber))',
  ready: 'hsl(var(--green))',
  merging: 'hsl(var(--purple))',
  merged: 'hsl(var(--cyan))',
  error: 'hsl(var(--red))',
};

const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

function SandboxNodeComponent({ data, selected, dragging }: NodeProps<WorktreeNode>) {
  const { addNode, removeNode, updateNode, updateSize } = useCanvas();
  const [showForkInput, setShowForkInput] = useState(false);
  const [forkBranch, setForkBranch] = useState('');
  const [isForking, setIsForking] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [termReady, setTermReady] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [isFocused, setIsFocused] = useState(false);
  const [currentCwd, setCurrentCwd] = useState<string>('/home/dev/workspace');
  const termContainerRef = useRef<HTMLDivElement>(null);

  // Wait for the terminal container to have non-zero dimensions before mounting xterm
  useEffect(() => {
    const el = termContainerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setTermReady(true);
          observer.disconnect();
          return;
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isRoot = data.parentNodeId === null;
  const statusColor = statusColors[data.status];

  const handleTerminalStateChange = useCallback((state: ConnectionState) => {
    setConnState(state);
  }, []);

  // Real-time shell state tracking via OSC 7337
  const handleShellState = useCallback((state: ShellState) => {
    setCurrentCwd(state.cwd);
    if (state.branch && state.branch !== data.branch) {
      updateNode(data.id, { branch: state.branch });
    }
  }, [data.id, data.branch, updateNode]);

  const handleFork = async () => {
    if (!forkBranch.trim()) return;
    setIsForking(true);
    try {
      const result = await worktreeApi.forkWorktree({
        sandboxId: data.sandboxId,
        branchName: forkBranch.trim(),
        baseBranch: data.branch,
        cwd: currentCwd,
      });

      addNode({
        id: result.id,
        sandboxId: result.sandboxId,
        branch: forkBranch.trim(),
        worktreePath: result.worktreePath,
        parentNodeId: data.id,
        status: 'ready',
        ports: result.ports,
        position: { x: data.position.x + 550, y: data.position.y + 50 },
        size: { width: 500, height: 350 },
      });

      setShowForkInput(false);
      setForkBranch('');
    } catch (err) {
      console.error('Failed to fork worktree:', err);
    } finally {
      setIsForking(false);
    }
  };

  const handleMerge = async () => {
    if (isRoot) return;
    setIsMerging(true);
    updateNode(data.id, { status: 'merging' });
    try {
      await worktreeApi.mergeWorktree({
        sandboxId: data.sandboxId,
        worktreeId: data.id,
      });
      updateNode(data.id, { status: 'merged' });
    } catch (err) {
      console.error('Failed to merge worktree:', err);
      updateNode(data.id, { status: 'error' });
    } finally {
      setIsMerging(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await worktreeApi.deleteWorktree(data.id);
      removeNode(data.id);
    } catch (err) {
      console.error('Failed to delete worktree:', err);
      setIsDeleting(false);
    }
  };

  const handleResize = useCallback((_event: unknown, params: { width: number; height: number }) => {
    updateSize(data.id, { width: params.width, height: params.height });
  }, [data.id, updateSize]);

  // Escape key exits focus mode
  useEffect(() => {
    if (!isFocused) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFocused(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFocused]);

  // Focus mode overlay rendered via portal so it escapes ReactFlow transforms
  const focusOverlay = isFocused
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col bg-[hsl(var(--bg-base))]">
          {/* Focused title bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shrink-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: statusColor }}
            />
            <GitBranch className="h-3 w-3 text-[hsl(var(--cyan))] shrink-0" />
            <span className="text-[11px] font-medium text-[hsl(var(--text-primary))] truncate flex-1">
              {data.branch}
            </span>

            <span className={`px-1.5 py-0.5 text-[9px] rounded shrink-0 ${
              connState === 'connected'
                ? 'bg-[hsl(var(--green)/0.15)] text-[hsl(var(--green))]'
                : connState === 'connecting'
                ? 'bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))]'
                : 'bg-[hsl(var(--red)/0.15)] text-[hsl(var(--red))]'
            }`}>
              {connState}
            </span>

            {/* Font size controls */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => setFontSize(s => Math.max(MIN_FONT_SIZE, s - 1))}
                disabled={fontSize <= MIN_FONT_SIZE}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors disabled:opacity-50"
                title="Decrease font size"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <span className="text-[9px] text-[hsl(var(--text-muted))] min-w-[24px] text-center font-mono">
                {fontSize}px
              </span>
              <button
                onClick={() => setFontSize(s => Math.min(MAX_FONT_SIZE, s + 1))}
                disabled={fontSize >= MAX_FONT_SIZE}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors disabled:opacity-50"
                title="Increase font size"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
            </div>

            <button
              onClick={() => setIsFocused(false)}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors"
              title="Exit focus mode (Esc)"
            >
              <Minimize2 className="h-3 w-3" />
            </button>
          </div>

          {/* Full-screen terminal */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TerminalInstance
              target={{ type: 'container', id: data.sandboxId }}
              onStateChange={handleTerminalStateChange}
              onShellState={handleShellState}
              showStatusBar={false}
              fontSize={fontSize}
              className="h-full"
            />
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
    {focusOverlay}
    <div
      className={`relative flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg shadow-lg overflow-hidden w-full h-full transition-opacity duration-75 ${dragging ? 'opacity-70' : ''}`}
      style={{ willChange: 'transform' }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={300}
        minHeight={200}
        onResize={handleResize}
        lineClassName="!border-[hsl(var(--cyan)/0.5)]"
        handleClassName="!w-2.5 !h-2.5 !bg-[hsl(var(--cyan))] !border-[hsl(var(--bg-surface))]"
      />

      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-[hsl(var(--cyan))] !border-2 !border-[hsl(var(--bg-surface))]"
      />

      {/* Target handle (top) */}
      {!isRoot && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-[hsl(var(--purple))] !border-2 !border-[hsl(var(--bg-surface))]"
        />
      )}

      {/* Title bar - drag handle */}
      <div className="terminal-node-drag-handle flex items-center gap-2 px-3 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] cursor-grab active:cursor-grabbing shrink-0 select-none">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: statusColor }}
          title={data.status}
        />
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-git-panel', { detail: { nodeId: data.id, sandboxId: data.sandboxId, cwd: currentCwd } }))}
          className="flex items-center gap-1 min-w-0 hover:text-[hsl(var(--cyan))] transition-colors"
          title="View git history"
        >
          <GitBranch className="h-3 w-3 text-[hsl(var(--cyan))] shrink-0" />
          <span className="text-[11px] font-medium text-[hsl(var(--text-primary))] truncate">
            {data.branch}
          </span>
        </button>
        <div className="flex-1" />

        {isRoot && (
          <span className="px-1.5 py-0.5 text-[9px] font-medium bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] rounded shrink-0">
            MAIN
          </span>
        )}

        {/* Connection state indicator */}
        <span className={`px-1.5 py-0.5 text-[9px] rounded shrink-0 ${
          connState === 'connected'
            ? 'bg-[hsl(var(--green)/0.15)] text-[hsl(var(--green))]'
            : connState === 'connecting'
            ? 'bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))]'
            : 'bg-[hsl(var(--red)/0.15)] text-[hsl(var(--red))]'
        }`}>
          {connState}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Font size controls */}
          <button
            onClick={() => setFontSize(s => Math.max(MIN_FONT_SIZE, s - 1))}
            disabled={fontSize <= MIN_FONT_SIZE}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors disabled:opacity-50"
            title="Decrease font size"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <button
            onClick={() => setFontSize(s => Math.min(MAX_FONT_SIZE, s + 1))}
            disabled={fontSize >= MAX_FONT_SIZE}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors disabled:opacity-50"
            title="Increase font size"
          >
            <ZoomIn className="h-3 w-3" />
          </button>

          {/* Focus/maximize */}
          <button
            onClick={() => setIsFocused(true)}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--purple))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors"
            title="Focus terminal"
          >
            <Maximize2 className="h-3 w-3" />
          </button>

          {/* Separator */}
          <div className="w-px h-3 bg-[hsl(var(--border))] mx-0.5" />

          <button
            onClick={() => setShowForkInput(!showForkInput)}
            disabled={data.status !== 'ready'}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors disabled:opacity-50"
            title="Fork worktree"
          >
            <GitFork className="h-3 w-3" />
          </button>

          {!isRoot && data.status === 'ready' && (
            <button
              onClick={handleMerge}
              disabled={isMerging}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors disabled:opacity-50"
              title="Merge to parent"
            >
              {isMerging ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
            </button>
          )}

          {!isRoot && (
            <button
              onClick={handleDelete}
              disabled={isDeleting || data.status === 'merging'}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors disabled:opacity-50"
              title="Delete worktree"
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          )}

          {isRoot && (
            <button
              onClick={() => removeNode(data.id)}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors"
              title="Remove from canvas"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {data.status === 'error' && (
            <AlertCircle className="h-3 w-3 text-[hsl(var(--red))]" />
          )}
        </div>
      </div>

      {/* Fork input bar */}
      {showForkInput && (
        <div className="flex gap-1 px-2 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shrink-0">
          <input
            type="text"
            value={forkBranch}
            onChange={(e) => setForkBranch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFork()}
            placeholder="branch-name"
            className="flex-1 px-2 py-1 text-[10px] bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
            autoFocus
          />
          <button
            onClick={handleFork}
            disabled={isForking || !forkBranch.trim()}
            className="px-2 py-1 text-[10px] font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] rounded transition-colors disabled:opacity-50"
          >
            {isForking ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Fork'}
          </button>
        </div>
      )}

      {/* Ports bar */}
      {data.ports.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shrink-0">
          {data.ports.map((p) => (
            <a
              key={p.host}
              href={`http://localhost:${p.host}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono bg-[hsl(var(--bg-surface))] text-[hsl(var(--text-secondary))] rounded hover:text-[hsl(var(--cyan))] transition-colors"
            >
              :{p.host}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
        </div>
      )}

      {/* Terminal body - takes remaining space, clips overflow */}
      <div ref={termContainerRef} className="flex-1 min-h-0 overflow-hidden" onKeyDown={e => e.stopPropagation()}>
        {termReady && (
          <TerminalInstance
            target={{ type: 'container', id: data.sandboxId }}
            onStateChange={handleTerminalStateChange}
            onShellState={handleShellState}
            showStatusBar={false}
            fontSize={fontSize}
            className="h-full [&_.xterm]:!h-full [&_.xterm-viewport]:!overflow-hidden"
          />
        )}
      </div>
    </div>
    </>
  );
}

export const SandboxNode = memo(SandboxNodeComponent);
