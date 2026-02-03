/**
 * GitHubSettings - GitHub connection and repository visibility settings
 * Supports both OAuth App (broad permissions) and GitHub App (fine-grained)
 */

import { useState, useEffect, useMemo } from 'react';
import { Loader2, ExternalLink, Eye, EyeOff, CheckCircle, Github, Search, Check, Key, Shield } from 'lucide-react';
import * as api from '../../api/client';
import { useGitHubStatus, useConfigureGitHub, useDisconnectGitHub, useClearGitHubCredentials, useGitHubRepos, useSetVisibleRepos } from '../../hooks/useGitHub';
import {
  useGitHubAppStatus,
  useConfigureGitHubApp,
  useGitHubAppInstallations,
  useSelectGitHubAppInstallation,
  useDisconnectGitHubApp,
  useClearGitHubAppCredentials,
  useGitHubAppRepos,
  useSetGitHubAppVisibleRepos,
} from '../../hooks/useGitHubApp';

type AuthMode = 'oauth' | 'github-app';

export function GitHubSettings() {
  // Determine which mode to show based on what's configured
  const { data: oauthStatus, isLoading: oauthLoading } = useGitHubStatus();
  const { data: appStatus, isLoading: appLoading } = useGitHubAppStatus();

  const [authMode, setAuthMode] = useState<AuthMode>('github-app');

  // Auto-select mode based on what's configured
  useEffect(() => {
    if (oauthStatus?.connected || oauthStatus?.clientConfigured) {
      setAuthMode('oauth');
    } else if (appStatus?.installed || appStatus?.configured) {
      setAuthMode('github-app');
    }
  }, [oauthStatus, appStatus]);

  if (oauthLoading || appLoading) {
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

      {/* Auth Mode Toggle */}
      <div className="flex items-center gap-1 p-1 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] w-fit">
        <button
          onClick={() => setAuthMode('github-app')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
            authMode === 'github-app'
              ? 'bg-[hsl(var(--green)/0.2)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.3)]'
              : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          GitHub App
          <span className="text-[10px] opacity-70">(Recommended)</span>
        </button>
        <button
          onClick={() => setAuthMode('oauth')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
            authMode === 'oauth'
              ? 'bg-[hsl(var(--amber)/0.2)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.3)]'
              : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Key className="h-3.5 w-3.5" />
          OAuth App
        </button>
      </div>

      {authMode === 'github-app' ? (
        <GitHubAppSettings status={appStatus} />
      ) : (
        <OAuthAppSettings status={oauthStatus} />
      )}
    </div>
  );
}

/**
 * GitHub App Settings (fine-grained permissions)
 */
function GitHubAppSettings({ status }: { status: api.GitHubAppStatus | undefined }) {
  const configureApp = useConfigureGitHubApp();
  const { data: installations, refetch: refetchInstallations } = useGitHubAppInstallations(status?.configured && !status?.installed);
  const selectInstallation = useSelectGitHubAppInstallation();
  const disconnectApp = useDisconnectGitHubApp();
  const clearCredentials = useClearGitHubAppCredentials();
  const setVisibleRepos = useSetGitHubAppVisibleRepos();

  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  // Repo selection state
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [showAllRepos, setShowAllRepos] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  // Load repos when installed
  const { data: reposData, isLoading: reposLoading } = useGitHubAppRepos({
    perPage: 100,
    enabled: !!status?.installed,
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
    if (!appId || !privateKey) return;
    await configureApp.mutateAsync({ appId, privateKey });
    setAppId('');
    setPrivateKey('');
  };

  const handleSelectInstallation = async (installation: api.GitHubAppInstallation) => {
    await selectInstallation.mutateAsync({
      installationId: installation.id.toString(),
      username: installation.account.login,
    });
  };

  const handleClearCredentials = async () => {
    if (confirm('Are you sure you want to clear all GitHub App credentials?')) {
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

  const handleSaveVisibility = async () => {
    if (showAllRepos) {
      await setVisibleRepos.mutateAsync('all');
    } else {
      await setVisibleRepos.mutateAsync(Array.from(selectedRepos));
    }
    setHasChanges(false);
  };

  return (
    <>
      {/* Connection Card */}
      <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)]">
            <Shield className="h-5 w-5 text-[hsl(var(--green))]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">GitHub App</h4>
              {status?.installed && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">
                  Installed on @{status.username}
                </span>
              )}
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
              Fine-grained permissions with read-only access to selected repositories
            </p>
            <div className="flex items-center gap-4 mt-1">
              <a
                href="https://github.com/settings/apps/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-[hsl(var(--green))] hover:underline"
              >
                Create GitHub App
              </a>
              <a
                href="https://docs.github.com/en/apps/creating-github-apps"
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
          {/* Installed state */}
          {status?.installed ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-[hsl(var(--green))]" />
                  <span className="text-xs text-[hsl(var(--text-primary))]">
                    Connected as <strong>@{status.username}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => disconnectApp.mutate()}
                    disabled={disconnectApp.isPending || clearCredentials.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] disabled:opacity-50"
                  >
                    {disconnectApp.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Disconnect
                  </button>
                  <button
                    onClick={handleClearCredentials}
                    disabled={disconnectApp.isPending || clearCredentials.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
                  >
                    {clearCredentials.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Clear Credentials
                  </button>
                </div>
              </div>
            </div>
          ) : status?.configured ? (
            /* Configured but not installed - show installations */
            <div className="space-y-3">
              <div className="p-3 bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.2)] text-xs text-[hsl(var(--cyan))]">
                App configured. Select an installation below, or{' '}
                <a
                  href={`https://github.com/apps`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  install your app
                </a>{' '}
                on your account first.
              </div>

              {installations?.installations && installations.installations.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(var(--text-secondary))]">Available Installations</span>
                    <button
                      onClick={() => refetchInstallations()}
                      className="text-[10px] text-[hsl(var(--cyan))] hover:underline"
                    >
                      Refresh
                    </button>
                  </div>
                  {installations.installations.map((inst) => (
                    <div
                      key={inst.id}
                      className="flex items-center justify-between p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={inst.account.avatar_url}
                          alt={inst.account.login}
                          className="w-8 h-8 rounded"
                        />
                        <div>
                          <span className="text-xs font-medium text-[hsl(var(--text-primary))]">
                            @{inst.account.login}
                          </span>
                          <p className="text-[10px] text-[hsl(var(--text-muted))]">
                            {inst.repository_selection === 'all' ? 'All repositories' : 'Selected repositories'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleSelectInstallation(inst)}
                        disabled={selectInstallation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--green))] text-white hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
                      >
                        {selectInstallation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                        Select
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-[hsl(var(--text-muted))]">
                  No installations found. Install your GitHub App on your account first.
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-[hsl(var(--border))]">
                <span className="text-[10px] text-[hsl(var(--text-muted))]">
                  Need to change app credentials?
                </span>
                <button
                  onClick={handleClearCredentials}
                  disabled={clearCredentials.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
                >
                  {clearCredentials.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Clear Credentials
                </button>
              </div>
            </div>
          ) : (
            /* Not configured - show setup form */
            <>
              <div className="p-3 bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-xs text-[hsl(var(--green))]">
                <strong>Setup Instructions:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-1">
                  <li>Create a GitHub App with "Contents: Read-only" permission</li>
                  <li>Generate a private key and download it</li>
                  <li>Enter the App ID and private key below</li>
                  <li>Install the app on your account, selecting repos</li>
                </ol>
              </div>
              <div>
                <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">App ID</label>
                <input
                  type="text"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="Enter your GitHub App ID (e.g., 123456)"
                  className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Private Key (PEM)</label>
                <div className="relative">
                  <textarea
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="Paste your private key here (-----BEGIN RSA PRIVATE KEY-----...)"
                    rows={4}
                    className={`w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] font-mono resize-y ${
                      !showPrivateKey && privateKey ? 'text-transparent' : ''
                    }`}
                    style={!showPrivateKey && privateKey ? { caretColor: 'hsl(var(--text-primary))' } : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    className="absolute right-2 top-2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                  >
                    {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSaveCredentials}
                  disabled={!appId || !privateKey || configureApp.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--green))] text-white hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
                >
                  {configureApp.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save Credentials
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Repository Visibility Section - Only shown when installed */}
      {status?.installed && (
        <RepoVisibilitySection
          repos={reposData?.repos || []}
          reposLoading={reposLoading}
          repoSearch={repoSearch}
          setRepoSearch={setRepoSearch}
          selectedRepos={selectedRepos}
          showAllRepos={showAllRepos}
          setShowAllRepos={(checked) => { setShowAllRepos(checked); setHasChanges(true); }}
          hasChanges={hasChanges}
          filteredRepos={filteredRepos}
          handleToggleRepo={handleToggleRepo}
          handleSelectAll={() => { setSelectedRepos(new Set(reposData?.repos?.map(r => r.full_name) || [])); setHasChanges(true); }}
          handleSelectNone={() => { setSelectedRepos(new Set()); setHasChanges(true); }}
          handleSaveVisibility={handleSaveVisibility}
          isSaving={setVisibleRepos.isPending}
        />
      )}

      {/* Info section */}
      <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
        <h4 className="text-xs font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">About GitHub App</h4>
        <div className="space-y-2 text-[10px] text-[hsl(var(--text-muted))]">
          <p>
            <strong className="text-[hsl(var(--green))]">Fine-grained Permissions:</strong> GitHub Apps allow you to
            grant only "Contents: Read-only" access, instead of full repository control.
          </p>
          <p>
            <strong className="text-[hsl(var(--green))]">Per-Repository Access:</strong> When installing the app,
            you can select specific repositories instead of granting access to all.
          </p>
          <p>
            <strong className="text-[hsl(var(--green))]">No Org Prompts:</strong> Unlike OAuth Apps, GitHub Apps
            don't prompt for organization access unless you explicitly install on an org.
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * OAuth App Settings (broad permissions - legacy)
 */
function OAuthAppSettings({ status }: { status: api.GitHubStatus | undefined }) {
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

  const { data: reposData, isLoading: reposLoading } = useGitHubRepos({
    perPage: 100,
    sort: 'pushed',
    enabled: !!status?.connected,
  });

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

  const handleClearCredentials = async () => {
    if (confirm('Are you sure you want to clear all OAuth credentials?')) {
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

  const handleSaveVisibility = async () => {
    if (showAllRepos) {
      await setVisibleRepos.mutateAsync('all');
    } else {
      await setVisibleRepos.mutateAsync(Array.from(selectedRepos));
    }
    setHasChanges(false);
  };

  return (
    <>
      {/* Connection Card */}
      <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)]">
            <Key className="h-5 w-5 text-[hsl(var(--amber))]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">OAuth App</h4>
              {status?.connected && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">
                  Connected as @{status.username}
                </span>
              )}
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
              Traditional OAuth with broader repository access
            </p>
            <div className="flex items-center gap-4 mt-1">
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-[hsl(var(--amber))] hover:underline"
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

        <div className="p-3 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)] text-xs text-[hsl(var(--amber))]">
          <strong>Note:</strong> OAuth Apps require the <code className="bg-[hsl(var(--bg-base))] px-1">repo</code> scope
          which grants full read/write access. Consider using a GitHub App for read-only access.
        </div>

        <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
          {status?.connected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-[hsl(var(--green))]" />
                <span className="text-xs text-[hsl(var(--text-primary))]">
                  Connected as <strong>@{status.username}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => disconnectGitHub.mutate()}
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
          ) : status?.clientConfigured ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConnect}
                  disabled={isConnecting || clearCredentials.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-xs bg-[hsl(var(--text-primary))] text-[hsl(var(--bg-base))] hover:opacity-90 disabled:opacity-50"
                >
                  {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                  Connect with GitHub
                </button>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[hsl(var(--border))]">
                <span className="text-[10px] text-[hsl(var(--text-muted))]">Need to change credentials?</span>
                <button
                  onClick={handleClearCredentials}
                  disabled={clearCredentials.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
                >
                  Clear Credentials
                </button>
              </div>
            </div>
          ) : (
            <>
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
        </div>
      </div>

      {status?.connected && (
        <RepoVisibilitySection
          repos={reposData?.repos || []}
          reposLoading={reposLoading}
          repoSearch={repoSearch}
          setRepoSearch={setRepoSearch}
          selectedRepos={selectedRepos}
          showAllRepos={showAllRepos}
          setShowAllRepos={(checked) => { setShowAllRepos(checked); setHasChanges(true); }}
          hasChanges={hasChanges}
          filteredRepos={filteredRepos}
          handleToggleRepo={handleToggleRepo}
          handleSelectAll={() => { setSelectedRepos(new Set(reposData?.repos?.map(r => r.full_name) || [])); setHasChanges(true); }}
          handleSelectNone={() => { setSelectedRepos(new Set()); setHasChanges(true); }}
          handleSaveVisibility={handleSaveVisibility}
          isSaving={setVisibleRepos.isPending}
        />
      )}
    </>
  );
}

/**
 * Shared Repo Visibility Section
 */
interface RepoVisibilitySectionProps {
  repos: Array<{ id: number; full_name: string; private: boolean; description: string | null }>;
  reposLoading: boolean;
  repoSearch: string;
  setRepoSearch: (value: string) => void;
  selectedRepos: Set<string>;
  showAllRepos: boolean;
  setShowAllRepos: (checked: boolean) => void;
  hasChanges: boolean;
  filteredRepos: Array<{ id: number; full_name: string; private: boolean; description: string | null }>;
  handleToggleRepo: (fullName: string) => void;
  handleSelectAll: () => void;
  handleSelectNone: () => void;
  handleSaveVisibility: () => void;
  isSaving: boolean;
}

function RepoVisibilitySection({
  repos,
  reposLoading,
  repoSearch,
  setRepoSearch,
  selectedRepos,
  showAllRepos,
  setShowAllRepos,
  hasChanges,
  filteredRepos,
  handleToggleRepo,
  handleSelectAll,
  handleSelectNone,
  handleSaveVisibility,
  isSaving,
}: RepoVisibilitySectionProps) {
  return (
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
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--green))] text-white hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        )}
      </div>

      <label className="flex items-center gap-3 cursor-pointer p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
        <input
          type="checkbox"
          checked={showAllRepos}
          onChange={(e) => setShowAllRepos(e.target.checked)}
          className="w-4 h-4 accent-[hsl(var(--green))]"
        />
        <div>
          <span className="text-xs font-medium text-[hsl(var(--text-primary))]">Show all repositories</span>
          <p className="text-[10px] text-[hsl(var(--text-muted))]">
            Display all repositories you have access to
          </p>
        </div>
      </label>

      {!showAllRepos && (
        <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[hsl(var(--text-secondary))]">
              {selectedRepos.size} of {repos.length} repositories selected
            </span>
            <div className="flex items-center gap-2">
              <button onClick={handleSelectAll} className="text-[10px] text-[hsl(var(--cyan))] hover:underline">
                Select all
              </button>
              <span className="text-[hsl(var(--text-muted))]">|</span>
              <button onClick={handleSelectNone} className="text-[10px] text-[hsl(var(--text-muted))] hover:underline">
                Clear
              </button>
            </div>
          </div>

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
                    {selectedRepos.has(repo.full_name) && <Check className="h-3 w-3 text-white" />}
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
                      <p className="text-[10px] text-[hsl(var(--text-muted))] truncate">{repo.description}</p>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
