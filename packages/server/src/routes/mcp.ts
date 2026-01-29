import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import * as mcpRegistry from '../services/mcp-registry.js';
import { streamMCPInstallInstructions, isAIConfigured, searchMCPServersWithAI } from '../services/ai.js';
import * as mcpDeploy from '../services/mcp-deploy.js';
import { injectFilesIntoSandbox, readFileFromSandbox, ensureSandboxService, execInSandbox } from '../services/sandbox-inject.js';

const mcp = new Hono();

// Get registry status
mcp.get('/status', async (c) => {
  const status = await mcpRegistry.getRegistryStatus();
  return c.json(status);
});

// Sync registry (can take a while, so we stream progress)
mcp.post('/sync', async (c) => {
  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({ event: 'status', data: 'Starting sync...' });

      const result = await mcpRegistry.syncRegistry();

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify(result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await stream.writeSSE({
        event: 'error',
        data: message,
      });
    }
  });
});

// List all servers (with optional pagination)
mcp.get('/servers', async (c) => {
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  const allServers = await mcpRegistry.getAllServers();
  const servers = allServers.slice(offset, offset + limit);

  return c.json({
    servers,
    total: allServers.length,
    limit,
    offset,
  });
});

// Search servers with pagination (includes manual servers)
mcp.get('/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const result = await mcpRegistry.searchAllServers(query, limit, offset);

  return c.json({
    ...result,
    query,
  });
});

// AI-powered semantic search
mcp.post('/ai-search', async (c) => {
  const body = await c.req.json();
  const query = body.query;

  if (!query || typeof query !== 'string') {
    return c.json({ error: 'Query is required' }, 400);
  }

  if (!isAIConfigured()) {
    return c.json({ error: 'AI not configured. Set OPENROUTER_API_KEY in .env.local' }, 503);
  }

  // Get all servers and create summaries for AI
  const allServers = await mcpRegistry.getAllServers();
  const serverSummaries = allServers.map(s => ({
    name: s.name,
    title: s.title,
    description: s.description,
  }));

  const result = await searchMCPServersWithAI(query, serverSummaries);

  if (result.error) {
    return c.json({ error: result.error }, 500);
  }

  // Get full server objects for matching names
  const matchingServers = result.serverNames
    .map(name => allServers.find(s => s.name === name))
    .filter((s): s is mcpRegistry.MCPServer => s !== undefined);

  return c.json({
    servers: matchingServers,
    total: matchingServers.length,
    query,
    aiSearch: true,
  });
});

// ============ Server sub-routes (must come BEFORE the generic /servers/:name route) ============

// Get install command for a server
mcp.get('/servers/:name{.+}/install', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const server = await mcpRegistry.getServerByName(name);

  if (!server) {
    return c.json({ error: 'Server not found' }, 404);
  }

  const command = mcpRegistry.generateInstallCommand(server);

  return c.json({
    name: server.name,
    command,
  });
});

// Get README for a server
mcp.get('/servers/:name{.+}/readme', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const readme = await mcpRegistry.fetchReadme(name);

  if (!readme) {
    return c.json({ error: 'README not found' }, 404);
  }

  return c.json({
    name,
    content: readme,
  });
});

// Stream AI-generated install guide from README
mcp.post('/servers/:name{.+}/install-guide', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));

  if (!isAIConfigured()) {
    return c.json({ error: 'AI not configured. Set OPENROUTER_API_KEY in .env.local' }, 503);
  }

  // First fetch the README
  const readme = await mcpRegistry.fetchReadme(name);
  if (!readme) {
    return c.json({ error: 'README not found - cannot generate install guide' }, 404);
  }

  return streamSSE(c, async (stream) => {
    try {
      await streamMCPInstallInstructions(
        name,
        readme,
        {
          onChunk: async (chunk) => {
            await stream.writeSSE({ event: 'chunk', data: chunk });
          },
          onError: async (error) => {
            await stream.writeSSE({ event: 'error', data: error });
          },
          onDone: async () => {
            await stream.writeSSE({ event: 'done', data: 'complete' });
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await stream.writeSSE({ event: 'error', data: message });
    }
  });
});

// Get single server by name (catch-all, must come AFTER more specific routes)
mcp.get('/servers/:name{.+}', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const server = await mcpRegistry.getServerByName(name);

  if (!server) {
    return c.json({ error: 'Server not found' }, 404);
  }

  // Include install command
  const installCommand = mcpRegistry.generateInstallCommand(server);

  return c.json({
    ...server,
    installCommand,
  });
});

