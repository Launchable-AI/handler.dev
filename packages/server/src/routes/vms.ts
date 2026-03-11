/**
 * VM Routes - API endpoints for virtual machine management
 * Supports Firecracker hypervisor
 */

import { Hono } from 'hono';
import { getFirecrackerService, initializeFirecrackerService } from '../services/firecracker.js';
import { getDaytonaService, initializeDaytonaService } from '../services/daytona.js';
import { CreateVmSchema, HypervisorType } from '../types/vm.js';

const vms = new Hono();

// Initialize hypervisor services
let firecrackerInitialized = false;
let daytonaInitialized = false;

async function ensureFirecrackerInitialized() {
  if (!firecrackerInitialized) {
    await initializeFirecrackerService();
    firecrackerInitialized = true;
  }
  return getFirecrackerService();
}

async function ensureDaytonaInitialized() {
  if (!daytonaInitialized) {
    try {
      await initializeDaytonaService();
      daytonaInitialized = true;
    } catch {
      // Daytona may not be configured, that's OK
      return null;
    }
  }
  return getDaytonaService();
}

/**
 * Get the local hypervisor service (Firecracker)
 * Note: Daytona is handled separately and should not use this function
 */
async function getLocalHypervisorService() {
  return ensureFirecrackerInitialized();
}

