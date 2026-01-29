/**
 * GCP Backend Routes
 *
 * Provides endpoints for configuring and managing GCP Compute Engine backend.
 */

import { Hono } from 'hono';
import { existsSync } from 'fs';
import { getConfig, setConfig } from '../services/config.js';
import { getGcpService, GCP_ZONES, GCP_SIZE_PRESETS } from '../services/gcp.js';
import { reinitializeSandboxService } from './sandboxes.js';

const gcp = new Hono();

// POST /backends/gcp/configure - Configure GCP credentials
gcp.post('/configure', async (c) => {
  try {
    const body = await c.req.json();
    const { projectId, keyFileJson, zone, enabled } = body as {
      projectId?: string;
      keyFileJson?: string;
      zone?: string;
      enabled?: boolean;
    };

    const config = await getConfig();
    const currentGcp = config.cloudBackends?.gcp || {
      projectId: '',
      keyFileJson: '',
      zone: 'us-central1-a',
      enabled: false,
    };

    const newGcp = {
      projectId: projectId ?? currentGcp.projectId,
      keyFileJson: keyFileJson ?? currentGcp.keyFileJson,
      zone: zone ?? currentGcp.zone,
      enabled: enabled ?? currentGcp.enabled,
    };

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        gcp: newGcp,
      },
    });

    // Reinitialize the service if config changed
    if (projectId || keyFileJson || zone || enabled !== undefined) {
      try {
        const gcpService = getGcpService();
        await gcpService.initialize();
        reinitializeSandboxService();
      } catch {
        // Ignore initialization errors - they'll show up in test
      }
    }

    return c.json({
      success: true,
      gcp: {
        ...newGcp,
        keyFileJson: newGcp.keyFileJson ? '[stored]' : '',
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /backends/gcp/test - Test GCP connection
gcp.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    const { projectId, keyFileJson, zone } = body as {
      projectId?: string;
      keyFileJson?: string;
      zone?: string;
    };

    const config = await getConfig();

    const testProjectId = projectId || config.cloudBackends?.gcp?.projectId;
    const testKeyFileJson = keyFileJson || config.cloudBackends?.gcp?.keyFileJson;
    const testZone = zone || config.cloudBackends?.gcp?.zone || 'us-central1-a';

    if (!testProjectId || !testKeyFileJson) {
      return c.json({ success: false, error: 'GCP project ID and service account key are required' }, 400);
    }

    // Temporarily update config for testing
    const originalGcp = config.cloudBackends?.gcp;
    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        gcp: {
          projectId: testProjectId,
          keyFileJson: testKeyFileJson,
          zone: testZone,
          enabled: originalGcp?.enabled ?? false,
        },
      },
    });

    // Test the connection
    const gcpService = getGcpService();
    await gcpService.initialize();
    const result = await gcpService.testConnection();

    // Restore original config if we were just testing
    if (originalGcp && (projectId || keyFileJson)) {
      await setConfig({
        cloudBackends: {
          ...config.cloudBackends,
          gcp: originalGcp,
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

// GET /backends/gcp/config - Get GCP configuration (without secrets)
gcp.get('/config', async (c) => {
  try {
    const config = await getConfig();
    const gcpConfig = config.cloudBackends?.gcp;

    const gcpService = getGcpService();
    const sshKeyPath = gcpService.getSshKeyPath();
    const hasSshKey = existsSync(sshKeyPath);

    if (!gcpConfig) {
      return c.json({
        configured: false,
        zone: 'us-central1-a',
        enabled: false,
        hasSshKey,
        sshKeyPath,
      });
    }

    return c.json({
      configured: !!(gcpConfig.projectId && gcpConfig.keyFileJson),
      projectId: gcpConfig.projectId,
      zone: gcpConfig.zone,
      enabled: gcpConfig.enabled,
      hasCredentials: !!(gcpConfig.projectId && gcpConfig.keyFileJson),
      hasSshKey,
      sshKeyPath,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /backends/gcp/zones - List available zones
gcp.get('/zones', async (c) => {
  return c.json(GCP_ZONES);
});

// GET /backends/gcp/sizes - List size presets
gcp.get('/sizes', async (c) => {
  return c.json(GCP_SIZE_PRESETS);
});

// POST /backends/gcp/refresh - Force refresh instance cache
gcp.post('/refresh', async (c) => {
  try {
    const gcpService = getGcpService();
    if (!await gcpService.isAvailable()) {
      return c.json({ success: false, error: 'GCP is not configured or enabled' }, 400);
    }
    gcpService.invalidateCache();
    return c.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /backends/gcp/ssh-key - Download SSH private key
gcp.get('/ssh-key', async (c) => {
  try {
    const gcpService = getGcpService();
    const privateKey = await gcpService.getSshPrivateKey();

    if (!privateKey) {
      return c.json({ error: 'SSH key not available. Create an instance first to generate a key.' }, 404);
    }

    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', 'attachment; filename="gcp-key.pem"');

    return c.body(privateKey);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default gcp;
