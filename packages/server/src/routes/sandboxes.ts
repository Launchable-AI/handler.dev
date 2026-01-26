/**
 * Unified Sandboxes API Routes
 *
 * Provides a single API for managing all compute environments:
 * - Docker containers
 * - Cloud-Hypervisor VMs
 * - Firecracker VMs
 * - Daytona cloud workspaces
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSandboxService, initializeSandboxService } from '../services/sandbox/index.js';
import { getCloudHypervisorService, initializeCloudHypervisorService } from '../services/hypervisor.js';
import { getFirecrackerService, initializeFirecrackerService } from '../services/firecracker.js';
import { getDaytonaService, initializeDaytonaService } from '../services/daytona.js';
import * as dockerService from '../services/docker.js';
import * as containerBuilder from '../services/container-builder.js';
import type { SandboxBackend, SandboxStatus } from '../types/sandbox.js';

const sandboxes = new Hono();

// Lazy initialization state
let sandboxServiceInitialized = false;

/**
 * Ensure sandbox service is initialized with all available backends
 */
async function ensureSandboxServiceInitialized() {
  if (sandboxServiceInitialized) {
    return getSandboxService();
  }

  // Initialize backends
  let hypervisor = null;
  let firecracker = null;
  let daytona = null;

  // Cloud-Hypervisor
  try {
    await initializeCloudHypervisorService();
    hypervisor = getCloudHypervisorService();
  } catch (err) {
    console.log('[SandboxRoutes] Cloud-Hypervisor not available:', err instanceof Error ? err.message : 'unknown');
  }

  // Firecracker
  try {
    await initializeFirecrackerService();
    firecracker = getFirecrackerService();
  } catch (err) {
    console.log('[SandboxRoutes] Firecracker not available:', err instanceof Error ? err.message : 'unknown');
  }

  // Daytona
  try {
    await initializeDaytonaService();
    const daytonaService = getDaytonaService();
    if (await daytonaService.isAvailable()) {
      daytona = daytonaService;
    }
  } catch (err) {
    console.log('[SandboxRoutes] Daytona not available:', err instanceof Error ? err.message : 'unknown');
  }

  // Initialize sandbox service with available backends
  await initializeSandboxService({
    hypervisor: hypervisor ?? undefined,
    firecracker: firecracker ?? undefined,
    daytona: daytona ?? undefined,
  });

  sandboxServiceInitialized = true;
  return getSandboxService();
}

// Validation schemas
const SandboxBackendEnum = z.enum(['docker', 'cloud-hypervisor', 'firecracker', 'daytona']);
const SandboxStatusEnum = z.enum([
  'creating', 'starting', 'running', 'stopping',
  'stopped', 'paused', 'error', 'archived', 'building'
]);

const ListSandboxesQuerySchema = z.object({
  backend: z.string().optional(), // Comma-separated list of backends
  status: z.string().optional(),  // Comma-separated list of statuses
  search: z.string().optional(),
});

const CreateSandboxSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
  backend: SandboxBackendEnum,
  image: z.string().min(1),

  // Optional resources
  vcpus: z.number().min(1).max(32).optional(),
  memoryMb: z.number().min(256).max(65536).optional(),
  diskGb: z.number().min(1).max(1000).optional(),

  // Ports
  ports: z.array(z.object({
    container: z.number().min(1).max(65535),
    host: z.number().min(1).max(65535),
    protocol: z.string().optional(),
  })).optional(),

  // Docker-specific options
  dockerOptions: z.object({
    dockerfile: z.string().optional(),
    volumes: z.array(z.object({
      name: z.string(),
      mountPath: z.string(),
    })).optional(),
    env: z.record(z.string()).optional(),
    enableSsh: z.boolean().optional(),
  }).optional(),

  // VM-specific options
  vmOptions: z.object({
    hypervisor: z.enum(['cloud-hypervisor', 'firecracker']).optional(),
    networkMode: z.enum(['bridged', 'nat']).optional(),
    volumes: z.array(z.object({
      id: z.string(),
      mountPath: z.string(),
    })).optional(),
  }).optional(),

  // Daytona-specific options
  daytonaOptions: z.object({
    sizeClass: z.enum(['small', 'medium', 'large']).optional(),
    language: z.string().optional(),
    volumes: z.array(z.object({
      name: z.string(),
      mountPath: z.string(),
    })).optional(),
  }).optional(),
});

/**
 * GET /api/sandboxes
 * List all sandboxes with optional filtering
 *
 * Query params:
 * - backend: Comma-separated list of backends (docker,cloud-hypervisor,firecracker,daytona)
 * - status: Comma-separated list of statuses (running,stopped,error,etc.)
 * - search: Search term for name/image
 */