// List all VMs (from all backends)
vms.get('/', async (c) => {
  try {
    // Get Firecracker VMs
    let firecrackerVms: ReturnType<ReturnType<typeof getFirecrackerService>['listVms']> = [];
    try {
      const firecracker = await ensureFirecrackerInitialized();
      firecrackerVms = firecracker.listVms();
    } catch {
      // Firecracker not available, that's OK
    }

    // Try to get Daytona workspaces (may fail if not configured)
    let daytonaVms: typeof firecrackerVms = [];
    try {
      const daytona = await ensureDaytonaInitialized();
      if (daytona && await daytona.isAvailable()) {
        daytonaVms = await daytona.listVms();
      }
    } catch {
      // Daytona not available, that's OK
    }

    return c.json([...firecrackerVms, ...daytonaVms]);
  } catch (error) {
    console.error('[VMs API] Failed to list VMs:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List available base images
vms.get('/base-images', async (c) => {
  try {
    const firecracker = await ensureFirecrackerInitialized();
    const images = firecracker.listBaseImages();
    return c.json(images);
  } catch (error) {
    console.error('[VMs API] Failed to list base images:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a base image (use /api/image-builder for full image management)
vms.delete('/base-images/:name', async (c) => {
  return c.json({ error: 'Use the image-builder API for base image management' }, 501);
});

// Download a base image (use /api/image-builder for full image management)
vms.post('/base-images/download', async (c) => {
  return c.json({ error: 'Use the image-builder API for base image downloads' }, 501);
});

// List all snapshots from all VMs
vms.get('/snapshots', async (c) => {
  try {
    const allSnapshots = [];

    // Get Firecracker snapshots
    try {
      const firecracker = await ensureFirecrackerInitialized();
      // Firecracker doesn't have listAllSnapshots, so iterate over VMs
      const vms = firecracker.listVms();
      for (const vm of vms) {
        const snapshots = firecracker.listVmSnapshots(vm.id);
        allSnapshots.push(...snapshots.map(s => ({
          ...s,
          vmName: vm.name,
        })));
      }
    } catch {
      // Firecracker may not be available
    }

    return c.json(allSnapshots);
  } catch (error) {
    console.error('[VMs API] Failed to list all snapshots:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get SSH key for VMs
vms.get('/ssh-key', async (c) => {
  try {
    const firecracker = await ensureFirecrackerInitialized();
    const privateKey = firecracker.getSshPrivateKey();
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

    // Auto-detect hypervisor type from snapshot if creating from snapshot
    let hypervisorType: HypervisorType = config.hypervisor || 'firecracker';
    if (config.fromSnapshot?.vmId) {
      // Infer hypervisor type from the source VM's ID prefix
      if (config.fromSnapshot.vmId.startsWith('daytona-')) {
        hypervisorType = 'daytona';
      } else {
        hypervisorType = 'firecracker';
      }
    }

    // Handle Daytona backend separately
    if (hypervisorType === 'daytona') {
      const daytona = await ensureDaytonaInitialized();
      if (!daytona) {
        return c.json({ error: 'Daytona backend is not configured' }, 400);
      }

      // Parse language from baseImage (format: "daytona/python" or just "python")
      let language: 'python' | 'typescript' | 'javascript' = 'python';
      if (config.baseImage) {
        const imgLower = config.baseImage.toLowerCase();
        if (imgLower.includes('typescript')) language = 'typescript';
        else if (imgLower.includes('javascript') || imgLower.includes('node')) language = 'javascript';
      }

      const vm = await daytona.createVm({
        name: config.name,
        language,
        sizeClass: config.daytonaSizeClass || 'small',
        autoStopInterval: 15, // 15 minutes default
        volumes: config.daytonaVolumes,
      });

      return c.json(vm, 201);
    }

    // Get the local hypervisor service (Firecracker)
    // Note: Daytona is handled above in a separate code path
    const service = await getLocalHypervisorService();

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

// Get a specific VM (checks all backends)
vms.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Check Daytona first if ID has daytona prefix
    if (id.startsWith('daytona-')) {
      try {
        const daytona = await ensureDaytonaInitialized();
        if (daytona) {
          const vm = await daytona.getVm(id);
          if (vm) return c.json(vm);
        }
      } catch {
        // Daytona not available
      }
      return c.json({ error: `VM ${id} not found` }, 404);
    }

    // Check Firecracker
    try {
      const firecracker = await ensureFirecrackerInitialized();
      const vm = firecracker.getVm(id);
      if (vm) return c.json(vm);
    } catch {
      // Firecracker not available
    }

    return c.json({ error: `VM ${id} not found` }, 404);
  } catch (error) {
    console.error('[VMs API] Failed to get VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get VM boot logs
vms.get('/:id/logs', async (c) => {
  try {
    const id = c.req.param('id');
    const lines = parseInt(c.req.query('lines') || '100', 10);

    const firecracker = await ensureFirecrackerInitialized();
    const logs = firecracker.getVmBootLogs(id, lines);
    const logPath = firecracker.getVmLogPath(id);

    if (logs === null) {
      return c.json({ error: `VM ${id} not found or no logs available` }, 404);
    }

    return c.json({ logs, logPath });
  } catch (error) {
    console.error('[VMs API] Failed to get VM logs:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get SSH info for a VM
vms.get('/:id/ssh', async (c) => {
  try {
    const id = c.req.param('id');

    // Daytona workspaces have 'daytona-' prefix
    if (id.startsWith('daytona-')) {
      const daytona = await ensureDaytonaInitialized();
      if (!daytona) {
        return c.json({ error: 'Daytona backend is not configured' }, 400);
      }
      const sshInfo = await daytona.getSshInfo(id);
      if (!sshInfo) {
        return c.json({ error: `Workspace ${id} not found` }, 404);
      }
      return c.json(sshInfo);
    }

    // Firecracker VMs
    const firecracker = await ensureFirecrackerInitialized();
    const sshInfo = firecracker.getSshInfo(id);
    if (!sshInfo) {
      return c.json({ error: `VM ${id} not found` }, 404);
    }
    return c.json(sshInfo);
  } catch (error) {
    console.error('[VMs API] Failed to get SSH info:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Start a VM
vms.post('/:id/start', async (c) => {
  try {
    const id = c.req.param('id');

    // Daytona workspaces have 'daytona-' prefix
    if (id.startsWith('daytona-')) {
      const daytona = await ensureDaytonaInitialized();
      if (!daytona) {
        return c.json({ error: 'Daytona backend is not configured' }, 400);
      }
      const vm = await daytona.startVm(id);
      return c.json(vm);
    }

    // Firecracker VMs
    const firecracker = await ensureFirecrackerInitialized();
    const vm = await firecracker.startVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to start VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Stop a VM
vms.post('/:id/stop', async (c) => {
  try {
    const id = c.req.param('id');

    // Daytona workspaces have 'daytona-' prefix
    if (id.startsWith('daytona-')) {
      const daytona = await ensureDaytonaInitialized();
      if (!daytona) {
        return c.json({ error: 'Daytona backend is not configured' }, 400);
      }
      const vm = await daytona.stopVm(id);
      return c.json(vm);
    }

    // Firecracker VMs
    const firecracker = await ensureFirecrackerInitialized();
    const vm = await firecracker.stopVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to stop VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Pause a VM
vms.post('/:id/pause', async (c) => {
  try {
    const id = c.req.param('id');

    const firecracker = await ensureFirecrackerInitialized();
    await firecracker.pauseVm(id);
    const vm = firecracker.getVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to pause VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a VM
vms.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Daytona workspaces have 'daytona-' prefix
    if (id.startsWith('daytona-')) {
      const daytona = await ensureDaytonaInitialized();
      if (!daytona) {
        return c.json({ error: 'Daytona backend is not configured' }, 400);
      }
      await daytona.deleteVm(id);
      return c.json({ success: true, message: `Workspace ${id} deleted` });
    }

    // Firecracker VMs
    const firecracker = await ensureFirecrackerInitialized();
    await firecracker.deleteVm(id);
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

    // Get the Firecracker service
    const firecracker = await ensureFirecrackerInitialized();
    const vm = firecracker.updateVmPorts(id, ports);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to update VM ports:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List snapshots for a VM
vms.get('/:id/snapshots', async (c) => {
  try {
    const id = c.req.param('id');

    const firecracker = await ensureFirecrackerInitialized();
    const snapshots = firecracker.listVmSnapshots(id);
    return c.json(snapshots);
  } catch (error) {
    console.error('[VMs API] Failed to list snapshots:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Create a snapshot of a VM
vms.post('/:id/snapshots', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const name = body.name || `Snapshot ${new Date().toLocaleString()}`;

    const firecracker = await ensureFirecrackerInitialized();
    const snapshot = await firecracker.createSnapshot(id, name);
    return c.json(snapshot, 201);
  } catch (error) {
    console.error('[VMs API] Failed to create snapshot:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a snapshot
vms.delete('/:id/snapshots/:snapshotId', async (c) => {
  try {
    const id = c.req.param('id');
    const snapshotId = c.req.param('snapshotId');

    const firecracker = await ensureFirecrackerInitialized();
    firecracker.deleteVmSnapshot(id, snapshotId);
    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to delete snapshot:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Rollback VM to a snapshot (same VM, restores disk and can restore memory on start)
vms.post('/:id/snapshots/:snapshotId/rollback', async (c) => {
  try {
    const id = c.req.param('id');
    const snapshotId = c.req.param('snapshotId');

    const firecracker = await ensureFirecrackerInitialized();
    const vm = await firecracker.rollbackToSnapshot(id, snapshotId);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to rollback to snapshot:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Promote snapshot to a base image
vms.post('/:id/snapshots/:snapshotId/promote', async (c) => {
  try {
    const id = c.req.param('id');
    const snapshotId = c.req.param('snapshotId');
    const body = await c.req.json();
    const imageName = body.imageName;

    if (!imageName || typeof imageName !== 'string') {
      return c.json({ error: 'imageName is required' }, 400);
    }

    const firecracker = await ensureFirecrackerInitialized();
    const result = await firecracker.promoteSnapshotToImage(id, snapshotId, imageName);
    return c.json(result, 201);
  } catch (error) {
    console.error('[VMs API] Failed to promote snapshot:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List files in a VM directory (via SSH)
vms.get('/:id/files', async (c) => {
  try {
    const id = c.req.param('id');
    const path = c.req.query('path') || '/home/agent';

    const firecracker = await ensureFirecrackerInitialized();
    const files = await firecracker.listVmFiles(id, path);
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

    const firecracker = await ensureFirecrackerInitialized();
    await firecracker.uploadFileToVm(id, file.name, content, destPath);
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

    const firecracker = await ensureFirecrackerInitialized();
    const content = await firecracker.downloadFileFromVm(id, filePath);

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

    const firecracker = await ensureFirecrackerInitialized();
    await firecracker.deleteVmFile(id, filePath);
    return c.json({ success: true });
  } catch (error) {
    console.error('[VMs API] Failed to delete file in VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

export default vms;