// ============ Favorites ============

// Check if a server is a favorite (must come BEFORE the generic favorites routes)
mcp.get('/favorites/:name{.+}/check', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const isFavorite = await mcpRegistry.isFavorite(name);
  return c.json({ isFavorite });
});

// Get all favorites
mcp.get('/favorites', async (c) => {
  const favorites = await mcpRegistry.getFavorites();
  const servers = await mcpRegistry.getFavoriteServers();

  return c.json({
    favorites,
    servers,
  });
});

// Add a favorite
mcp.post('/favorites/:name{.+}', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  await mcpRegistry.addFavorite(name);
  return c.json({ success: true });
});

// Remove a favorite
mcp.delete('/favorites/:name{.+}', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  await mcpRegistry.removeFavorite(name);
  return c.json({ success: true });
});

// ============ Manual Servers ============

// Get all manual servers
mcp.get('/manual', async (c) => {
  const servers = await mcpRegistry.getManualServers();
  return c.json({ servers });
});

// Add a manual server by GitHub URL
mcp.post('/manual', async (c) => {
  try {
    const body = await c.req.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return c.json({ error: 'GitHub URL is required' }, 400);
    }

    // Validate it's a GitHub URL
    if (!url.includes('github.com')) {
      return c.json({ error: 'Only GitHub URLs are supported' }, 400);
    }

    const server = await mcpRegistry.addManualServer(url);
    return c.json({ server }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add server';
    return c.json({ error: message }, 400);
  }
});

// Remove a manual server
mcp.delete('/manual/:name{.+}', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));

  // Verify it's a manual server
  if (!name.startsWith('manual/')) {
    return c.json({ error: 'Can only remove manual servers' }, 400);
  }

  await mcpRegistry.removeManualServer(name);
  return c.json({ success: true });
});

// ============ MCP Deployments ============

// Deploy an MCP server (SSE stream for progress)
mcp.post('/deploy', async (c) => {
  const body = await c.req.json();
  const { serverName, backend, env } = body;

  if (!serverName || !backend) {
    return c.json({ error: 'serverName and backend are required' }, 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      const deployment = await mcpDeploy.deploy(
        { serverName, backend, env },
        async (event) => {
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify(event),
          });
        }
      );

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify(deployment),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await stream.writeSSE({
        event: 'error',
        data: message,
      });
    }
  });
});

// List all deployments
mcp.get('/deployments', async (c) => {
  const deployments = await mcpDeploy.listDeployments();
  return c.json({ deployments });
});

// Get deployment details
mcp.get('/deployments/:id', async (c) => {
  const id = c.req.param('id');
  const deployment = await mcpDeploy.getDeployment(id);
  if (!deployment) {
    return c.json({ error: 'Deployment not found' }, 404);
  }
  return c.json(deployment);
});

