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
import { getSandboxService, initializeSandboxService, resetSandboxService } from '../services/sandbox/index.js';
import { getCloudHypervisorService, initializeCloudHypervisorService } from '../services/hypervisor.js';
import { getFirecrackerService, initializeFirecrackerService } from '../services/firecracker.js';
import { getDaytonaService, initializeDaytonaService } from '../services/daytona.js';
import { getAwsService, initializeAwsService } from '../services/aws.js';
import * as dockerService from '../services/docker.js';
import * as containerBuilder from '../services/container-builder.js';
import type { SandboxBackend, SandboxStatus } from '../types/sandbox.js';

const sandboxes = new Hono();

// Lazy initialization state
let sandboxServiceInitialized = false;

/**
 * Reset the sandbox service so it will be reinitialized on next use.
 * Call this after cloud backend configuration changes.
 */
export function reinitializeSandboxService() {
  sandboxServiceInitialized = false;
  resetSandboxService();
}

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
  let aws = null;

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

  // AWS
  try {
    await initializeAwsService();
    const awsService = getAwsService();
    if (await awsService.isAvailable()) {
      aws = awsService;
    }
  } catch (err) {
    console.log('[SandboxRoutes] AWS not available:', err instanceof Error ? err.message : 'unknown');
  }

  // Initialize sandbox service with available backends
  await initializeSandboxService({
    hypervisor: hypervisor ?? undefined,
    firecracker: firecracker ?? undefined,
    daytona: daytona ?? undefined,
    aws: aws ?? undefined,
  });

  sandboxServiceInitialized = true;
  return getSandboxService();
}

// Validation schemas
const SandboxBackendEnum = z.enum(['docker', 'cloud-hypervisor', 'firecracker', 'daytona', 'aws']);
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

  // AWS-specific options
  awsOptions: z.object({
    sizeClass: z.enum(['small', 'medium', 'large']).optional(),
    instanceType: z.string().optional(),
    amiId: z.string().optional(),
    volumeId: z.string().optional(),
    volumeSizeGb: z.number().optional(),
    availabilityZone: z.string().optional(),
    securityGroupIds: z.array(z.string()).optional(),
    subnetId: z.string().optional(),
  }).optional(),

  // Agent config preset to inject after creation
  agentConfigId: z.string().optional(),
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
      ['docker', 'cloud-hypervisor', 'firecracker', 'daytona', 'aws'].includes(b)
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

    // If agentConfigId is provided, schedule injection after sandbox is running
    if (body.agentConfigId) {
      const configId = body.agentConfigId;
      // Fire-and-forget: poll for running state and inject
      (async () => {
        try {
          const { getAgentConfig } = await import('../services/agent-config.js');
          const config = await getAgentConfig(configId);
          if (!config) {
            console.warn(`[SandboxRoutes] Agent config ${configId} not found for injection`);
            return;
          }

          // Poll for sandbox to be running (max 120 seconds)
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const current = await service.get(sandbox.id);
            if (!current || current.status === 'error') break;
            if (current.status === 'running') {
              // Inject via internal API call
              const apiBase = `http://localhost:${process.env.SERVER_PORT || '4001'}/api`;
              const res = await fetch(`${apiBase}/agent-configs/${configId}/inject/${sandbox.id}`, {
                method: 'POST',
              });
              if (res.ok) {
                console.log(`[SandboxRoutes] Agent config ${configId} injected into sandbox ${sandbox.id}`);
              } else {
                console.warn(`[SandboxRoutes] Failed to inject agent config: ${await res.text()}`);
              }
              break;
            }
          }
        } catch (err) {
          console.error('[SandboxRoutes] Agent config injection error:', err);
        }
      })();
    }

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
 * PATCH /api/sandboxes/:id
 * Update a sandbox (rename)
 */
const UpdateSandboxSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
});

