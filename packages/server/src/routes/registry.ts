/**
 * Container registry routes
 *
 * Push images to various registries (ECR, GCR, ACR, Docker Hub, Daytona)
 * and track push history.
 */

import { Hono } from 'hono';
import { createRegistry, getAvailableRegistries, type RegistryPushRequest } from '../services/registry/index.js';
import { addPushRecord, listPushRecords, deletePushRecord } from '../services/registry/push-history.js';

const registry = new Hono();

/**
 * GET /api/registry/available
 * List available (configured) registries
 */
registry.get('/available', async (c) => {
  try {
    const registries = await getAvailableRegistries();
    return c.json(registries);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list registries';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/registry/push
 * Push an image to a registry (SSE streaming)
 */
registry.post('/push', async (c) => {
  let body: RegistryPushRequest;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.localImage) {
    return c.json({ error: 'localImage is required' }, 400);
  }
  if (!body.imageName) {
    return c.json({ error: 'imageName is required' }, 400);
  }
  if (!body.registryType) {
    return c.json({ error: 'registryType is required' }, 400);
  }

  // Check Docker availability
  const { execFileSync } = await import('child_process');
  try {
    execFileSync('docker', ['version'], { stdio: 'pipe' });
  } catch {
    return c.json({ error: 'Docker is not available on the server' }, 500);
  }

  // Check local image exists
  try {
    execFileSync('docker', ['image', 'inspect', body.localImage], { stdio: 'pipe' });
  } catch {
    return c.json({ error: `Local image not found: ${body.localImage}` }, 404);
  }

  // Set up SSE
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: string, data: string) => {
    try {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Stream closed
    }
  };

  (async () => {
    let reg;
    try {
      reg = await createRegistry(body.registryType, body);

      await sendEvent('info', `Logging into ${body.registryType} registry...`);
      await reg.login();
      await sendEvent('info', 'Login successful');

      const result = await reg.push(body.localImage, body.imageName, async (message, type) => {
        await sendEvent(type, message);
      });

      // Save to push history
      const record = await addPushRecord({
        localImage: body.localImage,
        remoteImage: result.remoteImage,
        imageName: body.imageName,
        registryType: result.registryType,
        registryUrl: result.registryUrl,
        pushedAt: result.pushedAt,
      });

      await sendEvent('result', JSON.stringify(record));
      await sendEvent('done', 'Push completed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to push image';
      console.error('[Registry] Push error:', message);
      await sendEvent('error', message);
    } finally {
      if (reg) {
        await reg.logout();
      }
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

/**
 * GET /api/registry/push-history
 * List push history records
 */
registry.get('/push-history', async (c) => {
  try {
    const records = await listPushRecords();
    return c.json(records);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list push history';
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /api/registry/push-history/:id
 * Delete a push history record
 */
registry.delete('/push-history/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const deleted = await deletePushRecord(id);
    if (!deleted) {
      return c.json({ error: 'Record not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete record';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/registry/test
 * Test registry connectivity
 */
registry.post('/test', async (c) => {
  let body: { registryType: string; acrLoginServer?: string };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const reg = await createRegistry(body.registryType as any, body as any);
    await reg.login();
    await reg.logout();
    return c.json({ success: true, message: `Successfully connected to ${body.registryType}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return c.json({ success: false, error: message });
  }
});

export default registry;