sandboxes.get('/', zValidator('query', ListSandboxesQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const service = await ensureSandboxServiceInitialized();

  // Parse backend filter
  let backends: SandboxBackend[] | undefined;
  if (query.backend) {
    backends = query.backend.split(',').filter((b): b is SandboxBackend =>
      ['docker', 'cloud-hypervisor', 'firecracker', 'daytona'].includes(b)
    );
  }

  // Parse status filter
  let status: SandboxStatus[] | undefined;
  if (query.status) {
    status = query.status.split(',').filter((s): s is SandboxStatus =>
      ['creating', 'starting', 'running', 'stopping', 'stopped', 'paused', 'error', 'archived', 'building'].includes(s)
    );
  }

  try {
    const result = await service.list({
      backends,
      status,
      search: query.search,
    });

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list sandboxes';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/sandboxes/backends
 * Get backend availability status
 */
sandboxes.get('/backends', async (c) => {
  const service = await ensureSandboxServiceInitialized();

  try {
    const backends = await service.getBackendStatus();
    return c.json(backends);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get backend status';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/sandboxes/:id
 * Get a specific sandbox by ID
 */
sandboxes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.get(id);

    if (!sandbox) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    return c.json(sandbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get sandbox';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/sandboxes
 * Create a new sandbox
 */
sandboxes.post('/', zValidator('json', CreateSandboxSchema), async (c) => {
  const body = c.req.valid('json');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.create(body);
    return c.json(sandbox, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create sandbox';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/start
 * Start a stopped sandbox
 */
sandboxes.post('/:id/start', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.start(id);
    return c.json(sandbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start sandbox';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/stop
 * Stop a running sandbox
 */
sandboxes.post('/:id/stop', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.stop(id);
    return c.json(sandbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop sandbox';
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /api/sandboxes/:id
 * Delete a sandbox
 */
sandboxes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    await service.delete(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete sandbox';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/sandboxes/:id/logs
 * Get sandbox logs
 */
sandboxes.get('/:id/logs', async (c) => {
  const id = c.req.param('id');
  const tail = parseInt(c.req.query('tail') || '200', 10);
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.get(id);
    if (!sandbox) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    let logs = '';

    if (sandbox.backend === 'docker') {
      // Docker container logs
      const containerId = id.startsWith('docker-') ? id.slice(7) : id;
      logs = await dockerService.getContainerLogs(containerId, { tail, timestamps: true });
    } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
      // VM logs
      const vmId = id.startsWith('vm-') || id.startsWith('fc-') ? id : `vm-${id}`;
      if (sandbox.backend === 'cloud-hypervisor') {
        const hypervisor = service.getHypervisorService();
        if (hypervisor) {
          const result = hypervisor.getVmBootLogs(vmId.replace('vm-', ''));
          logs = result || '';
        }
      } else {
        const firecracker = service.getFirecrackerService();
        if (firecracker) {
          const result = firecracker.getVmBootLogs(vmId.replace('fc-', ''));
          logs = result || '';
        }
      }
    } else if (sandbox.backend === 'daytona') {
      // Daytona - logs not supported directly, return info message
      logs = '[Daytona workspaces: Use SSH to view logs directly on the workspace]';
    }

    return c.json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get sandbox logs';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/sandboxes/:id/logs/stream
 * Stream sandbox logs via SSE
 */
sandboxes.get('/:id/logs/stream', async (c) => {
  const id = c.req.param('id');
  const tail = parseInt(c.req.query('tail') || '100', 10);
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.get(id);
    if (!sandbox) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    // Only Docker supports streaming for now
    if (sandbox.backend !== 'docker') {
      return c.json({ error: 'Log streaming not supported for this backend' }, 400);
    }

    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    let cleanup: (() => void) | null = null;
    let closed = false;

    const sendEvent = async (event: string, data: string) => {
      if (closed) return;
      try {
        await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        // Stream closed
      }
    };

    const containerId = id.startsWith('docker-') ? id.slice(7) : id;

    // Start streaming logs
    dockerService.streamContainerLogs(
      containerId,
      (line) => sendEvent('log', line),
      { tail }
    ).then((cleanupFn) => {
      cleanup = cleanupFn;
    }).catch((error) => {
      sendEvent('error', error instanceof Error ? error.message : 'Unknown error');
    });

    // Clean up after 5 minutes or when client disconnects
    const timeout = setTimeout(async () => {
      closed = true;
      cleanup?.();
      await sendEvent('done', 'Timeout - stream closed after 5 minutes');
      await writer.close();
    }, 5 * 60 * 1000);

    c.req.raw.signal.addEventListener('abort', () => {
      closed = true;
      cleanup?.();
      clearTimeout(timeout);
      writer.close().catch(() => {});
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stream sandbox logs';
    return c.json({ error: message }, 500);
  }
});

/**
 * GET /api/sandboxes/:id/ssh-key
 * Download SSH private key for the sandbox
 */
sandboxes.get('/:id/ssh-key', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.get(id);
    if (!sandbox) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    let privateKey: string;

    if (sandbox.backend === 'docker') {
      // Docker uses shared SSH key
      privateKey = await containerBuilder.getPrivateKey();
    } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
      // VMs use their own SSH key
      const vmService = sandbox.backend === 'cloud-hypervisor'
        ? service.getHypervisorService()
        : service.getFirecrackerService();

      if (!vmService) {
        return c.json({ error: 'VM service not available' }, 500);
      }

      // VMs share a key stored in the data directory
      const fs = await import('fs');
      const path = await import('path');
      const dataDir = process.env.DATA_DIR || './data';
      const keyPath = path.join(dataDir, 'ssh', 'id_ed25519');

      if (!fs.existsSync(keyPath)) {
        return c.json({ error: 'SSH key not found' }, 404);
      }
      privateKey = fs.readFileSync(keyPath, 'utf-8');
    } else if (sandbox.backend === 'daytona') {
      // Daytona workspaces may have their own key in backendMeta
      const daytonaMeta = sandbox.backendMeta as { type: 'daytona'; sshKey?: string } | undefined;
      if (daytonaMeta?.sshKey) {
        privateKey = daytonaMeta.sshKey;
      } else {
        return c.json({ error: 'SSH key not available for this Daytona workspace' }, 404);
      }
    } else {
      return c.json({ error: 'SSH key not supported for this backend' }, 400);
    }

    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', `attachment; filename="${sandbox.name.replace(/[^a-z0-9]/gi, '_')}_key.pem"`);

    return c.body(privateKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get SSH key';
    return c.json({ error: message }, 500);
  }
});

export default sandboxes;
