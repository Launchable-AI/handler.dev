/**
 * GitHub App authentication and API service
 *
 * GitHub Apps use App ID + Private Key to generate JWTs,
 * which are exchanged for installation access tokens.
 * This provides fine-grained, per-repository permissions.
 */

import { SignJWT, importPKCS8 } from 'jose';
import { getConfig, setConfig, type GitHubAppConfig } from './config.js';

const GITHUB_API_URL = 'https://api.github.com';

export interface GitHubAppRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  owner: {
    login: string;
    avatar_url: string;
  };
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubAppInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    avatar_url: string;
    type: string; // 'User' or 'Organization'
  };
  repository_selection: 'all' | 'selected';
  permissions: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface GitHubAppStatus {
  configured: boolean;           // App ID and private key are set
  installed: boolean;            // Installation ID is set
  username?: string;             // Account the app is installed on
  installationId?: string;
  repositorySelection?: 'all' | 'selected';
  visibleRepos?: 'all' | string[];
}

class GitHubAppService {
  private installationTokenCache: { token: string; expiresAt: Date } | null = null;

  /**
   * Get the current GitHub App status
   */
  async getStatus(): Promise<GitHubAppStatus> {
    const config = await getConfig();
    const githubApp = config.cloudBackends?.githubApp;

    return {
      configured: !!(githubApp?.appId && githubApp?.privateKey),
      installed: !!githubApp?.installationId,
      username: githubApp?.username,
      installationId: githubApp?.installationId,
      visibleRepos: githubApp?.visibleRepos ?? 'all',
    };
  }

  /**
   * Configure the GitHub App (App ID and Private Key)
   */
  async configure(appId: string, privateKey: string): Promise<void> {
    const config = await getConfig();

    // Validate the private key format
    if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
      throw new Error('Invalid private key format. Must be a PEM-encoded private key.');
    }

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        githubApp: {
          appId,
          privateKey,
          installationId: config.cloudBackends?.githubApp?.installationId,
          username: config.cloudBackends?.githubApp?.username,
          enabled: config.cloudBackends?.githubApp?.enabled ?? false,
          visibleRepos: config.cloudBackends?.githubApp?.visibleRepos,
        },
      },
    });

    // Clear token cache when config changes
    this.installationTokenCache = null;
  }

  /**
   * Generate a JWT for authenticating as the GitHub App
   */
  async generateAppJWT(): Promise<string> {
    const config = await getConfig();
    const githubApp = config.cloudBackends?.githubApp;

    if (!githubApp?.appId || !githubApp?.privateKey) {
      throw new Error('GitHub App not configured');
    }

    const privateKey = await importPKCS8(githubApp.privateKey, 'RS256');

    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(now - 60) // 60 seconds in the past to account for clock drift
      .setExpirationTime(now + 600) // 10 minutes (max allowed)
      .setIssuer(githubApp.appId)
      .sign(privateKey);

    return jwt;
  }

  /**
   * List installations of the GitHub App
   */
  async listInstallations(): Promise<GitHubAppInstallation[]> {
    const jwt = await this.generateAppJWT();

    const response = await fetch(`${GITHUB_API_URL}/app/installations`, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list installations: ${response.status} - ${error}`);
    }

    return response.json() as Promise<GitHubAppInstallation[]>;
  }

  /**
   * Set the installation to use
   */
  async setInstallation(installationId: string, username: string): Promise<void> {
    const config = await getConfig();
    const githubApp = config.cloudBackends?.githubApp;

    if (!githubApp) {
      throw new Error('GitHub App not configured');
    }

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        githubApp: {
          ...githubApp,
          installationId,
          username,
          enabled: true,
        },
      },
    });

    // Clear token cache when installation changes
    this.installationTokenCache = null;
  }

  /**
   * Get an installation access token
   */
  async getInstallationToken(): Promise<string> {
    // Check cache
    if (this.installationTokenCache && this.installationTokenCache.expiresAt > new Date()) {
      return this.installationTokenCache.token;
    }

    const config = await getConfig();
    const githubApp = config.cloudBackends?.githubApp;

    if (!githubApp?.installationId) {
      throw new Error('GitHub App not installed');
    }

    const jwt = await this.generateAppJWT();

    const response = await fetch(
      `${GITHUB_API_URL}/app/installations/${githubApp.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get installation token: ${response.status} - ${error}`);
    }

    const data = await response.json() as { token: string; expires_at: string };

    // Cache the token
    this.installationTokenCache = {
      token: data.token,
      expiresAt: new Date(data.expires_at),
    };

    return data.token;
  }

  /**
   * List repositories accessible to the installation
   */
  async listRepos(options?: {
    page?: number;
    perPage?: number;
  }): Promise<{ repos: GitHubAppRepo[]; hasMore: boolean; totalCount: number }> {
    const token = await this.getInstallationToken();

    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 30;

    const params = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
    });

    const response = await fetch(
      `${GITHUB_API_URL}/installation/repositories?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Token might be expired, clear cache and retry
        this.installationTokenCache = null;
        throw new Error('Installation token expired, please try again');
      }
      throw new Error(`Failed to list repos: ${response.status}`);
    }

    const data = await response.json() as {
      total_count: number;
      repositories: GitHubAppRepo[];
    };

    // Check if there are more pages
    const linkHeader = response.headers.get('Link');
    const hasMore = linkHeader?.includes('rel="next"') ?? (data.total_count > page * perPage);

    return {
      repos: data.repositories,
      hasMore,
      totalCount: data.total_count,
    };
  }

  /**
   * Get a specific repository
   */
  async getRepo(owner: string, repo: string): Promise<GitHubAppRepo> {
    const token = await this.getInstallationToken();

    const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get repo: ${response.status}`);
    }

    return response.json() as Promise<GitHubAppRepo>;
  }

  /**
   * Set which repos are visible ('all' or array of full_names)
   */
  async setVisibleRepos(visibleRepos: 'all' | string[]): Promise<void> {
    const config = await getConfig();
    const githubApp = config.cloudBackends?.githubApp;

    if (!githubApp) {
      throw new Error('GitHub App not configured');
    }

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        githubApp: {
          ...githubApp,
          visibleRepos,
        },
      },
    });
  }

  /**
   * Disconnect the GitHub App (remove installation)
   */
  async disconnect(): Promise<void> {
    const config = await getConfig();
    const githubApp = config.cloudBackends?.githubApp;

    if (!githubApp) {
      return;
    }

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        githubApp: {
          ...githubApp,
          installationId: undefined,
          username: undefined,
          enabled: false,
        },
      },
    });

    this.installationTokenCache = null;
  }

  /**
   * Clear all GitHub App credentials
   */
  async clearCredentials(): Promise<void> {
    const config = await getConfig();

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        githubApp: undefined,
      },
    });

    this.installationTokenCache = null;
  }

  /**
   * Get the clone URL with embedded token for authentication
   * This is used for cloning private repos
   */
  async getAuthenticatedCloneUrl(repoFullName: string): Promise<string> {
    const token = await this.getInstallationToken();
    return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  }
}

// Singleton instance
let instance: GitHubAppService | null = null;

export function getGitHubAppService(): GitHubAppService {
  if (!instance) {
    instance = new GitHubAppService();
  }
  return instance;
}
