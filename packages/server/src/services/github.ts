/**
 * GitHub OAuth and API service
 */

import { getConfig, setConfig, type GitHubConfig } from './config.js';

const GITHUB_OAUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

export interface GitHubRepo {
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
}

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
}

export interface GitHubStatus {
  connected: boolean;
  username?: string;
  clientConfigured: boolean;
  visibleRepos?: 'all' | string[];
}

class GitHubService {
  /**
   * Get the current GitHub status
   */
  async getStatus(): Promise<GitHubStatus> {
    const config = await getConfig();
    const github = config.cloudBackends?.github;

    return {
      connected: !!(github?.accessToken && github?.enabled),
      username: github?.username,
      clientConfigured: !!(github?.clientId && github?.clientSecret),
      visibleRepos: github?.visibleRepos ?? 'all',
    };
  }

  /**
   * Get the OAuth authorization URL
   */
  async getOAuthUrl(redirectUri: string): Promise<string> {
    const config = await getConfig();
    const github = config.cloudBackends?.github;

    if (!github?.clientId) {
      throw new Error('GitHub client ID not configured');
    }

    const params = new URLSearchParams({
      client_id: github.clientId,
      redirect_uri: redirectUri,
      scope: 'repo', // Minimal scope: just access to public/private repos for cloning
      state: crypto.randomUUID(),
    });

    return `${GITHUB_OAUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; username: string }> {
    const config = await getConfig();
    const github = config.cloudBackends?.github;

    if (!github?.clientId || !github?.clientSecret) {
      throw new Error('GitHub OAuth not configured');
    }

    // Exchange code for token
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: github.clientId,
        client_secret: github.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Failed to exchange code: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };

    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    if (!tokenData.access_token) {
      throw new Error('No access token returned');
    }

    const accessToken = tokenData.access_token;

    // Get user info
    const userResponse = await fetch(`${GITHUB_API_URL}/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const user = await userResponse.json() as GitHubUser;

    // Save token and username to config
    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        github: {
          ...github,
          accessToken,
          username: user.login,
          enabled: true,
        },
      },
    });

    return { accessToken, username: user.login };
  }

  /**
   * Configure OAuth credentials
   */
  async configure(clientId: string, clientSecret: string): Promise<void> {
    const config = await getConfig();

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        github: {
          clientId,
          clientSecret,
          accessToken: config.cloudBackends?.github?.accessToken,
          username: config.cloudBackends?.github?.username,
          enabled: config.cloudBackends?.github?.enabled ?? false,
        },
      },
    });
  }

  /**
   * Disconnect GitHub (remove access token)
   */
  async disconnect(): Promise<void> {
    const config = await getConfig();
    const github = config.cloudBackends?.github;

    if (!github) {
      return;
    }

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        github: {
          ...github,
          accessToken: undefined,
          username: undefined,
          enabled: false,
        },
      },
    });
  }

  /**
   * Clear all GitHub credentials (OAuth app credentials + access token)
   */
  async clearCredentials(): Promise<void> {
    const config = await getConfig();

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        github: undefined,
      },
    });
  }

  /**
   * Get access token from config
   */
  async getAccessToken(): Promise<string | undefined> {
    const config = await getConfig();
    return config.cloudBackends?.github?.accessToken;
  }

  /**
   * List user's repositories
   */
  async listRepos(options?: {
    page?: number;
    perPage?: number;
    sort?: 'updated' | 'pushed' | 'full_name';
    type?: 'all' | 'owner' | 'member';
  }): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
    const accessToken = await this.getAccessToken();

    if (!accessToken) {
      throw new Error('Not connected to GitHub');
    }

    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 30;
    const sort = options?.sort ?? 'pushed';
    const type = options?.type ?? 'all';

    const params = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
      sort,
      type,
      direction: 'desc',
    });

    const response = await fetch(`${GITHUB_API_URL}/user/repos?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.status === 401) {
      // Token might be expired, disconnect
      await this.disconnect();
      throw new Error('GitHub token expired, please reconnect');
    }

    if (!response.ok) {
      throw new Error(`Failed to list repos: ${response.status}`);
    }

    const repos = await response.json() as GitHubRepo[];

    // Check if there are more pages
    const linkHeader = response.headers.get('Link');
    const hasMore = linkHeader?.includes('rel="next"') ?? false;

    return { repos, hasMore };
  }

  /**
   * Get a specific repository
   */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    const accessToken = await this.getAccessToken();

    if (!accessToken) {
      throw new Error('Not connected to GitHub');
    }

    const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get repo: ${response.status}`);
    }

    return response.json() as Promise<GitHubRepo>;
  }

  /**
   * Get current user info
   */
  async getUser(): Promise<GitHubUser> {
    const accessToken = await this.getAccessToken();

    if (!accessToken) {
      throw new Error('Not connected to GitHub');
    }

    const response = await fetch(`${GITHUB_API_URL}/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user: ${response.status}`);
    }

    return response.json() as Promise<GitHubUser>;
  }

  /**
   * Set which repos are visible ('all' or array of full_names)
   */
  async setVisibleRepos(visibleRepos: 'all' | string[]): Promise<void> {
    const config = await getConfig();
    const github = config.cloudBackends?.github;

    if (!github) {
      throw new Error('GitHub not configured');
    }

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        github: {
          ...github,
          visibleRepos,
        },
      },
    });
  }

  /**
   * Get visible repos setting
   */
  async getVisibleRepos(): Promise<'all' | string[]> {
    const config = await getConfig();
    return config.cloudBackends?.github?.visibleRepos ?? 'all';
  }
}

// Singleton instance
let instance: GitHubService | null = null;

export function getGitHubService(): GitHubService {
  if (!instance) {
    instance = new GitHubService();
  }
  return instance;
}
