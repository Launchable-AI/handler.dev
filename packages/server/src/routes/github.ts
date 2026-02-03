/**
 * GitHub OAuth and API routes
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getGitHubService } from '../services/github.js';

const github = new Hono();

// Get GitHub status
github.get('/status', async (c) => {
  try {
    const service = getGitHubService();
    const status = await service.getStatus();
    return c.json(status);
  } catch (error) {
    console.error('[GitHub] Failed to get status:', error);
    return c.json({ error: 'Failed to get GitHub status' }, 500);
  }
});

// Configure OAuth credentials
github.post(
  '/configure',
  zValidator(
    'json',
    z.object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
    })
  ),
  async (c) => {
    try {
      const { clientId, clientSecret } = c.req.valid('json');
      const service = getGitHubService();
      await service.configure(clientId, clientSecret);
      return c.json({ success: true });
    } catch (error) {
      console.error('[GitHub] Failed to configure:', error);
      return c.json({ error: 'Failed to configure GitHub' }, 500);
    }
  }
);

// Get OAuth URL
github.get('/oauth-url', async (c) => {
  try {
    const redirectUri = c.req.query('redirect_uri');
    if (!redirectUri) {
      return c.json({ error: 'redirect_uri is required' }, 400);
    }

    const service = getGitHubService();
    const url = await service.getOAuthUrl(redirectUri);
    return c.json({ url });
  } catch (error) {
    console.error('[GitHub] Failed to get OAuth URL:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get OAuth URL' }, 500);
  }
});

// Exchange code for token (OAuth callback)
github.post(
  '/callback',
  zValidator(
    'json',
    z.object({
      code: z.string().min(1),
      redirectUri: z.string().min(1),
    })
  ),
  async (c) => {
    try {
      const { code, redirectUri } = c.req.valid('json');
      const service = getGitHubService();
      const result = await service.exchangeCode(code, redirectUri);
      return c.json(result);
    } catch (error) {
      console.error('[GitHub] OAuth callback failed:', error);
      return c.json({ error: error instanceof Error ? error.message : 'OAuth failed' }, 500);
    }
  }
);

// Disconnect GitHub
github.post('/disconnect', async (c) => {
  try {
    const service = getGitHubService();
    await service.disconnect();
    return c.json({ success: true });
  } catch (error) {
    console.error('[GitHub] Failed to disconnect:', error);
    return c.json({ error: 'Failed to disconnect' }, 500);
  }
});

// Clear all GitHub credentials (OAuth app + access token)
github.post('/clear-credentials', async (c) => {
  try {
    const service = getGitHubService();
    await service.clearCredentials();
    return c.json({ success: true });
  } catch (error) {
    console.error('[GitHub] Failed to clear credentials:', error);
    return c.json({ error: 'Failed to clear credentials' }, 500);
  }
});

// List repositories
github.get('/repos', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1', 10);
    const perPage = parseInt(c.req.query('per_page') || '30', 10);
    const sort = (c.req.query('sort') || 'pushed') as 'updated' | 'pushed' | 'full_name';
    const type = (c.req.query('type') || 'all') as 'all' | 'owner' | 'member';

    const service = getGitHubService();
    const result = await service.listRepos({ page, perPage, sort, type });
    return c.json(result);
  } catch (error) {
    console.error('[GitHub] Failed to list repos:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to list repos' }, 500);
  }
});

// Get specific repository
github.get('/repos/:owner/:repo', async (c) => {
  try {
    const { owner, repo } = c.req.param();
    const service = getGitHubService();
    const repoData = await service.getRepo(owner, repo);
    return c.json(repoData);
  } catch (error) {
    console.error('[GitHub] Failed to get repo:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get repo' }, 500);
  }
});

// Get current user
github.get('/user', async (c) => {
  try {
    const service = getGitHubService();
    const user = await service.getUser();
    return c.json(user);
  } catch (error) {
    console.error('[GitHub] Failed to get user:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get user' }, 500);
  }
});

// Set visible repos
github.post(
  '/visible-repos',
  zValidator(
    'json',
    z.object({
      visibleRepos: z.union([z.literal('all'), z.array(z.string())]),
    })
  ),
  async (c) => {
    try {
      const { visibleRepos } = c.req.valid('json');
      const service = getGitHubService();
      await service.setVisibleRepos(visibleRepos);
      return c.json({ success: true });
    } catch (error) {
      console.error('[GitHub] Failed to set visible repos:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Failed to set visible repos' }, 500);
    }
  }
);

export default github;
