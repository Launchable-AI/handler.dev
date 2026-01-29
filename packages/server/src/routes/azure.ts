/**
 * Azure Backend Routes
 *
 * Provides endpoints for configuring and managing Azure VM backend.
 */

import { Hono } from 'hono';
import { existsSync } from 'fs';
import { getConfig, setConfig } from '../services/config.js';
import { getAzureService, AZURE_REGIONS, AZURE_SIZE_PRESETS } from '../services/azure.js';
import { reinitializeSandboxService } from './sandboxes.js';

const azure = new Hono();

// POST /backends/azure/configure - Configure Azure credentials
azure.post('/configure', async (c) => {
  try {
    const body = await c.req.json();
    const { tenantId, clientId, clientSecret, subscriptionId, resourceGroup, region, enabled } = body as {
      tenantId?: string;
      clientId?: string;
      clientSecret?: string;
      subscriptionId?: string;
      resourceGroup?: string;
      region?: string;
      enabled?: boolean;
    };

    const config = await getConfig();
    const currentAzure = config.cloudBackends?.azure || {
      tenantId: '',
      clientId: '',
      clientSecret: '',
      subscriptionId: '',
      resourceGroup: 'caisson-rg',
      region: 'eastus',
      enabled: false,
    };

    const newAzure = {
      tenantId: tenantId ?? currentAzure.tenantId,
      clientId: clientId ?? currentAzure.clientId,
      clientSecret: clientSecret ?? currentAzure.clientSecret,
      subscriptionId: subscriptionId ?? currentAzure.subscriptionId,
      resourceGroup: resourceGroup ?? currentAzure.resourceGroup,
      region: region ?? currentAzure.region,
      enabled: enabled ?? currentAzure.enabled,
    };

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        azure: newAzure,
      },
    });

    // Reinitialize the service if credentials, region, or enabled state changed
    if (tenantId || clientId || clientSecret || subscriptionId || region || enabled !== undefined) {
      try {
        const azureService = getAzureService();
        await azureService.initialize();
        // Reset the sandbox service so Azure adapter gets registered on next use
        reinitializeSandboxService();
      } catch {
        // Ignore initialization errors - they'll show up in test
      }
    }

    return c.json({
      success: true,
      azure: {
        ...newAzure,
        clientId: newAzure.clientId ? '***' : '',
        clientSecret: '***',
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /backends/azure/test - Test Azure connection
azure.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    const { tenantId, clientId, clientSecret, subscriptionId, resourceGroup, region } = body as {
      tenantId?: string;
      clientId?: string;
      clientSecret?: string;
      subscriptionId?: string;
      resourceGroup?: string;
      region?: string;
    };

    const config = await getConfig();

    // Use provided credentials or fall back to stored ones
    const testTenantId = tenantId || config.cloudBackends?.azure?.tenantId;
    const testClientId = clientId || config.cloudBackends?.azure?.clientId;
    const testClientSecret = clientSecret || config.cloudBackends?.azure?.clientSecret;
    const testSubscriptionId = subscriptionId || config.cloudBackends?.azure?.subscriptionId;
    const testResourceGroup = resourceGroup || config.cloudBackends?.azure?.resourceGroup || 'caisson-rg';
    const testRegion = region || config.cloudBackends?.azure?.region || 'eastus';

    if (!testTenantId || !testClientId || !testClientSecret || !testSubscriptionId) {
      return c.json({ success: false, error: 'Azure credentials are required (tenantId, clientId, clientSecret, subscriptionId)' }, 400);
    }

    // Temporarily update config for testing
    const originalAzure = config.cloudBackends?.azure;
    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        azure: {
          tenantId: testTenantId,
          clientId: testClientId,
          clientSecret: testClientSecret,
          subscriptionId: testSubscriptionId,
          resourceGroup: testResourceGroup,
          region: testRegion,
          enabled: originalAzure?.enabled ?? false,
        },
      },
    });

    // Test the connection
    const azureService = getAzureService();
    await azureService.initialize();
    const result = await azureService.testConnection();

    // Restore original config if we were just testing
    if (originalAzure && (tenantId || clientId || clientSecret || subscriptionId)) {
      await setConfig({
        cloudBackends: {
          ...config.cloudBackends,
          azure: originalAzure,
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

// GET /backends/azure/config - Get Azure configuration (without secrets)
azure.get('/config', async (c) => {
  try {
    const config = await getConfig();
    const azureConfig = config.cloudBackends?.azure;

    // Check if SSH key file exists
    const azureService = getAzureService();
    const sshKeyPath = azureService.getSshKeyPath();
    const hasSshKey = existsSync(sshKeyPath);

    if (!azureConfig) {
      return c.json({
        configured: false,
        region: 'eastus',
        enabled: false,
        hasSshKey,
        sshKeyPath,
      });
    }

    return c.json({
      configured: !!(azureConfig.clientId && azureConfig.clientSecret && azureConfig.tenantId && azureConfig.subscriptionId),
      region: azureConfig.region,
      enabled: azureConfig.enabled,
      hasCredentials: !!(azureConfig.clientId && azureConfig.clientSecret),
      hasSshKey,
      sshKeyPath,
      resourceGroup: azureConfig.resourceGroup,
      subscriptionId: azureConfig.subscriptionId ? '***' : undefined,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /backends/azure/regions - List available regions
azure.get('/regions', async (c) => {
  return c.json(AZURE_REGIONS);
});

// GET /backends/azure/sizes - List size presets
azure.get('/sizes', async (c) => {
  return c.json(AZURE_SIZE_PRESETS);
});

// POST /backends/azure/refresh - Force refresh instance cache
azure.post('/refresh', async (c) => {
  try {
    const azureService = getAzureService();
    if (!await azureService.isAvailable()) {
      return c.json({ success: false, error: 'Azure is not configured or enabled' }, 400);
    }
    azureService.invalidateCache();
    return c.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /backends/azure/ssh-key - Download SSH private key
azure.get('/ssh-key', async (c) => {
  try {
    const azureService = getAzureService();
    const privateKey = await azureService.getSshPrivateKey();

    if (!privateKey) {
      return c.json({ error: 'SSH key not available. Create an instance first to generate a key.' }, 404);
    }

    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', 'attachment; filename="azure-key.pem"');

    return c.body(privateKey);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default azure;
