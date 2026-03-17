/**
 * MinimizedNodesSidebar - Right sidebar showing minimized canvas nodes
 * Resizable via drag handle on the left edge.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, GitBranch, Maximize2, AlertCircle } from 'lucide-react';
import type { WorktreeNode } from '../../types/command-centre';
import { TerminalInstance } from '../Terminal/TerminalInstance';

export interface MinimizedNodeInfo {
  id: string;
  sandboxId: string;
  branch: string;
  sandboxName?: string;
  label?: string;
  backendType?: string;
  ip?: string;
  status: WorktreeNode['status'];
  claudeStatus: 'off' | 'idle' | 'processing' | 'waiting';
}

interface MinimizedNodesSidebarProps {
  nodes: MinimizedNodeInfo[];
  onRestore: (id: string) => void;
}

const statusColors: Record<WorktreeNode['status'], string> = {
  creating: 'bg-[hsl(var(--amber))]',
  ready: 'bg-[hsl(var(--green))]',
  merging: 'bg-[hsl(var(--purple))]',
  merged: 'bg-[hsl(var(--cyan))]',
  error: 'bg-[hsl(var(--red))]',
};

const STORAGE_KEY = 'handler-minimized-sidebar-width';
const MIN_WIDTH = 120;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 224; // w-56
const COLLAPSED_WIDTH = 40; // w-10

function loadWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) return w;
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

export function MinimizedNodesSidebar({ nodes, onRestore }: MinimizedNodesSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(loadWidth);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Persist width on change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      // Dragging left edge: moving left = wider, moving right = narrower
      const delta = startXRef.current - ev.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(newWidth);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  // Don't render if no minimized nodes
  if (nodes.length === 0) {
    return null;
  }

  // Terminal preview height scales with sidebar width
  const previewHeight = Math.max(40, Math.round((width - MIN_WIDTH) / (MAX_WIDTH - MIN_WIDTH) * 160 + 48));

  return (
    <div
      className="relative z-10 bg-[hsl(var(--bg-surface))] border-l border-[hsl(var(--border))] flex flex-col shrink-0"
      style={{ width: collapsed ? COLLAPSED_WIDTH : width, transition: isDraggingRef.current ? 'none' : 'width 0.2s' }}
    >
      {/* Resize handle — left edge */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[hsl(var(--cyan)/0.3)] active:bg-[hsl(var(--cyan)/0.5)] transition-colors"
        />
      )}

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -left-3 top-3 z-20 p-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded shadow-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] shrink-0 ${collapsed ? 'px-2 justify-center' : ''}`}>
        {!collapsed && (
          <>
            <span className="text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
              Minimized
            </span>
            <span className="text-[10px] text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-base))] px-1.5 py-0.5 rounded-full">
              {nodes.length}
            </span>
          </>
        )}
        {collapsed && (
          <span className="text-[10px] font-bold text-[hsl(var(--text-muted))]">{nodes.length}</span>
        )}
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto">
        {nodes.map(node => (
          <MinimizedNodeItem
            key={node.id}
            node={node}
            collapsed={collapsed}
            onRestore={onRestore}
            previewHeight={previewHeight}
          />
        ))}
      </div>
    </div>
  );
}

interface MinimizedNodeItemProps {
  node: MinimizedNodeInfo;
  collapsed: boolean;
  onRestore: (id: string) => void;
  previewHeight: number;
}

function MinimizedNodeItem({ node, collapsed, onRestore, previewHeight }: MinimizedNodeItemProps) {
  const needsInput = node.claudeStatus === 'waiting';

  return (
    <div
      onClick={() => onRestore(node.id)}
      className={`group hover:bg-[hsl(var(--bg-elevated))] transition-colors cursor-pointer border-b border-[hsl(var(--border)/0.5)] ${
        collapsed ? 'px-2 py-2 flex items-center justify-center' : ''
      } ${needsInput ? 'bg-[hsl(var(--amber)/0.05)]' : ''}`}
      title={collapsed ? `${node.label || node.sandboxName || node.sandboxId.slice(0, 12)} - Click to restore` : 'Click to restore'}
    >
      {collapsed && (
        <>
          {/* Status dot */}
          <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[node.status]}`} />
          {/* Collapsed: show alert indicator */}
          {needsInput && (
            <div className="absolute right-1 top-1/2 -translate-y-1/2">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--amber))] animate-pulse block" />
            </div>
          )}
        </>
      )}

      {!collapsed && (
        <>
          {/* Header row */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[node.status]}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-[hsl(var(--text-primary))] truncate">
                {node.label || node.sandboxName || node.sandboxId.slice(0, 12)}
              </div>
              <div className="flex items-center gap-1 text-[9px] text-[hsl(var(--text-muted))] truncate">
                <GitBranch className="h-2.5 w-2.5 text-[hsl(var(--cyan))] shrink-0" />
                {node.branch}
              </div>
            </div>

            {/* Claude status indicator */}
            {node.claudeStatus !== 'off' && (
              <div className="shrink-0">
                {needsInput ? (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[hsl(var(--amber)/0.15)] rounded">
                    <AlertCircle className="h-3 w-3 text-[hsl(var(--amber))]" />
                    <span className="text-[9px] font-medium text-[hsl(var(--amber))]">INPUT</span>
                  </div>
                ) : node.claudeStatus === 'processing' ? (
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--purple))] animate-pulse" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--text-muted)/0.3)]" />
                )}
              </div>
            )}

            {/* Restore icon on hover */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Maximize2 className="h-3 w-3 text-[hsl(var(--cyan))]" />
            </div>
          </div>

          {/* Terminal preview */}
          {node.status === 'ready' && (
            <div
              className="mx-1.5 mb-1.5 rounded overflow-hidden bg-[hsl(var(--bg-base))] pointer-events-none"
              style={{ height: previewHeight }}
            >
              <TerminalInstance
                target={{
                  type: node.backendType && node.backendType !== 'docker' ? 'vm' : 'container',
                  id: node.sandboxId,
                  sessionKey: `minimized-${node.id}`,
                  ...(node.ip ? { ip: node.ip } : {}),
                }}
                showStatusBar={false}
                fontSize={6}
                className="h-full [&_.xterm-viewport]:!overflow-hidden"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
