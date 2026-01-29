/**
 * Linode Backend Routes
 *
 * Provides endpoints for configuring and managing Linode backend.
 */

import { Hono } from 'hono';
import { existsSync } from 'fs';
import { getConfig, setConfig } from '../services/config.js';
import { getLinodeService, LINODE_REGIONS, LINODE_SIZE_PRESETS } from '../services/linode.js';
import { reinitializeSandboxService } from './sandboxes.js';

const linode = new Hono();

// POST /backends/linode/configure - Configure Linode credentials
linode.post('/configure', async (c) => {
  try {
    const body = await c.req.json();
    const { apiToken, region, enabled } = body as {
      apiToken?: string;
      region?: string;
      enabled?: boolean;
    };

    const config = await getConfig();
    const currentLinode = config.cloudBackends?.linode || {
      apiToken: '',
      region: 'us-east',
      enabled: false,
    };

    const newLinode = {
      apiToken: apiToken ?? currentLinode.apiToken,
      region: region ?? currentLinode.region,
      enabled: enabled ?? currentLinode.enabled,
    };

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        linode: newLinode,
      },
    });

    // Reinitialize the service if credentials, region, or enabled state changed
    if (apiToken || region || enabled !== undefined) {
      try {
        const linodeService = getLinodeService();
        await linodeService.initialize();
        reinitializeSandboxService();
      } catch {
        // Ignore initialization errors - they'll show up in test
      }
    }

    return c.json({
      success: true,
      linode: {
        ...newLinode,
        apiToken: newLinode.apiToken ? '***' : '',
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /backends/linode/test - Test Linode connection
linode.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    const { apiToken, region } = body as {
      apiToken?: string;
      region?: string;
    };

    const config = await getConfig();

    // Use provided credentials or fall back to stored ones
    const testToken = apiToken || config.cloudBackends?.linode?.apiToken;
    const testRegion = region || config.cloudBackends?.linode?.region || 'us-east';

    if (!testToken) {
      return c.json({ success: false, error: 'Linode API token is required' }, 400);
    }

    // Temporarily update config for testing
    const originalLinode = config.cloudBackends?.linode;
    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        linode: {
          apiToken: testToken,
          region: testRegion,
          enabled: originalLinode?.enabled ?? false,
        },
      },
    });

    // Test the connection
    const linodeService = getLinodeService();
    await linodeService.initialize();
    const result = await linodeService.testConnection();

    // Restore original config if we were just testing
    if (originalLinode && apiToken) {
      await setConfig({
        cloudBackends: {
          ...config.cloudBackends,
          linode: originalLinode,
        },
      });
    }

    return c.json(result);
  } catch (err) {
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    }, 500);
  }
});

// GET /backends/linode/config - Get Linode configuration (without secrets)
linode.get('/config', async (c) => {
  try {
    const config = await getConfig();
    const linodeConfig = config.cloudBackends?.linode;

    const linodeService = getLinodeService();
    const sshKeyPath = linodeService.getSshKeyPath();
    const hasSshKey = existsSync(sshKeyPath);

    if (!linodeConfig) {
      return c.json({
        configured: false,
        region: 'us-east',
        enabled: false,
        hasSshKey,
        sshKeyPath,
      });
    }

    return c.json({
      configured: !!linodeConfig.apiToken,
      region: linodeConfig.region,
      enabled: linodeConfig.enabled,
      hasCredentials: !!linodeConfig.apiToken,
      hasSshKey,
      sshKeyPath,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /backends/linode/regions - List available regions
linode.get('/regions', async (c) => {
  return c.json(LINODE_REGIONS);
});

// GET /backends/linode/sizes - List size presets
linode.get('/sizes', async (c) => {
  return c.json(LINODE_SIZE_PRESETS);
});

// POST /backends/linode/refresh - Force refresh instance cache
linode.post('/refresh', async (c) => {
  try {
    const linodeService = getLinodeService();
    if (!await linodeService.isAvailable()) {
      return c.json({ success: false, error: 'Linode is not configured or enabled' }, 400);
    }
    linodeService.invalidateCache();
    return c.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /backends/linode/ssh-key - Download SSH private key
linode.get('/ssh-key', async (c) => {
  try {
    const linodeService = getLinodeService();
    const privateKey = await linodeService.getSshPrivateKey();

    if (!privateKey) {
      return c.json({ error: 'SSH key not available. Create an instance first to generate a key.' }, 404);
    }

    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', 'attachment; filename="linode-key"');

    return c.body(privateKey);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default linode;