sandboxes.patch('/:id', zValidator('json', UpdateSandboxSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.rename(id, body.name);
    return c.json(sandbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to rename sandbox';
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
    } else if (sandbox.backend === 'aws') {
      // AWS - logs not supported directly, return info message
      logs = '[AWS instances: Use SSH to view logs directly on the instance]';
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

      // Get key path from the service
      const fs = await import('fs');
      const keyPath = vmService.getSshKeyPath();

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
    } else if (sandbox.backend === 'aws') {
      // AWS instances use a shared key stored in config
      const awsService = service.getAwsService();
      if (!awsService) {
        return c.json({ error: 'AWS service not available' }, 500);
      }
      const key = await awsService.getSshPrivateKey();
      if (!key) {
        return c.json({ error: 'SSH key not available. Create an AWS instance first to generate a key.' }, 404);
      }
      privateKey = key;
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

/**
 * GET /api/sandboxes/:id/ssh-command
 * Get SSH command for connecting to the sandbox
 */
sandboxes.get('/:id/ssh-command', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.get(id);
    if (!sandbox) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    if (sandbox.status !== 'running') {
      return c.json({ error: 'Sandbox must be running to get SSH command' }, 400);
    }

    if (sandbox.backend === 'daytona') {
      // Get SSH command from Daytona service
      const { getDaytonaService } = await import('../services/daytona.js');
      const daytona = getDaytonaService();

      // Extract the workspace ID from sandbox ID (remove daytona- prefix)
      const workspaceId = id.startsWith('daytona-') ? id.slice(8) : id;
      const sshCommand = await daytona.getSshCommand(workspaceId);

      return c.json({ sshCommand });
    } else if (sandbox.backend === 'aws') {
      // Get SSH command from AWS service
      const { getAwsService } = await import('../services/aws.js');
      const awsService = getAwsService();

      // Extract the instance ID from sandbox ID (remove aws- prefix)
      const instanceId = id.startsWith('aws-') ? id.slice(4) : id;
      const sshCommand = await awsService.getSshCommand(instanceId);

      if (sshCommand) {
        return c.json({ sshCommand });
      }
      return c.json({ error: 'SSH command not available - instance may not have a public IP' }, 404);
    } else if (sandbox.sshCommand) {
      // Return existing SSH command from sandbox
      return c.json({ sshCommand: sandbox.sshCommand });
    } else {
      return c.json({ error: 'SSH command not available for this sandbox' }, 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get SSH command';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/upload
 * Upload a file to the sandbox's working directory
 */
sandboxes.post('/:id/upload', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.get(id);
    if (!sandbox) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    if (sandbox.status !== 'running') {
      return c.json({ error: 'Sandbox must be running to upload files' }, 400);
    }

    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    // Use appropriate default path based on backend
    const defaultDestPath = sandbox.backend === 'docker' ? '/home/dev/workspace'
      : sandbox.backend === 'daytona' ? '/home/daytona'
      : sandbox.backend === 'aws' ? '/home/ubuntu'
      : '/home/agent';  // firecracker/cloud-hypervisor
    const destPath = formData.get('destPath') as string || defaultDestPath;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name;

    if (sandbox.backend === 'docker') {
      // Docker: use docker cp via tar
      const containerId = id.startsWith('docker-') ? id.slice(7) : id;
      const { execSync } = await import('child_process');
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      // Write file to temp location (ensure parent dirs exist for nested paths)
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-upload-'));
      const tempPath = path.join(tempDir, filename);
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, buffer);

      try {
        // Ensure destination directory exists (including subdirs from filename)
        const fullDestDir = path.posix.dirname(`${destPath}/${filename}`);
        try {
          execSync(`docker exec ${containerId} mkdir -p "${fullDestDir}"`, { stdio: 'pipe' });
        } catch {
          // Ignore if already exists
        }

        // Copy file to container
        execSync(`docker cp "${tempPath}" ${containerId}:"${destPath}/${filename}"`, { stdio: 'pipe' });

        // Set ownership to dev user
        try {
          execSync(`docker exec ${containerId} chown -R dev:dev "${destPath}/${filename.split('/')[0]}"`, { stdio: 'pipe' });
        } catch {
          // Ignore if chown fails
        }
      } finally {
        // Cleanup temp files
        fs.unlinkSync(tempPath);
        fs.rmSync(tempDir, { recursive: true });
      }

      return c.json({ success: true, path: `${destPath}/${filename}` });
    } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
      // VM: use SCP
      const vmService = sandbox.backend === 'cloud-hypervisor'
        ? service.getHypervisorService()
        : service.getFirecrackerService();

      if (!vmService) {
        return c.json({ error: 'VM service not available' }, 500);
      }

      if (!sandbox.guestIp) {
        return c.json({ error: 'VM does not have an IP address' }, 400);
      }

      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const { execSync } = await import('child_process');

      // Get SSH key path from the service
      const keyPath = vmService.getSshKeyPath();

      if (!fs.existsSync(keyPath)) {
        return c.json({ error: 'SSH key not found' }, 500);
      }

      // Write file to temp location (ensure parent dirs exist for nested paths)
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-upload-'));
      const tempPath = path.join(tempDir, filename);
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, buffer);

      try {
        // Ensure destination directory exists via SSH (including subdirs from filename)
        const fullDestDir = path.posix.dirname(`${destPath}/${filename}`);
        try {
          execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 agent@${sandbox.guestIp} "mkdir -p '${fullDestDir}'"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        } catch {
          // Ignore if already exists
        }

        // Upload via SCP
        execSync(
          `scp -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 "${tempPath}" agent@${sandbox.guestIp}:"${destPath}/${filename}"`,
          { stdio: 'pipe', timeout: 300000 }
        );
      } finally {
        // Cleanup temp files
        fs.unlinkSync(tempPath);
        fs.rmSync(tempDir, { recursive: true });
      }

      return c.json({ success: true, path: `${destPath}/${filename}` });
    } else if (sandbox.backend === 'daytona') {
      // Daytona: upload via SSH if we have connection info
      if (!sandbox.guestIp) {
        return c.json({ error: 'Daytona workspace does not have SSH access configured' }, 400);
      }

      // Similar to VM upload
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const { execSync } = await import('child_process');

      const daytonaMeta = sandbox.backendMeta as { type: 'daytona'; sshKey?: string; sshPort?: number } | undefined;

      if (!daytonaMeta?.sshKey) {
        return c.json({ error: 'SSH key not available for this Daytona workspace' }, 400);
      }

      // Write SSH key and file to temp locations (ensure parent dirs exist for nested paths)
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-upload-'));
      const tempKeyPath = path.join(tempDir, 'key');
      const tempFilePath = path.join(tempDir, filename);

      fs.writeFileSync(tempKeyPath, daytonaMeta.sshKey, { mode: 0o600 });
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, buffer);

      try {
        const port = daytonaMeta.sshPort || 22;

        // Ensure destination directory exists (including subdirs from filename)
        const fullDestDir = path.posix.dirname(`${destPath}/${filename}`);
        try {
          execSync(
            `ssh -i "${tempKeyPath}" -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 dev@${sandbox.guestIp} "mkdir -p '${fullDestDir}'"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        } catch {
          // Ignore if already exists
        }

        // Upload via SCP
        execSync(
          `scp -i "${tempKeyPath}" -P ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 "${tempFilePath}" dev@${sandbox.guestIp}:"${destPath}/${filename}"`,
          { stdio: 'pipe', timeout: 300000 }
        );
      } finally {
        // Cleanup temp files
        fs.unlinkSync(tempKeyPath);
        fs.unlinkSync(tempFilePath);
        fs.rmSync(tempDir, { recursive: true });
      }

      return c.json({ success: true, path: `${destPath}/${filename}` });
    } else if (sandbox.backend === 'aws') {
      // AWS: upload via SSH using stored private key
      if (!sandbox.guestIp) {
        return c.json({ error: 'AWS instance does not have a public IP address' }, 400);
      }

      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const { execSync } = await import('child_process');

      const awsService = service.getAwsService();
      if (!awsService) {
        return c.json({ error: 'AWS service not available' }, 500);
      }

      const sshPrivateKey = await awsService.getSshPrivateKey();
      if (!sshPrivateKey) {
        return c.json({ error: 'SSH key not available for AWS instances' }, 400);
      }

      // Write SSH key and file to temp locations
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-upload-'));
      const tempKeyPath = path.join(tempDir, 'key');
      const tempFilePath = path.join(tempDir, filename);

      fs.writeFileSync(tempKeyPath, sshPrivateKey, { mode: 0o600 });
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, buffer);

      try {
        // Ensure destination directory exists
        const fullDestDir = path.posix.dirname(`${destPath}/${filename}`);
        try {
          execSync(
            `ssh -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 ubuntu@${sandbox.guestIp} "mkdir -p '${fullDestDir}'"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        } catch {
          // Ignore if already exists
        }

        // Upload via SCP
        execSync(
          `scp -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 "${tempFilePath}" ubuntu@${sandbox.guestIp}:"${destPath}/${filename}"`,
          { stdio: 'pipe', timeout: 300000 }
        );
      } finally {
        // Cleanup temp files
        fs.unlinkSync(tempKeyPath);
        fs.unlinkSync(tempFilePath);
        fs.rmSync(tempDir, { recursive: true });
      }

      return c.json({ success: true, path: `${destPath}/${filename}` });
    }

    return c.json({ error: 'Upload not supported for this backend' }, 400);
  } catch (error) {
    console.error('[SandboxRoutes] Upload error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload file';
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/sandboxes/:id/upload-directory
 * Upload a directory to the sandbox using tar (single transfer, avoids SSH connection limits)
 */
sandboxes.post('/:id/upload-directory', async (c) => {
  const id = c.req.param('id');
  const service = await ensureSandboxServiceInitialized();

  try {
    const sandbox = await service.get(id);
    if (!sandbox) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    if (sandbox.status !== 'running') {
      return c.json({ error: 'Sandbox must be running to upload files' }, 400);
    }

    const formData = await c.req.formData();
    const files = formData.getAll('files');
    const paths = formData.getAll('paths');

    // Use appropriate default path based on backend
    const defaultDestPath = sandbox.backend === 'docker' ? '/home/dev/workspace'
      : sandbox.backend === 'daytona' ? '/home/daytona'
      : sandbox.backend === 'aws' ? '/home/ubuntu'
      : '/home/agent';  // firecracker/cloud-hypervisor
    const destPath = (formData.get('destPath') as string) || defaultDestPath;

    if (!files || files.length === 0) {
      return c.json({ error: 'No files provided' }, 400);
    }

    if (files.length !== paths.length) {
      return c.json({ error: 'Mismatched files and paths count' }, 400);
    }

    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const { execSync } = await import('child_process');

    // Create temp directory and write all files preserving structure
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-upload-dir-'));
    const contentDir = path.join(tempDir, 'content');
    fs.mkdirSync(contentDir);

    console.log(`[SandboxRoutes] Uploading directory with ${files.length} files to ${destPath}`);

    try {
      // Write all files to temp directory with their relative paths
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = paths[i];

        if (!(file instanceof File) || typeof relativePath !== 'string') {
          continue;
        }

        const filePath = path.join(contentDir, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        const arrayBuffer = await file.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      }

      // Create tar archive
      const tarPath = path.join(tempDir, 'upload.tar.gz');
      execSync(`tar -czf "${tarPath}" -C "${contentDir}" .`, { stdio: 'pipe' });

      const tarSize = fs.statSync(tarPath).size;
      console.log(`[SandboxRoutes] Created tar archive: ${(tarSize / 1024).toFixed(1)} KB`);

      if (sandbox.backend === 'docker') {
        const containerId = id.startsWith('docker-') ? id.slice(7) : id;

        // Ensure destination directory exists
        try {
          execSync(`docker exec ${containerId} mkdir -p "${destPath}"`, { stdio: 'pipe' });
        } catch {
          // Ignore if already exists
        }

        // Copy tar to container and extract
        execSync(`docker cp "${tarPath}" ${containerId}:/tmp/upload.tar.gz`, { stdio: 'pipe' });
        execSync(`docker exec ${containerId} tar -xzf /tmp/upload.tar.gz -C "${destPath}"`, { stdio: 'pipe' });
        execSync(`docker exec ${containerId} rm /tmp/upload.tar.gz`, { stdio: 'pipe' });

        // Set ownership
        try {
          execSync(`docker exec ${containerId} chown -R dev:dev "${destPath}"`, { stdio: 'pipe' });
        } catch {
          // Ignore if chown fails
        }

        console.log(`[SandboxRoutes] Directory uploaded to Docker container ${containerId}`);
      } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
        const vmService = sandbox.backend === 'cloud-hypervisor'
          ? service.getHypervisorService()
          : service.getFirecrackerService();

        if (!vmService) {
          return c.json({ error: 'VM service not available' }, 500);
        }

        if (!sandbox.guestIp) {
          return c.json({ error: 'VM does not have an IP address' }, 400);
        }

        const keyPath = vmService.getSshKeyPath();
        if (!fs.existsSync(keyPath)) {
          return c.json({ error: 'SSH key not found' }, 500);
        }

        // Ensure destination directory exists
        try {
          execSync(
            `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 agent@${sandbox.guestIp} "mkdir -p '${destPath}'"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        } catch {
          // Ignore if already exists
        }

        // Copy tar to VM and extract
        execSync(
          `scp -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 "${tarPath}" agent@${sandbox.guestIp}:/tmp/upload.tar.gz`,
          { stdio: 'pipe', timeout: 300000 }
        );
        execSync(
          `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 agent@${sandbox.guestIp} "tar -xzf /tmp/upload.tar.gz -C '${destPath}' && rm /tmp/upload.tar.gz"`,
          { stdio: 'pipe', timeout: 120000 }
        );

        console.log(`[SandboxRoutes] Directory uploaded to VM ${sandbox.guestIp}`);
      } else if (sandbox.backend === 'daytona') {
        if (!sandbox.guestIp) {
          return c.json({ error: 'Daytona workspace does not have SSH access configured' }, 400);
        }

        const daytonaMeta = sandbox.backendMeta as { type: 'daytona'; sshKey?: string; sshPort?: number } | undefined;
        if (!daytonaMeta?.sshKey) {
          return c.json({ error: 'SSH key not available for this Daytona workspace' }, 400);
        }

        const tempKeyPath = path.join(tempDir, 'key');
        fs.writeFileSync(tempKeyPath, daytonaMeta.sshKey, { mode: 0o600 });
        const port = daytonaMeta.sshPort || 22;

        // Ensure destination directory exists
        try {
          execSync(
            `ssh -i "${tempKeyPath}" -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 dev@${sandbox.guestIp} "mkdir -p '${destPath}'"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        } catch {
          // Ignore if already exists
        }

        // Copy tar to workspace and extract
        execSync(
          `scp -i "${tempKeyPath}" -P ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 "${tarPath}" dev@${sandbox.guestIp}:/tmp/upload.tar.gz`,
          { stdio: 'pipe', timeout: 300000 }
        );
        execSync(
          `ssh -i "${tempKeyPath}" -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 dev@${sandbox.guestIp} "tar -xzf /tmp/upload.tar.gz -C '${destPath}' && rm /tmp/upload.tar.gz"`,
          { stdio: 'pipe', timeout: 120000 }
        );

        console.log(`[SandboxRoutes] Directory uploaded to Daytona workspace ${sandbox.guestIp}`);
      } else if (sandbox.backend === 'aws') {
        if (!sandbox.guestIp) {
          return c.json({ error: 'AWS instance does not have a public IP address' }, 400);
        }

        const awsService = service.getAwsService();
        if (!awsService) {
          return c.json({ error: 'AWS service not available' }, 500);
        }

        const sshPrivateKey = await awsService.getSshPrivateKey();
        if (!sshPrivateKey) {
          return c.json({ error: 'SSH key not available for AWS instances' }, 400);
        }

        const tempKeyPath = path.join(tempDir, 'key');
        fs.writeFileSync(tempKeyPath, sshPrivateKey, { mode: 0o600 });

        // Ensure destination directory exists
        try {
          execSync(
            `ssh -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 ubuntu@${sandbox.guestIp} "mkdir -p '${destPath}'"`,
            { stdio: 'pipe', timeout: 60000 }
          );
        } catch {
          // Ignore if already exists
        }

        // Copy tar to instance and extract
        execSync(
          `scp -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 "${tarPath}" ubuntu@${sandbox.guestIp}:/tmp/upload.tar.gz`,
          { stdio: 'pipe', timeout: 300000 }
        );
        execSync(
          `ssh -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=30 ubuntu@${sandbox.guestIp} "tar -xzf /tmp/upload.tar.gz -C '${destPath}' && rm /tmp/upload.tar.gz"`,
          { stdio: 'pipe', timeout: 120000 }
        );

        console.log(`[SandboxRoutes] Directory uploaded to AWS instance ${sandbox.guestIp}`);
      } else {
        return c.json({ error: 'Upload not supported for this backend' }, 400);
      }

      return c.json({ success: true, filesUploaded: files.length, destination: destPath });
    } finally {
      // Cleanup temp directory
      fs.rmSync(tempDir, { recursive: true });
    }
  } catch (error) {
    console.error('[SandboxRoutes] Directory upload error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload directory';
    return c.json({ error: message }, 500);
  }
});

export default sandboxes;
