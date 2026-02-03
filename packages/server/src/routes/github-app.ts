/**
 * GitHub App routes
 *
 * Routes for configuring and using GitHub App authentication
 * (fine-grained permissions, per-repository access)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getGitHubAppService } from '../services/github-app.js';

const githubApp = new Hono();

// Get GitHub App status
githubApp.get('/status', async (c) => {
  try {
    const service = getGitHubAppService();
    const status = await service.getStatus();
    return c.json(status);
  } catch (error) {
    console.error('[GitHub App] Failed to get status:', error);
    return c.json({ error: 'Failed to get GitHub App status' }, 500);
  }
});

// Configure GitHub App (App ID and Private Key)
githubApp.post(
  '/configure',
  zValidator(
    'json',
    z.object({
      appId: z.string().min(1),
      privateKey: z.string().min(1),
    })
  ),
  async (c) => {
    try {
      const { appId, privateKey } = c.req.valid('json');
      const service = getGitHubAppService();
      await service.configure(appId, privateKey);
      return c.json({ success: true });
    } catch (error) {
      console.error('[GitHub App] Failed to configure:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Failed to configure GitHub App' }, 500);
    }
  }
);

// List installations of the GitHub App
githubApp.get('/installations', async (c) => {
  try {
    const service = getGitHubAppService();
    const installations = await service.listInstallations();
    return c.json({ installations });
  } catch (error) {
    console.error('[GitHub App] Failed to list installations:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to list installations' }, 500);
  }
});

// Select an installation to use
githubApp.post(
  '/select-installation',
  zValidator(
    'json',
    z.object({
      installationId: z.string().min(1),
      username: z.string().min(1),
    })
  ),
  async (c) => {
    try {
      const { installationId, username } = c.req.valid('json');
      const service = getGitHubAppService();
      await service.setInstallation(installationId, username);
      return c.json({ success: true });
    } catch (error) {
      console.error('[GitHub App] Failed to select installation:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Failed to select installation' }, 500);
    }
  }
);

// Disconnect GitHub App (remove installation)
githubApp.post('/disconnect', async (c) => {
  try {
    const service = getGitHubAppService();
    await service.disconnect();
    return c.json({ success: true });
  } catch (error) {
    console.error('[GitHub App] Failed to disconnect:', error);
    return c.json({ error: 'Failed to disconnect' }, 500);
  }
});

// Clear all GitHub App credentials
githubApp.post('/clear-credentials', async (c) => {
  try {
    const service = getGitHubAppService();
    await service.clearCredentials();
    return c.json({ success: true });
  } catch (error) {
    console.error('[GitHub App] Failed to clear credentials:', error);
    return c.json({ error: 'Failed to clear credentials' }, 500);
  }
});

// List repositories accessible to the installation
githubApp.get('/repos', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1', 10);
    const perPage = parseInt(c.req.query('per_page') || '30', 10);

    const service = getGitHubAppService();
    const result = await service.listRepos({ page, perPage });
    return c.json(result);
  } catch (error) {
    console.error('[GitHub App] Failed to list repos:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to list repos' }, 500);
  }
});

// Get specific repository
githubApp.get('/repos/:owner/:repo', async (c) => {
  try {
    const { owner, repo } = c.req.param();
    const service = getGitHubAppService();
    const repoData = await service.getRepo(owner, repo);
    return c.json(repoData);
  } catch (error) {
    console.error('[GitHub App] Failed to get repo:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Failed to get repo' }, 500);
  }
});

// Set visible repos
githubApp.post(
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
      const service = getGitHubAppService();
      await service.setVisibleRepos(visibleRepos);
      return c.json({ success: true });
    } catch (error) {
      console.error('[GitHub App] Failed to set visible repos:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Failed to set visible repos' }, 500);
    }
  }
);

export default githubApp;
