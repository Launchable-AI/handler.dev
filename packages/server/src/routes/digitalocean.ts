/**
 * DigitalOcean Backend Routes
 *
 * Provides endpoints for configuring and managing DigitalOcean backend.
 */

import { Hono } from 'hono';
import { existsSync } from 'fs';
import { getConfig, setConfig } from '../services/config.js';
import { getDigitalOceanService, DO_REGIONS, DO_SIZE_PRESETS } from '../services/digitalocean.js';
import { reinitializeSandboxService } from './sandboxes.js';

const digitalocean = new Hono();

// POST /backends/digitalocean/configure - Configure DigitalOcean credentials
digitalocean.post('/configure', async (c) => {
  try {
    const body = await c.req.json();
    const { apiToken, region, enabled } = body as {
      apiToken?: string;
      region?: string;
      enabled?: boolean;
    };

    const config = await getConfig();
    const currentDo = config.cloudBackends?.digitalocean || {
      apiToken: '',
      region: 'nyc1',
      enabled: false,
    };

    const newDo = {
      apiToken: apiToken ?? currentDo.apiToken,
      region: region ?? currentDo.region,
      enabled: enabled ?? currentDo.enabled,
      sshKeyId: currentDo.sshKeyId,
      sshPrivateKey: currentDo.sshPrivateKey,
      sshPublicKey: currentDo.sshPublicKey,
    };

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        digitalocean: newDo,
      },
    });

    // Reinitialize the service if credentials, region, or enabled state changed
    if (apiToken || region || enabled !== undefined) {
      try {
        const doService = getDigitalOceanService();
        await doService.initialize();
        // Reset the sandbox service so DO adapter gets registered on next use
        reinitializeSandboxService();
      } catch {
        // Ignore initialization errors - they'll show up in test
      }
    }

    return c.json({
      success: true,
      digitalocean: {
        ...newDo,
        apiToken: newDo.apiToken ? '***' : '',
        sshPrivateKey: newDo.sshPrivateKey ? '[stored]' : undefined,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /backends/digitalocean/test - Test DigitalOcean connection
digitalocean.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    const { apiToken, region } = body as {
      apiToken?: string;
      region?: string;
    };

    const config = await getConfig();

    // Use provided credentials or fall back to stored ones
    const testToken = apiToken || config.cloudBackends?.digitalocean?.apiToken;
    const testRegion = region || config.cloudBackends?.digitalocean?.region || 'nyc1';

    if (!testToken) {
      return c.json({ success: false, error: 'DigitalOcean API token is required' }, 400);
    }

    // Temporarily update config for testing
    const originalDo = config.cloudBackends?.digitalocean;
    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        digitalocean: {
          apiToken: testToken,
          region: testRegion,
          enabled: originalDo?.enabled ?? false,
          sshKeyId: originalDo?.sshKeyId,
          sshPrivateKey: originalDo?.sshPrivateKey,
          sshPublicKey: originalDo?.sshPublicKey,
        },
      },
    });

    // Test the connection
    const doService = getDigitalOceanService();
    await doService.initialize();
    const result = await doService.testConnection();

    // Restore original config if we were just testing
    if (originalDo && apiToken) {
      await setConfig({
        cloudBackends: {
          ...config.cloudBackends,
          digitalocean: originalDo,
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

// GET /backends/digitalocean/config - Get DigitalOcean configuration (without secrets)
digitalocean.get('/config', async (c) => {
  try {
    const config = await getConfig();
    const doConfig = config.cloudBackends?.digitalocean;

    // Check if SSH key file exists
    const doService = getDigitalOceanService();
    const sshKeyPath = doService.getSshKeyPath();
    const hasSshKey = existsSync(sshKeyPath);

    if (!doConfig) {
      return c.json({
        configured: false,
        region: 'nyc1',
        enabled: false,
        hasSshKey,
        sshKeyPath,
      });
    }

    return c.json({
      configured: !!doConfig.apiToken,
      region: doConfig.region,
      enabled: doConfig.enabled,
      hasCredentials: !!doConfig.apiToken,
      hasSshKey,
      sshKeyPath,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /backends/digitalocean/regions - List available regions
digitalocean.get('/regions', async (c) => {
  return c.json(DO_REGIONS);
});

// GET /backends/digitalocean/sizes - List size presets
digitalocean.get('/sizes', async (c) => {
  return c.json(DO_SIZE_PRESETS);
});

// POST /backends/digitalocean/refresh - Force refresh droplet cache
digitalocean.post('/refresh', async (c) => {
  try {
    const doService = getDigitalOceanService();
    if (!await doService.isAvailable()) {
      return c.json({ success: false, error: 'DigitalOcean is not configured or enabled' }, 400);
    }
    doService.invalidateCache();
    return c.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /backends/digitalocean/ssh-key - Download SSH private key
digitalocean.get('/ssh-key', async (c) => {
  try {
    const doService = getDigitalOceanService();
    const privateKey = await doService.getSshPrivateKey();

    if (!privateKey) {
      return c.json({ error: 'SSH key not available. Create a droplet first to generate a key.' }, 404);
    }

    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', 'attachment; filename="digitalocean-key"');

    return c.body(privateKey);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default digitalocean;