// Stop deployment
mcp.post('/deployments/:id/stop', async (c) => {
  const id = c.req.param('id');
  try {
    const deployment = await mcpDeploy.stopDeployment(id);
    return c.json(deployment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Restart deployment
mcp.post('/deployments/:id/restart', async (c) => {
  const id = c.req.param('id');
  try {
    const deployment = await mcpDeploy.restartDeployment(id);
    return c.json(deployment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Delete deployment
mcp.delete('/deployments/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await mcpDeploy.deleteDeployment(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Get deployment logs
mcp.get('/deployments/:id/logs', async (c) => {
  const id = c.req.param('id');
  try {
    const logs = await mcpDeploy.getDeploymentLogs(id);
    return c.json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 404);
  }
});

// Start a stopped deployment
mcp.post('/deployments/:id/start', async (c) => {
  const id = c.req.param('id');
  try {
    const deployment = await mcpDeploy.restartDeployment(id);
    return c.json(deployment);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Connect a deployed MCP server to a dev sandbox
mcp.post('/deployments/:id/connect/:sandboxId', async (c) => {
  const { id, sandboxId } = c.req.param();

  // 1. Get deployment and target sandbox
  const deployment = await mcpDeploy.getDeployment(id);
  if (!deployment) {
    return c.json({ error: 'Deployment not found' }, 404);
  }
  if (!deployment.connectionConfig) {
    return c.json({ error: 'Deployment has no connection config' }, 400);
  }

  const service = await ensureSandboxService();
  const targetSandbox = await service.get(sandboxId);
  if (!targetSandbox) {
    return c.json({ error: 'Target sandbox not found' }, 404);
  }
  if (targetSandbox.status !== 'running') {
    return c.json({ error: 'Target sandbox must be running' }, 400);
  }

  // Also get the MCP server's sandbox for networking info
  const mcpSandbox = deployment.sandboxId ? await service.get(deployment.sandboxId) : null;

  // 2. Build the mcpServers entry, adjusting for cross-sandbox networking
  const serverKey = deployment.serverName;
  let mcpServerEntry: Record<string, unknown>;

  if (deployment.transport === 'stdio') {
    // stdio only works if the MCP process runs inside the target sandbox (it doesn't)
    // or via SSH from target into the MCP sandbox
    if (mcpSandbox?.sshPort && deployment.backend === 'docker' && targetSandbox.backend === 'docker') {
      // Docker-to-Docker: SSH from target into MCP container via host gateway
      mcpServerEntry = {
        command: 'ssh',
        args: [
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-p', String(mcpSandbox.sshPort),
          `root@host.docker.internal`,
          deployment.command,
          ...deployment.args,
        ],
        ...(deployment.connectionConfig.env && Object.keys(deployment.connectionConfig.env).length > 0
          ? { env: deployment.connectionConfig.env }
          : {}),
      };
    } else {
      return c.json({
        error: `stdio transport is not supported for cross-sandbox connections between ${deployment.backend} and ${targetSandbox.backend}. Deploy the MCP server with SSE or HTTP transport instead.`,
      }, 400);
    }
  } else {
    // SSE or HTTP — rewrite the URL for cross-sandbox networking
    let url = deployment.connectionConfig.url || '';

    if (targetSandbox.backend === 'docker' && deployment.backend === 'docker') {
      // Docker-to-Docker: replace localhost with Docker host gateway
      url = url.replace(/\/\/localhost:/, '//host.docker.internal:');
    } else if (targetSandbox.backend === 'docker' && mcpSandbox?.guestIp) {
      // Docker targeting a VM: use VM's guest IP
      url = url.replace(/\/\/localhost:/, `//${mcpSandbox.guestIp}:`);
    } else if (targetSandbox.guestIp && mcpSandbox?.guestIp) {
      // VM-to-VM: use MCP sandbox's guest IP
      url = url.replace(/\/\/localhost:/, `//${mcpSandbox.guestIp}:`);
    }
    // If target is a VM and MCP is on Docker, localhost with host port should work
    // (VM can reach the host's ports directly)

    mcpServerEntry = {
      type: deployment.transport === 'sse' ? 'sse' : 'http',
      url,
      ...(deployment.connectionConfig.env && Object.keys(deployment.connectionConfig.env).length > 0
        ? { env: deployment.connectionConfig.env }
        : {}),
    };
  }

  // 3. Read existing .claude.json from sandbox and merge
  let existingConfig: Record<string, unknown> = {};
  try {
    const existing = await readFileFromSandbox(sandboxId, '/home/dev/.claude.json');
    if (existing) {
      existingConfig = JSON.parse(existing);
    }
  } catch {
    // No existing config or invalid JSON — start fresh
  }

  const existingServers = (existingConfig.mcpServers as Record<string, unknown>) || {};
  existingServers[serverKey] = mcpServerEntry;
  existingConfig.mcpServers = existingServers;

  // 4. Inject the merged .claude.json
  try {
    const injected = await injectFilesIntoSandbox(sandboxId, [{
      content: JSON.stringify(existingConfig, null, 2),
      destPath: '/home/dev',
      filename: '.claude.json',
    }]);
    return c.json({
      success: true,
      filesInjected: injected,
      serverKey,
      transport: deployment.transport,
      mcpServerEntry,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to connect MCP server to sandbox';
    return c.json({ error: message }, 500);
  }
});

// Disconnect a deployed MCP server from a dev sandbox
mcp.post('/deployments/:id/disconnect/:sandboxId', async (c) => {
  const { id, sandboxId } = c.req.param();

  const deployment = await mcpDeploy.getDeployment(id);
  if (!deployment) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  // Read existing .claude.json and remove this server
  let existingConfig: Record<string, unknown> = {};
  try {
    const existing = await readFileFromSandbox(sandboxId, '/home/dev/.claude.json');
    if (existing) {
      existingConfig = JSON.parse(existing);
    }
  } catch {
    return c.json({ success: true }); // Nothing to disconnect
  }

  const existingServers = (existingConfig.mcpServers as Record<string, unknown>) || {};
  delete existingServers[deployment.serverName];
  existingConfig.mcpServers = existingServers;

  try {
    await injectFilesIntoSandbox(sandboxId, [{
      content: JSON.stringify(existingConfig, null, 2),
      destPath: '/home/dev',
      filename: '.claude.json',
    }]);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to disconnect MCP server';
    return c.json({ error: message }, 500);
  }
});

// Health check: verify an MCP server is reachable from inside a sandbox
mcp.post('/deployments/:id/ping/:sandboxId', async (c) => {
  const { id, sandboxId } = c.req.param();

  const deployment = await mcpDeploy.getDeployment(id);
  if (!deployment) {
    return c.json({ error: 'Deployment not found' }, 404);
  }

  // Read the sandbox's .claude.json to get the actual configured URL/command
  let configuredEntry: Record<string, unknown> | null = null;
  try {
    const raw = await readFileFromSandbox(sandboxId, '/home/dev/.claude.json');
    if (raw) {
      const parsed = JSON.parse(raw);
      configuredEntry = parsed.mcpServers?.[deployment.serverName] || null;
    }
  } catch {
    // ignore
  }

  if (!configuredEntry) {
    return c.json({
      reachable: false,
      error: 'MCP server not configured in this sandbox',
      configured: false,
    });
  }

  // For SSE/HTTP: curl the URL from inside the sandbox
  const url = configuredEntry.url as string | undefined;
  const type = configuredEntry.type as string | undefined;

  if (url && (type === 'sse' || type === 'http')) {
    // For SSE endpoints, just check if the server responds (HEAD or short GET with timeout)
    // Use curl with connect-timeout to avoid hanging
    const curlCmd = `curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "${url}"`;
    const result = await execInSandbox(sandboxId, curlCmd, 15000);

    if (result) {
      const statusCode = parseInt(result.trim(), 10);
      // SSE endpoints typically return 200 or sometimes 405 for GET (but the connection works)
      const reachable = statusCode > 0 && statusCode < 500;
      return c.json({
        reachable,
        configured: true,
        statusCode,
        url,
        transport: deployment.transport,
      });
    }

    return c.json({
      reachable: false,
      configured: true,
      error: 'Could not reach MCP server from sandbox (connection timed out or refused)',
      url,
      transport: deployment.transport,
    });
  }

  // For stdio: check if the command exists in the sandbox
  const command = configuredEntry.command as string | undefined;
  if (command) {
    const whichCmd = `which ${command} 2>/dev/null && echo EXISTS || echo MISSING`;
    const result = await execInSandbox(sandboxId, whichCmd, 5000);
    const exists = result?.includes('EXISTS') || false;

    return c.json({
      reachable: exists,
      configured: true,
      transport: 'stdio',
      command,
      error: exists ? undefined : `Command '${command}' not found in sandbox`,
    });
  }

  return c.json({
    reachable: false,
    configured: true,
    error: 'Unknown transport configuration',
  });
});

// Discover local MCP servers
mcp.get('/local', async (c) => {
  const servers = await mcpDeploy.discoverLocalServers();
  return c.json({ servers });
});

export default mcp;
