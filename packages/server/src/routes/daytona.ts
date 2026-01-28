/**
 * Daytona-specific routes
 *
 * Handles Daytona snapshots and other Daytona-specific operations.
 */

import { Hono } from 'hono';
import { getDaytonaService } from '../services/daytona.js';

const daytona = new Hono();

// ==================== Snapshots ====================

/**
 * GET /api/daytona/snapshots
 * List all snapshots with pagination
 */
daytona.get('/snapshots', async (c) => {
  try {
    const service = getDaytonaService();

    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : undefined;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
    const name = c.req.query('name');
    const sort = c.req.query('sort') as 'name' | 'state' | 'lastUsedAt' | 'createdAt' | undefined;
    const order = c.req.query('order') as 'asc' | 'desc' | undefined;

    const result = await service.listSnapshots({ page, limit, name, sort, order });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list snapshots';
    console.error('[Daytona API] List snapshots error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/daytona/snapshots/:id
 * Get a snapshot by ID or name
 */
daytona.get('/snapshots/:id', async (c) => {
  try {
    const service = getDaytonaService();
    const id = c.req.param('id');

    const snapshot = await service.getSnapshot(id);
    if (!snapshot) {
      return c.json({ error: 'Snapshot not found' }, 404);
    }

    return c.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get snapshot';
    console.error('[Daytona API] Get snapshot error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/daytona/snapshots
 * Create a snapshot from a registry image
 *
 * Body: { name, imageName, entrypoint?, cpu?, memory?, disk?, regionId? }
 */
daytona.post('/snapshots', async (c) => {
  try {
    const service = getDaytonaService();
    const body = await c.req.json();

    if (!body.name) {
      return c.json({ error: 'Snapshot name is required' }, 400);
    }

    const snapshot = await service.createSnapshot({
      name: body.name,
      imageName: body.imageName,
      entrypoint: body.entrypoint,
      cpu: body.cpu,
      memory: body.memory,
      disk: body.disk,
      regionId: body.regionId,
    });

    return c.json(snapshot, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create snapshot';
    console.error('[Daytona API] Create snapshot error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/daytona/snapshots/push
 * Push a local Docker image to Daytona and create a snapshot (SSE streaming)
 *
 * Body: { localImage, snapshotName, cpu?, memory?, disk?, entrypoint?, regionId? }
 * Returns: SSE stream with progress events, final event contains the snapshot
 */
daytona.post('/snapshots/push', async (c) => {
  const service = getDaytonaService();
  let body: Record<string, unknown>;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  console.log('[Daytona Push] Received request:', JSON.stringify({ localImage: body.localImage, snapshotName: body.snapshotName }));

  if (!body.localImage) {
    return c.json({ error: 'localImage is required' }, 400);
  }
  if (!body.snapshotName) {
    return c.json({ error: 'snapshotName is required' }, 400);
  }

  // Check if Docker is available
  const { execSync } = await import('child_process');
  try {
    execSync('docker version', { stdio: 'pipe' });
  } catch {
    return c.json({ error: 'Docker is not available on the server' }, 500);
  }

  // Check if local image exists
  try {
    execSync(`docker image inspect ${body.localImage}`, { stdio: 'pipe' });
  } catch {
    return c.json({ error: `Local image not found: ${body.localImage}` }, 404);
  }

  // Set up SSE headers
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

  // Start the push in background
  (async () => {
    try {
      const snapshot = await service.pushLocalImageWithProgress(
        body.localImage as string,
        body.snapshotName as string,
        async (message, type) => {
          await sendEvent(type, message);
        },
        {
          cpu: body.cpu as number | undefined,
          memory: body.memory as number | undefined,
          disk: body.disk as number | undefined,
          entrypoint: body.entrypoint as string[] | undefined,
          regionId: body.regionId as string | undefined,
        }
      );

      // Send the final snapshot
      await sendEvent('snapshot', JSON.stringify(snapshot));
      await sendEvent('done', 'Push completed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to push image';
      console.error('[Daytona API] Push image error:', message);
      await sendEvent('error', message);
    } finally {
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
 * DELETE /api/daytona/snapshots/:id
 * Delete a snapshot
 */
daytona.delete('/snapshots/:id', async (c) => {
  try {
    const service = getDaytonaService();
    const id = c.req.param('id');

    await service.deleteSnapshot(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete snapshot';
    console.error('[Daytona API] Delete snapshot error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/daytona/snapshots/:id/activate
 * Activate an inactive snapshot
 */
daytona.post('/snapshots/:id/activate', async (c) => {
  try {
    const service = getDaytonaService();
    const id = c.req.param('id');

    const snapshot = await service.activateSnapshot(id);
    return c.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to activate snapshot';
    console.error('[Daytona API] Activate snapshot error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/daytona/snapshots/:id/deactivate
 * Deactivate an active snapshot
 */
daytona.post('/snapshots/:id/deactivate', async (c) => {
  try {
    const service = getDaytonaService();
    const id = c.req.param('id');

    await service.deactivateSnapshot(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deactivate snapshot';
    console.error('[Daytona API] Deactivate snapshot error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/daytona/snapshots/:id/build-logs-url
 * Get the build logs URL for a snapshot
 */
daytona.get('/snapshots/:id/build-logs-url', async (c) => {
  try {
    const service = getDaytonaService();
    const id = c.req.param('id');

    const url = await service.getSnapshotBuildLogsUrl(id);
    if (!url) {
      return c.json({ error: 'Build logs not available' }, 404);
    }

    return c.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get build logs URL';
    console.error('[Daytona API] Get build logs URL error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/daytona/registry-access
 * Get temporary registry access for pushing images
 */
daytona.get('/registry-access', async (c) => {
  try {
    const service = getDaytonaService();
    const regionId = c.req.query('regionId');

    const access = await service.getRegistryPushAccess(regionId);
    return c.json(access);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get registry access';
    console.error('[Daytona API] Get registry access error:', message);
    return c.json({ error: message }, 500);
  }
});

export default daytona;
