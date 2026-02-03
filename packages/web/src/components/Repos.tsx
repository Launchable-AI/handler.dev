/**
 * Repos - GitHub repositories tab
 */

import { useState } from 'react';
import { Github, Star, GitFork, Lock, Globe, Loader2, Search, ExternalLink, Settings, RefreshCw } from 'lucide-react';
import { useGitHubStatus, useGitHubRepos } from '../hooks/useGitHub';
import { WorkModal } from './WorkModal';
import type { GitHubRepo } from '../api/client';

export function Repos() {
  const { data: status, isLoading: statusLoading } = useGitHubStatus();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'pushed' | 'updated' | 'full_name'>('pushed');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  const { data: reposData, isLoading: reposLoading, refetch } = useGitHubRepos({
    page,
    perPage: 30,
    sort,
    enabled: status?.connected,
  });

  // Filter repos by visibility setting and search query
  const filteredRepos = (reposData?.repos || [])
    .filter(repo => {
      // Filter by visibility setting
      if (status?.visibleRepos && status.visibleRepos !== 'all') {
        if (!status.visibleRepos.includes(repo.full_name)) {
          return false;
        }
      }
      return true;
    })
    .filter(repo =>
      repo.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

  // Not connected state
  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg">
          <Github className="h-12 w-12 text-[hsl(var(--text-muted))] mx-auto mb-4" />
          <h2 className="text-lg font-medium text-[hsl(var(--text-primary))] text-center mb-2">
            Connect GitHub
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] text-center mb-4 max-w-md">
            Connect your GitHub account to browse repositories and start working on them instantly.
          </p>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('caisson-navigate-tab', { detail: { tab: 'settings' } }));
            }}
            className="flex items-center gap-2 px-4 py-2 mx-auto text-sm bg-[hsl(var(--text-primary))] text-[hsl(var(--bg-base))] hover:opacity-90 transition-opacity"
          >
            <Settings className="h-4 w-4" />
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <div className="flex items-center gap-3">
          <Github className="h-5 w-5 text-[hsl(var(--text-primary))]" />
          <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
            Repositories
          </h2>
          <span className="text-xs text-[hsl(var(--text-muted))]">
            @{status.username}
          </span>
          {status?.visibleRepos && status.visibleRepos !== 'all' && (
            <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--amber)/0.1)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.2)]">
              {status.visibleRepos.length} selected
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories..."
              className="pl-9 pr-4 py-1.5 w-64 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
            />
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="px-3 py-1.5 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
          >
            <option value="pushed">Recently pushed</option>
            <option value="updated">Recently updated</option>
            <option value="full_name">Name</option>
          </select>

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            disabled={reposLoading}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${reposLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Repo list */}
      <div className="flex-1 overflow-y-auto p-6">
        {reposLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[hsl(var(--text-muted))]">
            <Github className="h-8 w-8 mb-3" />
            <p className="text-sm mb-2">
              {searchQuery ? 'No repositories match your search' : 'No repositories visible'}
            </p>
            {!searchQuery && status?.visibleRepos && status.visibleRepos !== 'all' && (
              <p className="text-xs text-[hsl(var(--text-muted))]">
                Showing only selected repos.{' '}
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('caisson-navigate-tab', { detail: { tab: 'settings', subTab: 'github' } }));
                  }}
                  className="text-[hsl(var(--cyan))] hover:underline"
                >
                  Change in Settings
                </button>
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredRepos.map(repo => (
              <RepoCard
                key={repo.id}
                repo={repo}
                onWork={() => setSelectedRepo(repo)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {reposData && (reposData.hasMore || page > 1) && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-[hsl(var(--text-muted))]">
              Page {page}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!reposData.hasMore}
              className="px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Work Modal */}
      {selectedRepo && (
        <WorkModal
          repo={selectedRepo}
          onClose={() => setSelectedRepo(null)}
        />
      )}
    </div>
  );
}

interface RepoCardProps {
  repo: GitHubRepo;
  onWork: () => void;
}

function RepoCard({ repo, onWork }: RepoCardProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  return (
    <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--cyan)/0.5)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {repo.private ? (
              <Lock className="h-3.5 w-3.5 text-[hsl(var(--amber))] shrink-0" />
            ) : (
              <Globe className="h-3.5 w-3.5 text-[hsl(var(--text-muted))] shrink-0" />
            )}
            <a
              href={repo.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[hsl(var(--cyan))] hover:underline truncate"
            >
              {repo.full_name}
            </a>
          </div>
        </div>
        <a
          href={repo.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Description */}
      {repo.description && (
        <p className="text-xs text-[hsl(var(--text-secondary))] mb-3 line-clamp-2">
          {repo.description}
        </p>
      )}

      {/* Meta */}
      <div className="flex items-center gap-4 mb-3 text-[10px] text-[hsl(var(--text-muted))]">
        {repo.language && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[hsl(var(--cyan))]" />
            {repo.language}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3" />
          {repo.stargazers_count}
        </span>
        <span className="flex items-center gap-1">
          <GitFork className="h-3 w-3" />
          {repo.forks_count}
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[hsl(var(--border))]">
        <span className="text-[10px] text-[hsl(var(--text-muted))]">
          Updated {formatDate(repo.pushed_at)}
        </span>
        <button
          onClick={onWork}
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] transition-colors"
        >
          Work
        </button>
      </div>
    </div>
  );
}
