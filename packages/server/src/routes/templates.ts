/**
 * Template API Routes
 *
 * Unified interface for managing templates (Dockerfiles, VM images, snapshots)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getTemplateService, initializeTemplateService } from '../services/template/index.js';
import type { TemplateType, TemplateStatus, TemplateArtifactBackend } from '../types/template.js';

const templates = new Hono();

// Lazy initialization state
let templateServiceInitialized = false;

/**
 * Ensure template service is initialized
 */
async function ensureTemplateServiceInitialized() {
  if (templateServiceInitialized) {
    return getTemplateService();
  }

  await initializeTemplateService();
  templateServiceInitialized = true;
  return getTemplateService();
}

// Validation schemas
const TemplateTypeEnum = z.enum(['dockerfile', 'vm-image', 'snapshot']);
const TemplateStatusEnum = z.enum(['draft', 'building', 'ready', 'error']);
const TemplateArtifactBackendEnum = z.enum(['docker', 'vm', 'daytona']);

const ListTemplatesQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  tags: z.string().optional(),
  search: z.string().optional(),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: TemplateTypeEnum,
  dockerfile: z.string().optional(),
  baseImage: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  dockerfile: z.string().optional(),
  baseImage: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const BuildTemplateSchema = z.object({
  backends: z.array(TemplateArtifactBackendEnum).min(1),
  options: z.object({
    force: z.boolean().optional(),
    noCache: z.boolean().optional(),
  }).optional(),
});

/**
 * GET /api/templates
 * List all templates
 */
templates.get('/', zValidator('query', ListTemplatesQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const service = await ensureTemplateServiceInitialized();

  // Parse filters
  let type: TemplateType[] | undefined;
  if (query.type) {
    type = query.type.split(',').filter((t): t is TemplateType =>
      ['dockerfile', 'vm-image', 'snapshot'].includes(t)
    );
  }

  let status: TemplateStatus[] | undefined;
  if (query.status) {
    status = query.status.split(',').filter((s): s is TemplateStatus =>
      ['draft', 'building', 'ready', 'error'].includes(s)
    );
  }

  let tags: string[] | undefined;
  if (query.tags) {
    tags = query.tags.split(',').filter(Boolean);
  }

  try {
    const templateList = await service.list({
      type,
      status,
      tags,
      search: query.search,
    });

    return c.json({ templates: templateList });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list templates';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/templates/:id
 * Get a specific template
 */
templates.get('/:id', async (c) => {
  const id = c.req.param('id');
  const service = await ensureTemplateServiceInitialized();

  try {
    const template = await service.get(id);

    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    return c.json(template);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get template';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/templates
 * Create a new template
 */
templates.post('/', zValidator('json', CreateTemplateSchema), async (c) => {
  const body = c.req.valid('json');
  const service = await ensureTemplateServiceInitialized();

  try {
    const template = await service.create(body);
    return c.json(template, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create template';
    return c.json({ error: message }, 500);
  }
});

/**
 * PATCH /api/templates/:id
 * Update a template
 */
templates.patch('/:id', zValidator('json', UpdateTemplateSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = await ensureTemplateServiceInitialized();

  try {
    const template = await service.update(id, body);
    return c.json(template);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update template';

    if (message.includes('not found')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /api/templates/:id
 * Delete a template
 */
templates.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const service = await ensureTemplateServiceInitialized();

  try {
    await service.delete(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete template';

    if (message.includes('not found')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/templates/:id/build
 * Start building a template for specified backends
 */
templates.post('/:id/build', zValidator('json', BuildTemplateSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = await ensureTemplateServiceInitialized();

  try {
    const jobs = await service.build(id, body);

    if (jobs.length === 0) {
      return c.json({ message: 'All artifacts already exist. Use force: true to rebuild.' });
    }

    return c.json({ jobs }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start build';

    if (message.includes('not found')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/templates/:id/build/status
 * Get build status for a template
 */
templates.get('/:id/build/status', async (c) => {
  const id = c.req.param('id');
  const service = await ensureTemplateServiceInitialized();

  try {
    const template = await service.get(id);
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    const jobs = service.getTemplateBuildJobs(id);

    return c.json({
      templateStatus: template.status,
      artifacts: template.artifacts,
      activeJobs: jobs.filter((j) => j.status === 'building' || j.status === 'pending'),
      recentJobs: jobs.slice(-5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get build status';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/templates/:id/build/logs
 * Stream build logs via SSE
 */
templates.get('/:id/build/logs', async (c) => {
  const id = c.req.param('id');
  const jobId = c.req.query('jobId');
  const service = await ensureTemplateServiceInitialized();

  try {
    const template = await service.get(id);
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    let closed = false;

    const sendEvent = async (event: string, data: unknown) => {
      if (closed) return;
      try {
        await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        // Stream closed
      }
    };

    // Send existing logs
    if (jobId) {
      const job = service.getBuildJob(jobId);
      if (job) {
        for (const line of job.logs) {
          await sendEvent('log', line);
        }

        if (job.status === 'completed' || job.status === 'failed') {
          await sendEvent('done', { status: job.status, error: job.error });
          await writer.close();
          return new Response(readable, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          });
        }
      }
    }

    // Listen for new logs
    const logHandler = ({ jobId: eventJobId, line }: { jobId: string; line: string }) => {
      if (!jobId || eventJobId === jobId) {
        sendEvent('log', line);
      }
    };

    const completedHandler = (job: { id: string; status: string }) => {
      if (!jobId || job.id === jobId) {
        sendEvent('done', { status: job.status });
        cleanup();
      }
    };

    const failedHandler = (job: { id: string; status: string; error?: string }) => {
      if (!jobId || job.id === jobId) {
        sendEvent('done', { status: job.status, error: job.error });
        cleanup();
      }
    };

    const cleanup = () => {
      closed = true;
      service.removeListener('build:log', logHandler);
      service.removeListener('build:completed', completedHandler);
      service.removeListener('build:failed', failedHandler);
      writer.close().catch(() => {});
    };

    service.on('build:log', logHandler);
    service.on('build:completed', completedHandler);
    service.on('build:failed', failedHandler);

    // Clean up after 5 minutes
    const timeout = setTimeout(cleanup, 5 * 60 * 1000);

    c.req.raw.signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      cleanup();
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stream logs';
    return c.json({ error: message }, 500);
  }
});

export default templates;
