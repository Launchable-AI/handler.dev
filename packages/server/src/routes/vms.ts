/**
 * VM Routes - API endpoints for virtual machine management
 * Supports both cloud-hypervisor and Firecracker hypervisors
 */

import { Hono } from 'hono';
import { getCloudHypervisorService, initializeCloudHypervisorService } from '../services/hypervisor.js';
import { getFirecrackerService, initializeFirecrackerService } from '../services/firecracker.js';
import { CreateVmSchema, HypervisorType } from '../types/vm.js';

const vms = new Hono();

// Initialize hypervisor services
let cloudHypervisorInitialized = false;
let firecrackerInitialized = false;

async function ensureCloudHypervisorInitialized() {
  if (!cloudHypervisorInitialized) {
    await initializeCloudHypervisorService();
    cloudHypervisorInitialized = true;
  }
  return getCloudHypervisorService();
}

async function ensureFirecrackerInitialized() {
  if (!firecrackerInitialized) {
    await initializeFirecrackerService();
    firecrackerInitialized = true;
  }
  return getFirecrackerService();
}

/**
 * Get the appropriate hypervisor service based on type
 */
async function getService(hypervisorType: HypervisorType = 'cloud-hypervisor') {
  if (hypervisorType === 'firecracker') {
    return ensureFirecrackerInitialized();
  }
  return ensureCloudHypervisorInitialized();
}

