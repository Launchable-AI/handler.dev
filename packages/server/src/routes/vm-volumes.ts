/**
 * VM Volumes API Routes
 *
 * Manages standalone persistent volumes for Firecracker VMs.
 * These volumes persist independently of VMs and can be attached/detached.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getVmVolumeService, initializeVmVolumeService } from '../services/vm-volumes.js';
import { CreateVmVolumeSchema } from '../types/vm.js';

const vmVolumes = new Hono();

// Initialize volume service lazily
let volumeServiceInitialized = false;

async function ensureVolumeServiceInitialized() {
  if (!volumeServiceInitialized) {
    await initializeVmVolumeService();
    volumeServiceInitialized = true;
  }
  return getVmVolumeService();
}

// List all VM volumes
vmVolumes.get('/', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumes = volumeService.listVolumes();
    return c.json(volumes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get a specific volume
vmVolumes.get('/:id', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volume = volumeService.getVolume(c.req.param('id'));
    if (!volume) {
      return c.json({ error: 'Volume not found' }, 404);
    }
    return c.json(volume);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Create a new volume
vmVolumes.post('/', zValidator('json', CreateVmVolumeSchema), async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const config = c.req.valid('json');
    const volume = await volumeService.createVolume({
      name: config.name,
      sizeGb: config.sizeGb ?? 10,
      format: config.format ?? 'ext4',
      mountPath: config.mountPath,
    });
    return c.json(volume, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Delete a volume
vmVolumes.delete('/:id', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    await volumeService.deleteVolume(c.req.param('id'));
    return c.json({ success: true, message: 'Volume deleted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Attach a volume to a VM
vmVolumes.post('/:id/attach', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumeId = c.req.param('id');
    const { vmId } = await c.req.json<{ vmId: string }>();

    if (!vmId) {
      return c.json({ error: 'vmId is required' }, 400);
    }

    volumeService.attachVolume(volumeId, vmId);
    const volume = volumeService.getVolume(volumeId);
    return c.json(volume);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Detach a volume from a VM
vmVolumes.post('/:id/detach', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumeId = c.req.param('id');

    volumeService.detachVolume(volumeId);
    const volume = volumeService.getVolume(volumeId);
    return c.json(volume);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Resize a volume
vmVolumes.post('/:id/resize', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumeId = c.req.param('id');
    const { sizeGb } = await c.req.json<{ sizeGb: number }>();

    if (!sizeGb || typeof sizeGb !== 'number') {
      return c.json({ error: 'sizeGb is required and must be a number' }, 400);
    }

    const volume = await volumeService.resizeVolume(volumeId, sizeGb);
    return c.json(volume);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get volumes attached to a specific VM
vmVolumes.get('/vm/:vmId', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumes = volumeService.getVmVolumes(c.req.param('vmId'));
    return c.json(volumes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// ========== File Operations ==========

// List files in a volume
vmVolumes.get('/:id/files', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumeId = c.req.param('id');
    const dirPath = c.req.query('path') || '/';

    const files = await volumeService.listFiles(volumeId, dirPath);
    return c.json({ files, path: dirPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Upload a file to a volume
vmVolumes.post('/:id/files/upload', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumeId = c.req.param('id');

    const formData = await c.req.formData();
    const file = formData.get('file');
    const destPath = (formData.get('path') as string) || '/';

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await volumeService.uploadFile(volumeId, file.name, buffer, destPath);

    return c.json({ success: true, path: `${destPath}/${file.name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Download a file from a volume
vmVolumes.get('/:id/files/download', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumeId = c.req.param('id');
    const filePath = c.req.query('path');

    if (!filePath) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }

    const content = await volumeService.downloadFile(volumeId, filePath);
    const fileName = filePath.split('/').pop() || 'download';

    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Delete a file from a volume
vmVolumes.delete('/:id/files', async (c) => {
  try {
    const volumeService = await ensureVolumeServiceInitialized();
    const volumeId = c.req.param('id');
    const filePath = c.req.query('path');

    if (!filePath) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }

    await volumeService.deleteFile(volumeId, filePath);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

export default vmVolumes;
