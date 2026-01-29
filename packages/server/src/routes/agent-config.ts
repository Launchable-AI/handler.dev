import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as agentConfigService from '../services/agent-config.js';
import { getSandboxService, initializeSandboxService } from '../services/sandbox/index.js';
import { getCloudHypervisorService, initializeCloudHypervisorService } from '../services/hypervisor.js';
import { getFirecrackerService, initializeFirecrackerService } from '../services/firecracker.js';
import { getDaytonaService, initializeDaytonaService } from '../services/daytona.js';
import { getAwsService, initializeAwsService } from '../services/aws.js';

const agentConfig = new Hono();

const MCPServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
});

const PermissionsSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  mcpServers: z.record(MCPServerSchema).optional(),
  claudeMd: z.string().optional(),
  permissions: PermissionsSchema.optional(),
});

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  mcpServers: z.record(MCPServerSchema).optional(),
  claudeMd: z.string().optional(),
  permissions: PermissionsSchema.optional(),
});

// List all presets
agentConfig.get('/', async (c) => {
  const configs = await agentConfigService.getAgentConfigs();
  return c.json({ configs });
});

// Get a single preset
agentConfig.get('/:id', async (c) => {
  const { id } = c.req.param();
  const config = await agentConfigService.getAgentConfig(id);

  if (!config) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  return c.json(config);
});

// Create a preset
agentConfig.post('/', zValidator('json', CreateSchema), async (c) => {
  const input = c.req.valid('json');
  const config = await agentConfigService.createAgentConfig(input);
  return c.json(config, 201);
});

// Update a preset
agentConfig.patch('/:id', zValidator('json', UpdateSchema), async (c) => {
  const { id } = c.req.param();
  const input = c.req.valid('json');
  const config = await agentConfigService.updateAgentConfig(id, input);

  if (!config) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  return c.json(config);
});

// Delete a preset
agentConfig.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const deleted = await agentConfigService.deleteAgentConfig(id);

  if (!deleted) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  return c.json({ success: true });
});