// List all VMs (from both hypervisors)
vms.get('/', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const cloudHypervisorVms = hypervisor.listVms();

    // Try to get Firecracker VMs (may fail if not initialized)
    let firecrackerVms: ReturnType<typeof hypervisor.listVms> = [];
    try {
      const firecracker = await ensureFirecrackerInitialized();
      firecrackerVms = firecracker.listVms();
    } catch {
      // Firecracker not available, that's OK
    }

    return c.json([...cloudHypervisorVms, ...firecrackerVms]);
  } catch (error) {
    console.error('[VMs API] Failed to list VMs:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get VM stats
vms.get('/stats', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const stats = hypervisor.getStats();
    return c.json(stats);
  } catch (error) {
    console.error('[VMs API] Failed to get stats:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get network status
vms.get('/network', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const status = hypervisor.getNetworkStatus();
    return c.json(status);
  } catch (error) {
    console.error('[VMs API] Failed to get network status:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List available base images
vms.get('/base-images', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const images = hypervisor.listBaseImages();
    return c.json(images);
  } catch (error) {
    console.error('[VMs API] Failed to list base images:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a base image
vms.delete('/base-images/:name', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const name = c.req.param('name');
    await hypervisor.deleteBaseImage(name);
    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to delete base image:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Download a base image from URL with kernel/initrd
vms.post('/base-images/download', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const body = await c.req.json();
    const { name, imageUrl, kernelUrl, initrdUrl } = body;

    if (!name || !imageUrl || !kernelUrl || !initrdUrl) {
      return c.json({ error: 'name, imageUrl, kernelUrl, and initrdUrl are required' }, 400);
    }

    // Validate name format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return c.json({ error: 'Invalid image name format' }, 400);
    }

    // Set up SSE response
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          await hypervisor.downloadBaseImage(name, imageUrl, kernelUrl, initrdUrl, (phase, progress, message) => {
            sendEvent('progress', { phase, progress, message });
          });

          sendEvent('done', { name, success: true });
        } catch (error) {
          sendEvent('error', { error: String(error) });
        } finally {
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
  } catch (error) {
    console.error('[VMs API] Failed to download base image:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List all snapshots from all VMs
vms.get('/snapshots', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const snapshots = hypervisor.listAllSnapshots();
    return c.json(snapshots);
  } catch (error) {
    console.error('[VMs API] Failed to list all snapshots:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get SSH key for VMs
vms.get('/ssh-key', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const privateKey = hypervisor.getSshPrivateKey();
    if (!privateKey) {
      return c.json({ error: 'SSH key not found' }, 404);
    }
    return c.text(privateKey, 200, {
      'Content-Type': 'application/x-pem-file',
      'Content-Disposition': 'attachment; filename="vm_id_ed25519"',
    });
  } catch (error) {
    console.error('[VMs API] Failed to get SSH key:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get warmup status for a base image
vms.get('/warmup/:baseImage', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const baseImage = c.req.param('baseImage');
    const status = hypervisor.getWarmupStatus(baseImage);
    return c.json(status);
  } catch (error) {
    console.error('[VMs API] Failed to get warmup status:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get warmup logs for a base image
vms.get('/warmup/:baseImage/logs', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const baseImage = c.req.param('baseImage');
    const lines = parseInt(c.req.query('lines') || '100', 10);

    const logs = hypervisor.getWarmupLogs(baseImage, lines);
    return c.json({ logs: logs || '' });
  } catch (error) {
    console.error('[VMs API] Failed to get warmup logs:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Trigger warmup for a base image
vms.post('/warmup/:baseImage', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const baseImage = c.req.param('baseImage');

    // Start warmup in background
    hypervisor.warmupBaseImage(baseImage).catch(err => {
      console.error(`[VMs API] Warmup failed for ${baseImage}:`, err);
    });

    return c.json({ message: 'Warmup started', baseImage });
  } catch (error) {
    console.error('[VMs API] Failed to start warmup:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Clear warmup status (dismiss error)
vms.delete('/warmup/:baseImage', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const baseImage = c.req.param('baseImage');
    hypervisor.clearWarmupStatus(baseImage);
    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to clear warmup status:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Create a new VM
vms.post('/', async (c) => {
  try {
    const body = await c.req.json();

    // Validate request
    const parseResult = CreateVmSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json({ error: parseResult.error.format() }, 400);
    }

    const config = parseResult.data;
    const hypervisorType = config.hypervisor || 'cloud-hypervisor';

    // Get the appropriate service based on hypervisor type
    const service = await getService(hypervisorType);

    const vm = await service.createVm({
      name: config.name,
      hypervisor: hypervisorType,
      baseImage: config.baseImage,
      fromSnapshot: config.fromSnapshot,
      vcpus: config.vcpus,
      memoryMb: config.memoryMb,
      diskGb: config.diskGb,
      portMappings: config.ports,
      volumes: config.volumes,
      autoStart: config.autoStart,
    });

    return c.json(vm, 201);
  } catch (error) {
    console.error('[VMs API] Failed to create VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get a specific VM (checks both hypervisors)
vms.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Check cloud-hypervisor first
    const hypervisor = await ensureCloudHypervisorInitialized();
    let vm = hypervisor.getVm(id);

    // If not found, check Firecracker
    if (!vm) {
      try {
        const firecracker = await ensureFirecrackerInitialized();
        vm = firecracker.getVm(id);
      } catch {
        // Firecracker not available
      }
    }

    if (!vm) {
      return c.json({ error: `VM ${id} not found` }, 404);
    }

    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to get VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get VM boot logs (detects hypervisor by ID prefix)
vms.get('/:id/logs', async (c) => {
  try {
    const id = c.req.param('id');
    const lines = parseInt(c.req.query('lines') || '100', 10);

    let logs: string | null = null;
    let logPath: string | undefined;

    // Firecracker VMs have 'fc-' prefix
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      logs = firecracker.getVmBootLogs(id, lines);
      logPath = firecracker.getVmLogPath(id);
    } else {
      const hypervisor = await ensureCloudHypervisorInitialized();
      logs = hypervisor.getVmBootLogs(id, lines);
      logPath = hypervisor.getVmLogPath(id);
    }

    if (logs === null) {
      return c.json({ error: `VM ${id} not found or no logs available` }, 404);
    }

    return c.json({ logs, logPath });
  } catch (error) {
    console.error('[VMs API] Failed to get VM logs:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get SSH info for a VM (detects hypervisor by ID prefix)
vms.get('/:id/ssh', async (c) => {
  try {
    const id = c.req.param('id');

    // Firecracker VMs have 'fc-' prefix
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      const sshInfo = firecracker.getSshInfo(id);
      if (!sshInfo) {
        return c.json({ error: `VM ${id} not found` }, 404);
      }
      return c.json(sshInfo);
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    const sshInfo = hypervisor.getSshInfo(id);
    if (!sshInfo) {
      return c.json({ error: `VM ${id} not found` }, 404);
    }

    return c.json(sshInfo);
  } catch (error) {
    console.error('[VMs API] Failed to get SSH info:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Start a VM (detects hypervisor by ID prefix)
vms.post('/:id/start', async (c) => {
  try {
    const id = c.req.param('id');

    // Firecracker VMs have 'fc-' prefix
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      const vm = await firecracker.startVm(id);
      return c.json(vm);
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    const vm = await hypervisor.startVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to start VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Stop a VM (detects hypervisor by ID prefix)
vms.post('/:id/stop', async (c) => {
  try {
    const id = c.req.param('id');

    // Firecracker VMs have 'fc-' prefix
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      const vm = await firecracker.stopVm(id);
      return c.json(vm);
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    const vm = await hypervisor.stopVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to stop VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Pause a VM (detects hypervisor by ID prefix)
vms.post('/:id/pause', async (c) => {
  try {
    const id = c.req.param('id');

    // Firecracker VMs have 'fc-' prefix
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      await firecracker.pauseVm(id);
      const vm = firecracker.getVm(id);
      return c.json(vm);
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    await hypervisor.pauseVm(id);
    const vm = hypervisor.getVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to pause VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a VM (detects hypervisor by ID prefix)
vms.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Firecracker VMs have 'fc-' prefix
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      await firecracker.deleteVm(id);
      return c.json({ success: true, message: `VM ${id} deleted` });
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    await hypervisor.deleteVm(id);
    return c.json({ success: true, message: `VM ${id} deleted` });
  } catch (error) {
    console.error('[VMs API] Failed to delete VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Update VM port shortcuts
vms.patch('/:id/ports', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { ports } = body as { ports: Array<{ container: number; host: number }> };

    if (!Array.isArray(ports)) {
      return c.json({ error: 'ports must be an array' }, 400);
    }

    // Get the appropriate service
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      const vm = firecracker.updateVmPorts(id, ports);
      return c.json(vm);
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    const vm = hypervisor.updateVmPorts(id, ports);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to update VM ports:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List snapshots for a VM
vms.get('/:id/snapshots', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const id = c.req.param('id');

    const snapshots = hypervisor.listVmSnapshots(id);
    return c.json(snapshots);
  } catch (error) {
    console.error('[VMs API] Failed to list snapshots:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Create a snapshot of a VM
vms.post('/:id/snapshots', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const id = c.req.param('id');
    const body = await c.req.json();
    const name = body.name || `Snapshot ${new Date().toLocaleString()}`;

    const snapshot = await hypervisor.createUserVmSnapshot(id, name);
    return c.json(snapshot, 201);
  } catch (error) {
    console.error('[VMs API] Failed to create snapshot:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a snapshot
vms.delete('/:id/snapshots/:snapshotId', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const id = c.req.param('id');
    const snapshotId = c.req.param('snapshotId');

    hypervisor.deleteVmSnapshot(id, snapshotId);
    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to delete snapshot:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get quick launch default snapshot
vms.get('/quick-launch/default', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const defaultSnapshot = hypervisor.getQuickLaunchDefault();
    return c.json(defaultSnapshot || { vmId: null, snapshotId: null });
  } catch (error) {
    console.error('[VMs API] Failed to get quick launch default:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Set quick launch default snapshot
vms.put('/quick-launch/default', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    const body = await c.req.json();
    const { vmId, snapshotId } = body;

    if (vmId && snapshotId) {
      hypervisor.setQuickLaunchDefault(vmId, snapshotId);
    } else {
      hypervisor.clearQuickLaunchDefault();
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to set quick launch default:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Clear quick launch default
vms.delete('/quick-launch/default', async (c) => {
  try {
    const hypervisor = await ensureCloudHypervisorInitialized();
    hypervisor.clearQuickLaunchDefault();
    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to clear quick launch default:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List files in a VM directory (via SSH)
vms.get('/:id/files', async (c) => {
  try {
    const id = c.req.param('id');
    const path = c.req.query('path') || '/home/agent';

    // Get the appropriate service
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      const files = await firecracker.listVmFiles(id, path);
      return c.json({ files, path });
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    const files = await hypervisor.listVmFiles(id, path);
    return c.json({ files, path });
  } catch (error) {
    console.error('[VMs API] Failed to list VM files:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Upload a file to a VM (via SCP)
vms.post('/:id/files/upload', async (c) => {
  try {
    const id = c.req.param('id');
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const destPath = formData.get('path') as string || '/home/agent';

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    // Get file content as buffer
    const arrayBuffer = await file.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    // Get the appropriate service
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      await firecracker.uploadFileToVm(id, file.name, content, destPath);
      return c.json({ success: true, path: `${destPath}/${file.name}` });
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    await hypervisor.uploadFileToVm(id, file.name, content, destPath);
    return c.json({ success: true, path: `${destPath}/${file.name}` });
  } catch (error) {
    console.error('[VMs API] Failed to upload file to VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Download a file from a VM (via SCP)
vms.get('/:id/files/download', async (c) => {
  try {
    const id = c.req.param('id');
    const filePath = c.req.query('path');

    if (!filePath) {
      return c.json({ error: 'File path is required' }, 400);
    }

    // Get the appropriate service
    let content: Buffer;
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      content = await firecracker.downloadFileFromVm(id, filePath);
    } else {
      const hypervisor = await ensureCloudHypervisorInitialized();
      content = await hypervisor.downloadFileFromVm(id, filePath);
    }

    const fileName = filePath.split('/').pop() || 'file';
    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('[VMs API] Failed to download file from VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a file in a VM (via SSH)
vms.delete('/:id/files', async (c) => {
  try {
    const id = c.req.param('id');
    const filePath = c.req.query('path');

    if (!filePath) {
      return c.json({ error: 'File path is required' }, 400);
    }

    // Get the appropriate service
    if (id.startsWith('fc-')) {
      const firecracker = await ensureFirecrackerInitialized();
      await firecracker.deleteVmFile(id, filePath);
      return c.json({ success: true });
    }

    const hypervisor = await ensureCloudHypervisorInitialized();
    await hypervisor.deleteVmFile(id, filePath);
    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to delete file in VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

export default vms;
