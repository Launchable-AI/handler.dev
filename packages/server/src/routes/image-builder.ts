/**
 * Image Builder Routes
 *
 * Dev-only routes for managing VM image building operations.
 * All routes are gated by environment=development middleware.
 *
 * Provides:
 * - Image listing and inspection
 * - Running build scripts (prepare, kernel build, upload, download) with SSE output
 * - Operation management (list, cancel)
 */

import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  listImageDetails,
  inspectImage,
  runOperation,
  cancelOperation,
  listOperations,
} from '../services/image-builder.js';

const imageBuilder = new Hono();

// Dev-mode middleware: reject all requests unless environment=development
imageBuilder.use('*', async (c, next) => {
  if (process.env.environment !== 'development') {
    return c.json({ error: 'Image Builder is only available in development mode' }, 403);
  }
  await next();
});

/**
 * GET /api/image-builder
 * List all base images with file details
 */
imageBuilder.get('/', (c) => {
  try {
    const images = listImageDetails();
    return c.json(images);
  } catch (error) {
    console.error('[Image Builder] Failed to list images:', error);
    return c.json({ error: String(error) }, 500);
  }
});

/**
 * GET /api/image-builder/aws-profiles
 * List available AWS CLI profiles from ~/.aws/config
 */
imageBuilder.get('/aws-profiles', (c) => {
  try {
    const awsConfigPath = path.join(os.homedir(), '.aws', 'config');
    const profiles: string[] = [];

    if (fs.existsSync(awsConfigPath)) {
      const content = fs.readFileSync(awsConfigPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // Match [default] and [profile xyz]
        if (trimmed === '[default]') {
          profiles.push('default');
        } else {
          const match = trimmed.match(/^\[profile\s+(.+?)\]$/);
          if (match) {
            profiles.push(match[1]);
          }
        }
      }
    }

    return c.json({ profiles });
  } catch (error) {
    console.error('[Image Builder] Failed to list AWS profiles:', error);
    return c.json({ profiles: [] });
  }
});

/**
 * GET /api/image-builder/:name
 * Inspect a single image in detail
 */
imageBuilder.get('/:name', async (c) => {
  try {
    const name = c.req.param('name');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return c.json({ error: 'Invalid image name format' }, 400);
    }
    const detail = await inspectImage(name);
    return c.json(detail);
  } catch (error) {
    console.error('[Image Builder] Failed to inspect image:', error);
    return c.json({ error: String(error) }, 500);
  }
});

/**
 * GET /api/image-builder/operations/list
 * List active operations
 */
imageBuilder.get('/operations/list', (c) => {
  return c.json(listOperations());
});

/**
 * POST /api/image-builder/operations/:id/cancel
 * Cancel a running operation
 */
imageBuilder.post('/operations/:id/cancel', (c) => {
  const id = c.req.param('id');
  const cancelled = cancelOperation(id);
  if (!cancelled) {
    return c.json({ error: 'Operation not found or already completed' }, 404);
  }
  return c.json({ success: true });
});

/**
 * Helper: create an SSE endpoint that runs a build operation
 */
function createSseOperationHandler(
  type: 'prepare' | 'upload' | 'download',
) {
  return async (c: any) => {
    const name = c.req.param('name');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return c.json({ error: 'Invalid image name format' }, 400);
    }

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          const opId = runOperation(
            type,
            { imageName: name },
            (line) => sendEvent('output', { line }),
            () => {
              sendEvent('done', { success: true });
              controller.close();
            },
            (error) => {
              sendEvent('error', { error });
              controller.close();
            },
          );
          sendEvent('started', { operationId: opId });
        } catch (error) {
          sendEvent('error', { error: String(error) });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  };
}

/**
 * POST /api/image-builder/:name/prepare
 * SSE: run prepare-fc-image.sh
 */
imageBuilder.post('/:name/prepare', createSseOperationHandler('prepare'));

/**
 * POST /api/image-builder/:name/upload
 * SSE: run upload-fc-image.sh with optional S3 config from request body
 */
imageBuilder.post('/:name/upload', async (c: any) => {
  const name = c.req.param('name');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    return c.json({ error: 'Invalid image name format' }, 400);
  }

  // Parse optional upload config from body
  const body = await c.req.json().catch(() => ({}));
  const uploadConfig = {
    awsProfile: body.awsProfile as string | undefined,
    s3Bucket: body.s3Bucket as string | undefined,
    s3Region: body.s3Region as string | undefined,
  };

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const opId = runOperation(
          'upload',
          { imageName: name, uploadConfig },
          (line) => sendEvent('output', { line }),
          () => {
            sendEvent('done', { success: true });
            controller.close();
          },
          (error) => {
            sendEvent('error', { error });
            controller.close();
          },
        );
        sendEvent('started', { operationId: opId });
      } catch (error) {
        sendEvent('error', { error: String(error) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

/**
 * POST /api/image-builder/:name/download
 * SSE: run download-image.sh
 */
imageBuilder.post('/:name/download', createSseOperationHandler('download'));

/**
 * POST /api/image-builder/kernel/build
 * SSE: run build-fc-kernel.sh
 */
imageBuilder.post('/kernel/build', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const kernelVersion = body.version;

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const opId = runOperation(
          'kernel-build',
          { kernelVersion },
          (line) => sendEvent('output', { line }),
          () => {
            sendEvent('done', { success: true });
            controller.close();
          },
          (error) => {
            sendEvent('error', { error });
            controller.close();
          },
        );
        sendEvent('started', { operationId: opId });
      } catch (error) {
        sendEvent('error', { error: String(error) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

export default imageBuilder;