// Inject a preset into a running sandbox
agentConfig.post('/:id/inject/:sandboxId', async (c) => {
  const { id, sandboxId } = c.req.param();

  const config = await agentConfigService.getAgentConfig(id);
  if (!config) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  // Get sandbox service (reuse the lazy init pattern from sandboxes route)
  let service;
  try {
    service = getSandboxService();
  } catch {
    // Need to initialize - simplified version
    try {
      let hypervisor, firecracker, daytona, aws;
      try { await initializeCloudHypervisorService(); hypervisor = getCloudHypervisorService(); } catch {}
      try { await initializeFirecrackerService(); firecracker = getFirecrackerService(); } catch {}
      try { await initializeDaytonaService(); const d = getDaytonaService(); if (await d.isAvailable()) daytona = d; } catch {}
      try { await initializeAwsService(); const a = getAwsService(); if (await a.isAvailable()) aws = a; } catch {}
      await initializeSandboxService({
        hypervisor: hypervisor ?? undefined,
        firecracker: firecracker ?? undefined,
        daytona: daytona ?? undefined,
        aws: aws ?? undefined,
      });
      service = getSandboxService();
    } catch (err) {
      return c.json({ error: 'Failed to initialize sandbox service' }, 500);
    }
  }

  const sandbox = await service.get(sandboxId);
  if (!sandbox) {
    return c.json({ error: 'Sandbox not found' }, 404);
  }

  if (sandbox.status !== 'running') {
    return c.json({ error: 'Sandbox must be running to inject config' }, 400);
  }

  // Build the files to inject
  const filesToInject: Array<{ content: string; destPath: string; filename: string }> = [];

  // 1. ~/.claude.json (MCP servers config)
  if (Object.keys(config.mcpServers).length > 0) {
    filesToInject.push({
      content: JSON.stringify({ mcpServers: config.mcpServers }, null, 2),
      destPath: '/home/dev',
      filename: '.claude.json',
    });
  }

  // 2. ~/.claude/CLAUDE.md
  if (config.claudeMd) {
    filesToInject.push({
      content: config.claudeMd,
      destPath: '/home/dev/.claude',
      filename: 'CLAUDE.md',
    });
  }

  // 3. ~/.claude/settings.local.json
  if (config.permissions.allow?.length || config.permissions.deny?.length) {
    filesToInject.push({
      content: JSON.stringify({ permissions: config.permissions }, null, 2),
      destPath: '/home/dev/.claude',
      filename: 'settings.local.json',
    });
  }

  if (filesToInject.length === 0) {
    return c.json({ success: true, message: 'No files to inject', filesInjected: 0 });
  }

  // Use the upload endpoint internally by making requests to ourselves
  // Instead, we'll directly use the sandbox backend to write files
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const { execSync } = await import('child_process');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-inject-'));
  let injectedCount = 0;

  try {
    for (const file of filesToInject) {
      const tempFilePath = path.join(tempDir, file.filename);
      fs.writeFileSync(tempFilePath, file.content);

      if (sandbox.backend === 'docker') {
        const dockerMeta = sandbox.backendMeta as { type: 'docker'; containerId: string } | undefined;
        const containerId = dockerMeta?.containerId || sandbox.id.replace('docker-', '');

        // Ensure destination directory exists
        try {
          execSync(`docker exec ${containerId} mkdir -p "${file.destPath}"`, { stdio: 'pipe' });
        } catch { /* ignore */ }

        execSync(`docker cp "${tempFilePath}" ${containerId}:${file.destPath}/${file.filename}`, { stdio: 'pipe' });

        // Set ownership
        try {
          execSync(`docker exec ${containerId} chown dev:dev "${file.destPath}/${file.filename}"`, { stdio: 'pipe' });
        } catch { /* ignore */ }

        injectedCount++;
      } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
        const vmService = sandbox.backend === 'cloud-hypervisor'
          ? service.getHypervisorService()
          : service.getFirecrackerService();
        const dataDir = vmService?.getDataDir?.();
        const keyPath = dataDir ? path.join(dataDir, 'ssh', 'caisson_vm_key') : '';

        if (keyPath && sandbox.guestIp) {
          try {
            execSync(`ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes agent@${sandbox.guestIp} "mkdir -p '${file.destPath}'"`, { stdio: 'pipe', timeout: 10000 });
          } catch { /* ignore */ }

          execSync(
            `scp -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes "${tempFilePath}" agent@${sandbox.guestIp}:${file.destPath}/${file.filename}`,
            { stdio: 'pipe', timeout: 30000 }
          );
          injectedCount++;
        }
      } else if (sandbox.backend === 'daytona') {
        const daytonaMeta = sandbox.backendMeta as { type: 'daytona'; sshKey?: string } | undefined;
        if (sandbox.guestIp && daytonaMeta?.sshKey) {
          const tempKeyPath = path.join(tempDir, 'daytona_key');
          fs.writeFileSync(tempKeyPath, daytonaMeta.sshKey, { mode: 0o600 });

          const port = sandbox.sshPort || 22;
          try {
            execSync(`ssh -i "${tempKeyPath}" -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes dev@${sandbox.guestIp} "mkdir -p '${file.destPath}'"`, { stdio: 'pipe', timeout: 10000 });
          } catch { /* ignore */ }

          execSync(
            `scp -i "${tempKeyPath}" -P ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes "${tempFilePath}" dev@${sandbox.guestIp}:${file.destPath}/${file.filename}`,
            { stdio: 'pipe', timeout: 30000 }
          );
          injectedCount++;
        }
      } else if (sandbox.backend === 'aws') {
        if (sandbox.guestIp) {
          try {
            const awsService = getAwsService();
            const sshPrivateKey = await awsService.getSshPrivateKey();
            if (sshPrivateKey) {
              const tempKeyPath = path.join(tempDir, 'aws_key');
              fs.writeFileSync(tempKeyPath, sshPrivateKey, { mode: 0o600 });

              try {
                execSync(`ssh -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes ubuntu@${sandbox.guestIp} "mkdir -p '${file.destPath}'"`, { stdio: 'pipe', timeout: 10000 });
              } catch { /* ignore */ }

              execSync(
                `scp -i "${tempKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes "${tempFilePath}" ubuntu@${sandbox.guestIp}:${file.destPath}/${file.filename}`,
                { stdio: 'pipe', timeout: 30000 }
              );
              injectedCount++;
            }
          } catch { /* ignore */ }
        }
      }
    }

    return c.json({ success: true, filesInjected: injectedCount });
  } catch (error) {
    console.error('[AgentConfig] Inject error:', error);
    const message = error instanceof Error ? error.message : 'Failed to inject config';
    return c.json({ error: message }, 500);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

export default agentConfig;
