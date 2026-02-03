/**
 * GitHubSettings - GitHub connection and repository visibility settings
 */

import { useState, useEffect, useMemo } from 'react';
import { Loader2, ExternalLink, Eye, EyeOff, CheckCircle, Github, Search, Check } from 'lucide-react';
import * as api from '../../api/client';
import { useGitHubStatus, useConfigureGitHub, useDisconnectGitHub, useClearGitHubCredentials, useGitHubRepos, useSetVisibleRepos } from '../../hooks/useGitHub';

export function GitHubSettings() {
  const { data: status, isLoading: statusLoading } = useGitHubStatus();
  const configureGitHub = useConfigureGitHub();
  const disconnectGitHub = useDisconnectGitHub();
  const clearCredentials = useClearGitHubCredentials();
  const setVisibleRepos = useSetVisibleRepos();

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Repo selection state
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [showAllRepos, setShowAllRepos] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  // Load repos when connected
  const { data: reposData, isLoading: reposLoading } = useGitHubRepos({
    perPage: 100,
    sort: 'pushed',
    enabled: !!status?.connected,
  });

  // Initialize selection state from status
  useEffect(() => {
    if (status?.visibleRepos) {
      if (status.visibleRepos === 'all') {
        setShowAllRepos(true);
        setSelectedRepos(new Set());
      } else {
        setShowAllRepos(false);
        setSelectedRepos(new Set(status.visibleRepos));
      }
      setHasChanges(false);
    }
  }, [status?.visibleRepos]);

  // Filter repos by search
  const filteredRepos = useMemo(() => {
    if (!reposData?.repos) return [];
    const search = repoSearch.toLowerCase();
    return reposData.repos.filter(
      repo =>
        repo.full_name.toLowerCase().includes(search) ||
        (repo.description?.toLowerCase().includes(search) ?? false)
    );
  }, [reposData?.repos, repoSearch]);

  const handleSaveCredentials = async () => {
    if (!clientId || !clientSecret) return;
    await configureGitHub.mutateAsync({ clientId, clientSecret });
    setClientId('');
    setClientSecret('');
  };

  const handleConnect = async () => {
    if (!status?.clientConfigured) return;
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const { url } = await api.getGitHubOAuthUrl(redirectUri);
      window.location.href = url;
    } catch (err) {
      console.error('Failed to get OAuth URL:', err);
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectGitHub.mutateAsync();
  };

  const handleClearCredentials = async () => {
    if (confirm('Are you sure you want to clear all GitHub credentials? You will need to reconfigure the OAuth app.')) {
      await clearCredentials.mutateAsync();
    }
  };

  const handleToggleRepo = (fullName: string) => {
    const newSelected = new Set(selectedRepos);
    if (newSelected.has(fullName)) {
      newSelected.delete(fullName);
    } else {
      newSelected.add(fullName);
    }
    setSelectedRepos(newSelected);
    setHasChanges(true);
  };

  const handleSelectAll = () => {
    if (reposData?.repos) {
      setSelectedRepos(new Set(reposData.repos.map(r => r.full_name)));
      setHasChanges(true);
    }
  };

  const handleSelectNone = () => {
    setSelectedRepos(new Set());
    setHasChanges(true);
  };

  const handleSaveVisibility = async () => {
    if (showAllRepos) {
      await setVisibleRepos.mutateAsync('all');
    } else {
      await setVisibleRepos.mutateAsync(Array.from(selectedRepos));
    }
    setHasChanges(false);
  };

  const handleToggleShowAll = (checked: boolean) => {
    setShowAllRepos(checked);
    setHasChanges(true);
  };

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">GitHub Integration</h3>
        <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
          Connect your GitHub account to clone repositories and start working directly
        </p>
      </div>

      {/* Connection Card */}
      <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
            <Github className="h-5 w-5 text-[hsl(var(--text-primary))]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">GitHub Account</h4>
              {status?.connected && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">
                  Connected as @{status.username}
                </span>
              )}
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
              Connect via OAuth to access your repositories
            </p>
            <div className="flex items-center gap-4 mt-1">
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-[hsl(var(--text-secondary))] hover:underline"
              >
                Create OAuth App
              </a>
              <a
                href="https://docs.github.com/en/apps/oauth-apps"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:underline"
              >
                Docs <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
          {/* Connected state */}
          {status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-[hsl(var(--green))]" />
                  <span className="text-xs text-[hsl(var(--text-primary))]">
                    Connected to GitHub as <strong>@{status.username}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnectGitHub.isPending || clearCredentials.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] disabled:opacity-50"
                  >
                    {disconnectGitHub.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Disconnect
                  </button>
                  <button
                    onClick={handleClearCredentials}
                    disabled={disconnectGitHub.isPending || clearCredentials.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
                  >
                    {clearCredentials.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Clear Credentials
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* OAuth credentials setup */}
              {!status?.clientConfigured && (
                <>
                  <div className="p-3 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)] text-xs text-[hsl(var(--amber))]">
                    To connect GitHub, first create an OAuth App and enter the credentials below.
                    Set the callback URL to: <code className="bg-[hsl(var(--bg-base))] px-1 py-0.5">{window.location.origin}</code>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Client ID</label>
                    <input
                      type="text"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="Enter your GitHub OAuth Client ID"
                      className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Client Secret</label>
                    <div className="relative">
                      <input
                        type={showClientSecret ? 'text' : 'password'}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="Enter your GitHub OAuth Client Secret"
                        className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientSecret(!showClientSecret)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                      >
                        {showClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={handleSaveCredentials}
                      disabled={!clientId || !clientSecret || configureGitHub.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--text-primary))] text-[hsl(var(--bg-base))] hover:opacity-90 disabled:opacity-50"
                    >
                      {configureGitHub.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Save Credentials
                    </button>
                  </div>
                </>
              )}

              {/* Connect button (after credentials are configured) */}
              {status?.clientConfigured && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleConnect}
                      disabled={isConnecting || clearCredentials.isPending}
                      className="flex items-center gap-2 px-4 py-2 text-xs bg-[hsl(var(--text-primary))] text-[hsl(var(--bg-base))] hover:opacity-90 disabled:opacity-50"
                    >
                      {isConnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Github className="h-4 w-4" />
                      )}
                      Connect with GitHub
                    </button>
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">
                      OAuth credentials configured. Click to authorize.
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[hsl(var(--border))]">
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">
                      Need to change OAuth app credentials?
                    </span>
                    <button
                      onClick={handleClearCredentials}
                      disabled={isConnecting || clearCredentials.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
                    >
                      {clearCredentials.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Clear Credentials
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Repository Visibility Section - Only shown when connected */}
      {status?.connected && (
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">Repository Visibility</h4>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
                Choose which repositories to show in the Repos tab
              </p>
            </div>
            {hasChanges && (
              <button
                onClick={handleSaveVisibility}
                disabled={setVisibleRepos.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--green))] text-white hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
              >
                {setVisibleRepos.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            )}
          </div>

          {/* Show all toggle */}
          <label className="flex items-center gap-3 cursor-pointer p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
            <input
              type="checkbox"
              checked={showAllRepos}
              onChange={(e) => handleToggleShowAll(e.target.checked)}
              className="w-4 h-4 accent-[hsl(var(--green))]"
            />
            <div>
              <span className="text-xs font-medium text-[hsl(var(--text-primary))]">Show all repositories</span>
              <p className="text-[10px] text-[hsl(var(--text-muted))]">
                Display all repositories you have access to
              </p>
            </div>
          </label>

          {/* Repo selection (only when not showing all) */}
          {!showAllRepos && (
            <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[hsl(var(--text-secondary))]">
                  {selectedRepos.size} of {reposData?.repos.length ?? 0} repositories selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAll}
                    className="text-[10px] text-[hsl(var(--cyan))] hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-[hsl(var(--text-muted))]">|</span>
                  <button
                    onClick={handleSelectNone}
                    className="text-[10px] text-[hsl(var(--text-muted))] hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
                <input
                  type="text"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  placeholder="Search repositories..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>

              {/* Repo list */}
              <div className="max-h-64 overflow-y-auto border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
                {reposLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[hsl(var(--text-muted))]">
                    {repoSearch ? 'No repositories match your search' : 'No repositories found'}
                  </div>
                ) : (
                  filteredRepos.map((repo) => (
                    <label
                      key={repo.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))] last:border-b-0"
                    >
                      <div
                        className={`w-4 h-4 border flex items-center justify-center shrink-0 ${
                          selectedRepos.has(repo.full_name)
                            ? 'bg-[hsl(var(--green))] border-[hsl(var(--green))]'
                            : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]'
                        }`}
                        onClick={() => handleToggleRepo(repo.full_name)}
                      >
                        {selectedRepos.has(repo.full_name) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
                            {repo.full_name}
                          </span>
                          {repo.private && (
                            <span className="text-[10px] px-1 py-0.5 bg-[hsl(var(--amber)/0.1)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.2)]">
                              private
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-[10px] text-[hsl(var(--text-muted))] truncate">
                            {repo.description}
                          </p>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info section */}
      <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
        <h4 className="text-xs font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">About GitHub Integration</h4>
        <div className="space-y-2 text-[10px] text-[hsl(var(--text-muted))]">
          <p>
            <strong className="text-[hsl(var(--text-secondary))]">OAuth App vs GitHub App:</strong> This uses an OAuth App which requests
            the <code className="bg-[hsl(var(--bg-elevated))] px-1">repo</code> scope to access your repositories.
          </p>
          <p>
            <strong className="text-[hsl(var(--text-secondary))]">Repository Visibility:</strong> While the OAuth token has access to
            all repositories you authorize, you can choose which ones appear in the Repos tab using the settings above.
          </p>
          <p>
            <strong className="text-[hsl(var(--text-secondary))]">Fine-grained Access:</strong> For more precise permission control,
            consider using GitHub's{' '}
            <a
              href="https://docs.github.com/en/apps/creating-github-apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[hsl(var(--cyan))] hover:underline"
            >
              GitHub Apps
            </a>{' '}
            which allow per-repository access.
          </p>
        </div>
      </div>
    </div>
  );
}
