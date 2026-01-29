import { useState, useEffect, useCallback } from 'react';
import { X, GitBranch, Loader2, ChevronRight } from 'lucide-react';
import * as worktreeApi from '../../api/worktrees';
import type { GitCommit } from '../../api/worktrees';

interface GitLogPanelProps {
  sandboxId: string;
  cwd?: string;
  onClose: () => void;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function GitLogPanel({ sandboxId, cwd, onClose }: GitLogPanelProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState<string>('');
  const [showLoading, setShowLoading] = useState(false);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await worktreeApi.getContainerGitLog(sandboxId, 50, cwd);
      setCommits(res.commits);
      setBranch(res.branch);
    } catch (err) {
      console.error('Failed to fetch git log:', err);
    } finally {
      setLoading(false);
    }
  }, [sandboxId, cwd]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const handleCommitClick = async (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
      setShowOutput('');
      return;
    }
    setExpandedHash(hash);
    setShowLoading(true);
    try {
      const output = await worktreeApi.getContainerGitShow(sandboxId, hash, cwd);
      setShowOutput(output);
    } catch {
      setShowOutput('Failed to load commit details');
    } finally {
      setShowLoading(false);
    }
  };

  return (
    <div className="absolute top-0 right-0 bottom-0 w-80 z-20 bg-[hsl(var(--bg-surface))] border-l border-[hsl(var(--border))] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shrink-0">
        <GitBranch className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
        <span className="text-xs font-medium text-[hsl(var(--text-primary))] flex-1 truncate">
          {branch || 'Git History'}
        </span>
        <button
          onClick={onClose}
          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--text-muted))]" />
          </div>
        ) : commits.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[hsl(var(--text-muted))]">
            No commits found
          </div>
        ) : (
          commits.map((commit) => (
            <div key={commit.hash}>
              <button
                onClick={() => handleCommitClick(commit.hash)}
                className="w-full text-left px-3 py-2 hover:bg-[hsl(var(--bg-elevated))] transition-colors border-b border-[hsl(var(--border)/0.5)] group"
              >
                <div className="flex items-start gap-2">
                  <ChevronRight
                    className={`h-3 w-3 mt-0.5 shrink-0 text-[hsl(var(--text-muted))] transition-transform ${
                      expandedHash === commit.hash ? 'rotate-90' : ''
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[hsl(var(--text-primary))] leading-snug line-clamp-2">
                      {commit.subject}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] font-mono text-[hsl(var(--cyan))]">
                        {commit.shortHash}
                      </span>
                      <span className="text-[9px] text-[hsl(var(--text-muted))] truncate">
                        {commit.author}
                      </span>
                      <span className="text-[9px] text-[hsl(var(--text-muted))] shrink-0">
                        {formatRelativeDate(commit.date)}
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded commit details */}
              {expandedHash === commit.hash && (
                <div className="px-3 py-2 bg-[hsl(var(--bg-base))] border-b border-[hsl(var(--border)/0.5)]">
                  {showLoading ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--text-muted))]" />
                      <span className="text-[10px] text-[hsl(var(--text-muted))]">Loading...</span>
                    </div>
                  ) : (
                    <pre className="text-[10px] font-mono text-[hsl(var(--text-secondary))] whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
                      {showOutput}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
