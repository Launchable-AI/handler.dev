/**
 * MinimizedNodesSidebar - Right sidebar showing minimized canvas nodes
 */

import { useState } from 'react';
import { ChevronLeft, ChevronRight, GitBranch, Maximize2, AlertCircle } from 'lucide-react';
import type { WorktreeNode } from '../../types/command-centre';

export interface MinimizedNodeInfo {
  id: string;
  sandboxId: string;
  branch: string;
  sandboxName?: string;
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

export function MinimizedNodesSidebar({ nodes, onRestore }: MinimizedNodesSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Don't render if no minimized nodes
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div
      className={`relative z-10 bg-[hsl(var(--bg-surface))] border-l border-[hsl(var(--border))] flex flex-col transition-all duration-200 ${
        collapsed ? 'w-10' : 'w-48'
      } shrink-0`}
    >
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
}

function MinimizedNodeItem({ node, collapsed, onRestore }: MinimizedNodeItemProps) {
  const needsInput = node.claudeStatus === 'waiting';

  return (
    <div
      onClick={() => onRestore(node.id)}
      className={`group flex items-center gap-2 py-2 hover:bg-[hsl(var(--bg-elevated))] transition-colors cursor-pointer border-b border-[hsl(var(--border)/0.5)] ${
        collapsed ? 'px-2 justify-center' : 'px-3'
      } ${needsInput ? 'bg-[hsl(var(--amber)/0.05)]' : ''}`}
      title={collapsed ? `${node.sandboxName || node.sandboxId.slice(0, 12)} - Click to restore` : 'Click to restore'}
    >
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[node.status]}`} />

      {!collapsed && (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-[hsl(var(--text-primary))] truncate">
              {node.sandboxName || node.sandboxId.slice(0, 12)}
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
        </>
      )}

      {/* Collapsed: show alert indicator */}
      {collapsed && needsInput && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          <span className="w-2 h-2 rounded-full bg-[hsl(var(--amber))] animate-pulse block" />
        </div>
      )}
    </div>
  );
}
