/**
 * AWS Backend Routes
 *
 * Provides endpoints for configuring and managing AWS EC2 backend.
 */

import { Hono } from 'hono';
import { existsSync } from 'fs';
import { getConfig, setConfig } from '../services/config.js';
import { getAwsService, AWS_REGIONS, DEFAULT_AMIS, AWS_SIZE_PRESETS } from '../services/aws.js';
import { reinitializeSandboxService } from './sandboxes.js';

const aws = new Hono();

// POST /backends/aws/configure - Configure AWS credentials
aws.post('/configure', async (c) => {
  try {
    const body = await c.req.json();
    const { accessKeyId, secretAccessKey, region, enabled, defaultVpcId, defaultSubnetId } = body as {
      accessKeyId?: string;
      secretAccessKey?: string;
      region?: string;
      enabled?: boolean;
      defaultVpcId?: string;
      defaultSubnetId?: string;
    };

    const config = await getConfig();
    const currentAws = config.cloudBackends?.aws || {
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
      enabled: false,
    };

    const newAws = {
      accessKeyId: accessKeyId ?? currentAws.accessKeyId,
      secretAccessKey: secretAccessKey ?? currentAws.secretAccessKey,
      region: region ?? currentAws.region,
      enabled: enabled ?? currentAws.enabled,
      defaultVpcId: defaultVpcId ?? currentAws.defaultVpcId,
      defaultSubnetId: defaultSubnetId ?? currentAws.defaultSubnetId,
      sshKeyName: currentAws.sshKeyName,
      sshPrivateKey: currentAws.sshPrivateKey,
    };

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        aws: newAws,
      },
    });

    // Reinitialize the service if credentials, region, or enabled state changed
    if (accessKeyId || secretAccessKey || region || enabled !== undefined) {
      try {
        const awsService = getAwsService();
        await awsService.initialize();
        // Reset the sandbox service so AWS adapter gets registered on next use
        reinitializeSandboxService();
      } catch {
        // Ignore initialization errors - they'll show up in test
      }
    }

    return c.json({
      success: true,
      aws: {
        ...newAws,
        accessKeyId: newAws.accessKeyId ? '***' : '',
        secretAccessKey: '***',
        sshPrivateKey: newAws.sshPrivateKey ? '[stored]' : undefined,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /backends/aws/test - Test AWS connection
aws.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    const { accessKeyId, secretAccessKey, region } = body as {
      accessKeyId?: string;
      secretAccessKey?: string;
      region?: string;
    };

    const config = await getConfig();

    // Use provided credentials or fall back to stored ones
    const testAccessKey = accessKeyId || config.cloudBackends?.aws?.accessKeyId;
    const testSecretKey = secretAccessKey || config.cloudBackends?.aws?.secretAccessKey;
    const testRegion = region || config.cloudBackends?.aws?.region || 'us-east-1';

    if (!testAccessKey || !testSecretKey) {
      return c.json({ success: false, error: 'AWS credentials are required' }, 400);
    }

    // Temporarily update config for testing
    const originalAws = config.cloudBackends?.aws;
    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        aws: {
          accessKeyId: testAccessKey,
          secretAccessKey: testSecretKey,
          region: testRegion,
          enabled: originalAws?.enabled ?? false,
          sshKeyName: originalAws?.sshKeyName,
          sshPrivateKey: originalAws?.sshPrivateKey,
        },
      },
    });

    // Test the connection
    const awsService = getAwsService();
    await awsService.initialize();
    const result = await awsService.testConnection();

    // Restore original config if we were just testing
    if (originalAws && (accessKeyId || secretAccessKey)) {
      await setConfig({
        cloudBackends: {
          ...config.cloudBackends,
          aws: originalAws,
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

// GET /backends/aws/config - Get AWS configuration (without secrets)
aws.get('/config', async (c) => {
  try {
    const config = await getConfig();
    const awsConfig = config.cloudBackends?.aws;

    // Check if SSH key file exists
    const awsService = getAwsService();
    const sshKeyPath = awsService.getSshKeyPath();
    const hasSshKey = existsSync(sshKeyPath);

    if (!awsConfig) {
      return c.json({
        configured: false,
        region: 'us-east-1',
        enabled: false,
        hasSshKey,
        sshKeyPath,
      });
    }

    return c.json({
      configured: !!(awsConfig.accessKeyId && awsConfig.secretAccessKey),
      region: awsConfig.region,
      enabled: awsConfig.enabled,
      hasCredentials: !!(awsConfig.accessKeyId && awsConfig.secretAccessKey),
      hasSshKey,
      sshKeyPath,
      defaultVpcId: awsConfig.defaultVpcId,
      defaultSubnetId: awsConfig.defaultSubnetId,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /backends/aws/regions - List available regions
aws.get('/regions', async (c) => {
  return c.json(AWS_REGIONS);
});

// GET /backends/aws/amis - List default AMIs per region
aws.get('/amis', async (c) => {
  return c.json(DEFAULT_AMIS);
});

// GET /backends/aws/sizes - List size presets
aws.get('/sizes', async (c) => {
  return c.json(AWS_SIZE_PRESETS);
});

// POST /backends/aws/refresh - Force refresh instance cache
aws.post('/refresh', async (c) => {
  try {
    const awsService = getAwsService();
    if (!await awsService.isAvailable()) {
      return c.json({ success: false, error: 'AWS is not configured or enabled' }, 400);
    }
    awsService.invalidateCache();
    return c.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /backends/aws/ssh-key - Download SSH private key
aws.get('/ssh-key', async (c) => {
  try {
    const awsService = getAwsService();
    const privateKey = await awsService.getSshPrivateKey();

    if (!privateKey) {
      return c.json({ error: 'SSH key not available. Create an instance first to generate a key.' }, 404);
    }

    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', 'attachment; filename="caisson-key.pem"');

    return c.body(privateKey);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /backends/aws/volumes - List Caisson-managed volumes
aws.get('/volumes', async (c) => {
  try {
    const awsService = getAwsService();
    if (!await awsService.isAvailable()) {
      return c.json({ error: 'AWS is not configured or enabled' }, 400);
    }
    const volumes = await awsService.listVolumes();
    return c.json(volumes);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /backends/aws/volumes - Create a new volume
aws.post('/volumes', async (c) => {
  try {
    const awsService = getAwsService();
    if (!await awsService.isAvailable()) {
      return c.json({ error: 'AWS is not configured or enabled' }, 400);
    }

    const body = await c.req.json();
    const { name, sizeGb, availabilityZone } = body as {
      name: string;
      sizeGb: number;
      availabilityZone?: string;
    };

    if (!name || !sizeGb) {
      return c.json({ error: 'name and sizeGb are required' }, 400);
    }

    const volumeId = await awsService.createVolume(sizeGb, name, availabilityZone);
    return c.json({ volumeId }, 201);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// DELETE /backends/aws/volumes/:id - Delete a volume
aws.delete('/volumes/:id', async (c) => {
  try {
    const awsService = getAwsService();
    if (!await awsService.isAvailable()) {
      return c.json({ error: 'AWS is not configured or enabled' }, 400);
    }

    await awsService.deleteVolume(c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default aws;
