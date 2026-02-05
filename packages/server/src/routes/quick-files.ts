import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { dirname, basename } from 'path';
import * as quickFileService from '../services/quick-files.js';
import { injectFilesIntoSandbox } from '../services/sandbox-inject.js';
import type { FileToInject } from '../services/sandbox-inject.js';

const quickFiles = new Hono();

const CreateQuickFileSchema = z.object({
  name: z.string().min(1),
  filename: z.string().min(1),
  destPath: z.string().min(1),
  content: z.string(),
  isDefault: z.boolean().optional(),
});

const UpdateQuickFileSchema = z.object({
  name: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  destPath: z.string().min(1).optional(),
  content: z.string().optional(),
  isDefault: z.boolean().optional(),
});

/**
 * GET /api/quick-files
 * List all quick files
 */
quickFiles.get('/', async (c) => {
  try {
    const files = await quickFileService.getQuickFiles();
    return c.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list quick files';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/quick-files
 * Create a new quick file
 */
quickFiles.post('/', zValidator('json', CreateQuickFileSchema), async (c) => {
  const body = c.req.valid('json');
  try {
    const file = await quickFileService.createQuickFile(body);
    return c.json(file, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create quick file';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/quick-files/:id
 * Get a single quick file
 */
quickFiles.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const file = await quickFileService.getQuickFile(id);
    if (!file) {
      return c.json({ error: 'Quick file not found' }, 404);
    }
    return c.json(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get quick file';
    return c.json({ error: message }, 500);
  }
});

/**
 * PATCH /api/quick-files/:id
 * Update a quick file
 */
quickFiles.patch('/:id', zValidator('json', UpdateQuickFileSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  try {
    const file = await quickFileService.updateQuickFile(id, body);
    if (!file) {
      return c.json({ error: 'Quick file not found' }, 404);
    }
    return c.json(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update quick file';
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /api/quick-files/:id
 * Delete a quick file
 */
quickFiles.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const deleted = await quickFileService.deleteQuickFile(id);
    if (!deleted) {
      return c.json({ error: 'Quick file not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete quick file';
    return c.json({ error: message }, 500);
  }
});

/**
 * Convert a QuickFile to FileToInject format.
 * destPath is the full path (e.g. /root/.bashrc), so we split into dir + filename.
 */
function toFileToInject(qf: quickFileService.QuickFile): FileToInject {
  return {
    content: qf.content,
    destPath: dirname(qf.destPath),
    filename: basename(qf.destPath),
  };
}

/**
 * POST /api/quick-files/:id/copy/:sandboxId
 * Copy a single quick file into a running sandbox
 */
quickFiles.post('/:id/copy/:sandboxId', async (c) => {
  const id = c.req.param('id');
  const sandboxId = c.req.param('sandboxId');
  try {
    const file = await quickFileService.getQuickFile(id);
    if (!file) {
      return c.json({ error: 'Quick file not found' }, 404);
    }

    const injected = await injectFilesIntoSandbox(sandboxId, [toFileToInject(file)]);
    return c.json({ success: true, filesInjected: injected });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to copy quick file to sandbox';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/quick-files/copy-defaults/:sandboxId
 * Copy all default quick files into a running sandbox
 */
quickFiles.post('/copy-defaults/:sandboxId', async (c) => {
  const sandboxId = c.req.param('sandboxId');
  try {
    const defaults = await quickFileService.getDefaultQuickFiles();
    if (defaults.length === 0) {
      return c.json({ success: true, filesInjected: 0 });
    }

    const filesToInject = defaults.map(toFileToInject);
    const injected = await injectFilesIntoSandbox(sandboxId, filesToInject);
    return c.json({ success: true, filesInjected: injected });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to copy default quick files';
    return c.json({ error: message }, 500);
  }
});

export default quickFiles;
