import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { GitBranch, Terminal, GitMerge, Trash2, Loader2, AlertCircle, ExternalLink, GitFork } from 'lucide-react';
import type { WorktreeNode } from '../../../types/command-centre';
import { useCommandCentre } from '../../../hooks/useCommandCentre';
import { useCanvas } from '../../../context/CanvasContext';
import * as worktreeApi from '../../../api/worktrees';

const statusColors: Record<WorktreeNode['status'], string> = {
  creating: 'hsl(var(--amber))',
  ready: 'hsl(var(--green))',
  merging: 'hsl(var(--purple))',
  merged: 'hsl(var(--cyan))',
  error: 'hsl(var(--red))',
};

const statusLabels: Record<WorktreeNode['status'], string> = {
  creating: 'Creating...',
  ready: 'Ready',
  merging: 'Merging...',
  merged: 'Merged',
  error: 'Error',
};

function SandboxNodeComponent({ data }: NodeProps<WorktreeNode>) {
  const { createSession } = useCommandCentre();
  const { addNode, removeNode, updateNode } = useCanvas();
  const [showMenu, setShowMenu] = useState(false);
  const [forkBranch, setForkBranch] = useState('');
  const [showForkInput, setShowForkInput] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isRoot = data.parentNodeId === null;
  const statusColor = statusColors[data.status];

  const handleOpenTerminal = () => {
    createSession('container', data.sandboxId, data.branch);
    setShowMenu(false);
  };

  const handleFork = async () => {
    if (!forkBranch.trim()) return;
    setIsForking(true);
    try {
      const result = await worktreeApi.forkWorktree({
        sandboxId: data.sandboxId,
        branchName: forkBranch.trim(),
        baseBranch: data.branch,
      });

      addNode({
        id: result.id,
        sandboxId: result.sandboxId,
        branch: forkBranch.trim(),
        worktreePath: result.worktreePath,
        parentNodeId: data.id,
        status: 'ready',
        ports: result.ports,
        position: { x: data.position.x + 300, y: data.position.y + 100 },
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

  return (
    <div
      className="relative bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg shadow-lg min-w-[240px]"
      onContextMenu={(e) => {
        e.preventDefault();
        setShowMenu(!showMenu);
      }}
    >
      {/* Source handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-[hsl(var(--cyan))] !border-2 !border-[hsl(var(--bg-surface))]"
      />

      {/* Target handle (top) - only for non-root nodes */}
      {!isRoot && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-[hsl(var(--purple))] !border-2 !border-[hsl(var(--bg-surface))]"
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
        <GitBranch className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
        <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate flex-1">
          {data.branch}
        </span>
        {isRoot && (
          <span className="px-1.5 py-0.5 text-[9px] font-medium bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] rounded">
            MAIN
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="text-[10px] text-[hsl(var(--text-muted))]">
          {statusLabels[data.status]}
        </div>

        {data.worktreePath && (
          <div className="text-[10px] text-[hsl(var(--text-muted))] font-mono truncate">
            {data.worktreePath}
          </div>
        )}

        {/* Ports */}
        {data.ports.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.ports.map((p) => (
              <a
                key={p.host}
                href={`http://localhost:${p.host}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-secondary))] rounded hover:text-[hsl(var(--cyan))] transition-colors"
              >
                :{p.host}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-[hsl(var(--border))]">
        <button
          onClick={handleOpenTerminal}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] rounded transition-colors"
          title="Open terminal"
        >
          <Terminal className="h-3 w-3" />
        </button>

        <button
          onClick={() => setShowForkInput(!showForkInput)}
          disabled={data.status !== 'ready'}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] rounded transition-colors disabled:opacity-50"
          title="Fork worktree"
        >
          <GitFork className="h-3 w-3" />
        </button>

        {!isRoot && data.status === 'ready' && (
          <button
            onClick={handleMerge}
            disabled={isMerging}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] rounded transition-colors disabled:opacity-50"
            title="Merge back to parent"
          >
            {isMerging ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
          </button>
        )}

        {!isRoot && (
          <button
            onClick={handleDelete}
            disabled={isDeleting || data.status === 'merging'}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] rounded transition-colors disabled:opacity-50 ml-auto"
            title="Delete worktree"
          >
            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        )}

        {data.status === 'error' && (
          <AlertCircle className="h-3 w-3 text-[hsl(var(--red))] ml-auto" />
        )}
      </div>

      {/* Fork input */}
      {showForkInput && (
        <div className="px-3 py-2 border-t border-[hsl(var(--border))] flex gap-1">
          <input
            type="text"
            value={forkBranch}
            onChange={(e) => setForkBranch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFork()}
            placeholder="branch-name"
            className="flex-1 px-2 py-1 text-[10px] bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
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

      {/* Context menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute left-full top-0 ml-1 z-50 w-40 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg rounded">
            <button
              onClick={handleOpenTerminal}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            >
              <Terminal className="h-3.5 w-3.5" />
              Open Terminal
            </button>
            <button
              onClick={() => { setShowForkInput(true); setShowMenu(false); }}
              disabled={data.status !== 'ready'}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors disabled:opacity-50"
            >
              <GitFork className="h-3.5 w-3.5" />
              Fork Worktree
            </button>
            {!isRoot && data.status === 'ready' && (
              <button
                onClick={() => { handleMerge(); setShowMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                <GitMerge className="h-3.5 w-3.5" />
                Merge to Parent
              </button>
            )}
            {!isRoot && (
              <button
                onClick={() => { handleDelete(); setShowMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export const SandboxNode = memo(SandboxNodeComponent);
