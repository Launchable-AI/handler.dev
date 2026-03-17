/**
 * FocusedNodeView - Renders a single canvas node's terminal at full size.
 * Used by the "focused window" canvas layout mode.
 */

import { useState, useCallback } from 'react';
import { GitBranch, ZoomIn, ZoomOut } from 'lucide-react';
import type { WorktreeNode } from '../../types/command-centre';
import { TerminalInstance } from '../Terminal/TerminalInstance';
import type { ConnectionState } from '../Terminal/TerminalInstance';

interface FocusedNodeViewProps {
  node: WorktreeNode;
  sandboxName?: string;
}

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

export function FocusedNodeView({ node, sandboxName }: FocusedNodeViewProps) {
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);

  const handleStateChange = useCallback((newState: ConnectionState) => {
    setConnState(newState);
  }, []);

  const isRoot = node.parentNodeId === null;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shrink-0">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: statusColors[node.status] }}
        />
        {sandboxName && (
          <span className="text-[11px] font-medium text-[hsl(var(--text-primary))] shrink-0">
            {sandboxName}
          </span>
        )}
        {sandboxName && (
          <span className="text-[9px] text-[hsl(var(--text-muted))]">/</span>
        )}
        <GitBranch className="h-3 w-3 text-[hsl(var(--cyan))] shrink-0" />
        <span className="text-[11px] font-medium text-[hsl(var(--text-primary))] truncate">
          {node.branch}
        </span>

        <div className="flex-1" />

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
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <TerminalInstance
          target={{
            type: node.backendType && node.backendType !== 'docker' ? 'vm' : 'container',
            id: node.sandboxId,
            sessionKey: node.id,
            ...(node.ip ? { ip: node.ip } : {}),
            ...(node.worktreePath && !isRoot ? { workdir: node.worktreePath } : {}),
          }}
          onStateChange={handleStateChange}
          showStatusBar={false}
          fontSize={fontSize}
          className="h-full"
        />
      </div>
    </div>
  );
}
