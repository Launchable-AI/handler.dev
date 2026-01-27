/**
 * Unified Volumes API Routes
 *
 * Provides a single API for managing all volume backends:
 * - Docker volumes
 * - VM volumes
 * - Daytona volumes
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getVolumeService, initializeVolumeService } from '../services/volume/index.js';
import type { VolumeBackend, VolumeStatus } from '../types/volume.js';

const unifiedVolumes = new Hono();

// Lazy initialization state
let volumeServiceInitialized = false;

/**
 * Ensure volume service is initialized
 */
async function ensureVolumeServiceInitialized() {
  if (volumeServiceInitialized) {
    return getVolumeService();
  }

  await initializeVolumeService();
  volumeServiceInitialized = true;
  return getVolumeService();
}

// Validation schemas
const VolumeBackendEnum = z.enum(['docker', 'vm', 'daytona']);
const VolumeStatusEnum = z.enum(['creating', 'ready', 'attached', 'error', 'deleting']);

const ListVolumesQuerySchema = z.object({
  backend: z.string().optional(), // Comma-separated list of backends
  status: z.string().optional(),  // Comma-separated list of statuses
  search: z.string().optional(),
});

const CreateVolumeSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
  backend: VolumeBackendEnum.optional(),
  sizeGb: z.number().min(1).max(1000).optional(),
  format: z.enum(['ext4', 'xfs']).optional(),
  mountPath: z.string().optional(),
});

const AttachVolumeSchema = z.object({
  sandboxId: z.string().min(1),
});

/**
 * GET /api/volumes
 * List all volumes with optional filtering
 */
unifiedVolumes.get('/', zValidator('query', ListVolumesQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const service = await ensureVolumeServiceInitialized();

  // Parse backend filter
  let backends: VolumeBackend[] | undefined;
  if (query.backend) {
    backends = query.backend.split(',').filter((b): b is VolumeBackend =>
      ['docker', 'vm', 'daytona'].includes(b)
    );
  }

  // Parse status filter
  let status: VolumeStatus[] | undefined;
  if (query.status) {
    status = query.status.split(',').filter((s): s is VolumeStatus =>
      ['creating', 'ready', 'attached', 'error', 'deleting'].includes(s)
    );
  }

  try {
    const volumes = await service.list({
      backends,
      status,
      search: query.search,
    });

    const backendStatus = await service.getBackendStatus();

    return c.json({
      volumes,
      backends: backendStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list volumes';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/volumes/backends
 * Get backend availability status
 */
unifiedVolumes.get('/backends', async (c) => {
  const service = await ensureVolumeServiceInitialized();

  try {
    const backends = await service.getBackendStatus();
    return c.json(backends);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get backend status';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/volumes/:id
 * Get a specific volume by ID
 */
unifiedVolumes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const service = await ensureVolumeServiceInitialized();

  try {
    const volume = await service.get(id);

    if (!volume) {
      return c.json({ error: 'Volume not found' }, 404);
    }

    return c.json(volume);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get volume';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/volumes
 * Create a new volume
 */
unifiedVolumes.post('/', zValidator('json', CreateVolumeSchema), async (c) => {
  const body = c.req.valid('json');
  const service = await ensureVolumeServiceInitialized();

  try {
    const volume = await service.create(body);
    return c.json(volume, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create volume';
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /api/volumes/:id
 * Delete a volume
 */
unifiedVolumes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const service = await ensureVolumeServiceInitialized();

  try {
    await service.delete(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete volume';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/volumes/:id/attach
 * Attach a volume to a sandbox (VM volumes only)
 */
unifiedVolumes.post('/:id/attach', zValidator('json', AttachVolumeSchema), async (c) => {
  const id = c.req.param('id');
  const { sandboxId } = c.req.valid('json');
  const service = await ensureVolumeServiceInitialized();

  try {
    const volume = await service.attach(id, sandboxId);
    return c.json(volume);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to attach volume';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/volumes/:id/detach
 * Detach a volume from its sandbox (VM volumes only)
 */
unifiedVolumes.post('/:id/detach', async (c) => {
  const id = c.req.param('id');
  const service = await ensureVolumeServiceInitialized();

  try {
    const volume = await service.detach(id);
    return c.json(volume);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to detach volume';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/volumes/:id/files
 * List files in a volume
 */
unifiedVolumes.get('/:id/files', async (c) => {
  const id = c.req.param('id');
  const path = c.req.query('path') || '/';
  const service = await ensureVolumeServiceInitialized();

  try {
    const files = await service.listFiles(id, path);
    return c.json({ files, path });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list files';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/volumes/:id/files
 * Upload a file to a volume
 */
unifiedVolumes.post('/:id/files', async (c) => {
  const id = c.req.param('id');
  const service = await ensureVolumeServiceInitialized();

  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    const destPath = (formData.get('path') as string) || '/';

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await service.uploadFile(id, file.name, buffer, destPath);

    return c.json({ success: true, path: `${destPath}/${file.name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload file';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/volumes/:id/files/download
 * Download a file from a volume
 */
unifiedVolumes.get('/:id/files/download', async (c) => {
  const id = c.req.param('id');
  const filePath = c.req.query('path');
  const service = await ensureVolumeServiceInitialized();

  if (!filePath) {
    return c.json({ error: 'path query parameter is required' }, 400);
  }

  try {
    const content = await service.downloadFile(id, filePath);
    const fileName = filePath.split('/').pop() || 'download';

    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to download file';
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /api/volumes/:id/files
 * Delete a file from a volume
 */
unifiedVolumes.delete('/:id/files', async (c) => {
  const id = c.req.param('id');
  const filePath = c.req.query('path');
  const service = await ensureVolumeServiceInitialized();

  if (!filePath) {
    return c.json({ error: 'path query parameter is required' }, 400);
  }

  try {
    await service.deleteFile(id, filePath);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete file';
    return c.json({ error: message }, 500);
  }
});

export default unifiedVolumes;
