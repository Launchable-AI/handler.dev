import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import { testConnection } from './services/docker.js';
import { getCloudHypervisorService } from './services/hypervisor.js';

const execAsync = promisify(exec);

/**
 * Find and kill any process using the specified port
 */
async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    // Find process using the port
    const { stdout } = await execAsync(`lsof -ti :${port} 2>/dev/null || true`);
    const pids = stdout.trim().split('\n').filter(Boolean);

    if (pids.length === 0) {
      return false;
    }

    console.log(`Found ${pids.length} process(es) using port ${port}: ${pids.join(', ')}`);

    // Kill each process
    for (const pid of pids) {
      try {
        await execAsync(`kill -9 ${pid}`);
        console.log(`   Killed process ${pid}`);
      } catch {
        // Process may have already exited
      }
    }

    // Wait a moment for the port to be released
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
  } catch {
    return false;
  }
}
import {
  createTerminalSession,
  writeToSession,
  resizeSession,
  closeSessionByWebSocket,
  closeAllSessions,
} from './services/terminal.js';
import {
  createVmTerminalSession,
  writeToVmSession,
  resizeVmSession,
  closeVmSessionByWebSocket,
  closeAllVmSessions,
} from './services/vm-terminal.js';
import containers from './routes/containers.js';
import images from './routes/images.js';
import volumes from './routes/volumes.js';
import dockerfiles from './routes/dockerfiles.js';
import configRoutes from './routes/config.js';
import composes from './routes/composes.js';
import ai from './routes/ai.js';
import components from './routes/components.js';
import mcp from './routes/mcp.js';
import notes from './routes/notes.js';
import vms from './routes/vms.js';
import backends from './routes/backends.js';
import vmVolumes from './routes/vm-volumes.js';
import sandboxes from './routes/sandboxes.js';
import unifiedVolumes from './routes/unified-volumes.js';
import templateRoutes from './routes/templates.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: (origin) => {
    // Allow any origin for local development and remote access
    // In production, you may want to restrict this to specific domains
    return origin || '*';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type'],
}));

// Health check
app.get('/api/health', async (c) => {
  const dockerConnected = await testConnection();

  // Get hypervisor status (lazy - don't initialize if not already done)
  let hypervisor = null;
  try {
    const service = getCloudHypervisorService();
    const networkStatus = service.getNetworkStatus();
    const vmStats = service.getStats();
    hypervisor = {
      initialized: true,
      network: networkStatus.healthy ? 'healthy' : 'not_configured',
      vms: vmStats,
    };
  } catch {
    hypervisor = { initialized: false };
  }

  return c.json({
    status: 'ok',
    docker: dockerConnected ? 'connected' : 'disconnected',
    hypervisor,
  });
});

// Routes
app.route('/api/containers', containers);
app.route('/api/images', images);
app.route('/api/volumes', volumes);
app.route('/api/dockerfiles', dockerfiles);
app.route('/api/config', configRoutes);
app.route('/api/composes', composes);
app.route('/api/ai', ai);
app.route('/api/components', components);
app.route('/api/mcp', mcp);
app.route('/api/notes', notes);
app.route('/api/vms', vms);
app.route('/api/backends', backends);
app.route('/api/vm-volumes', vmVolumes);
app.route('/api/sandboxes', sandboxes);
app.route('/api/unified-volumes', unifiedVolumes);
app.route('/api/templates', templateRoutes);

// SSE for real-time events (placeholder for now)
app.get('/api/events', (c) => {
  // TODO: Implement Docker event streaming
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return c.body('data: {"type":"connected"}\n\n');
});

function setupWebSocketServer(server: ReturnType<typeof createServer>) {
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });

  wss.on('connection', (ws: WebSocket, req) => {
    console.log('WebSocket connection established');
    let sessionId: string | null = null;
    let isVmSession = false;

    ws.on('message', async (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case 'start':
            // Start a new terminal session (container)
            if (msg.containerId) {
              sessionId = createTerminalSession(
                ws,
                msg.containerId,
                msg.shell || '/bin/bash',
                msg.cols || 80,
                msg.rows || 24,
                msg.isDevNode || false
              );
              isVmSession = false;
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'containerId is required' }));
            }
            break;

          case 'start-vm':
            // Start a new VM terminal session
            if (msg.vmId && msg.vmIp) {
              const hypervisor = getCloudHypervisorService();
              const dataDir = hypervisor.getDataDir();
              sessionId = createVmTerminalSession(
                ws,
                msg.vmId,
                msg.vmIp,
                dataDir,
                msg.shell || '/bin/bash',
                msg.cols || 80,
                msg.rows || 24
              );
              isVmSession = true;
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'vmId and vmIp are required' }));
            }
            break;

          case 'input':
            // Send input to terminal
            if (sessionId && msg.data) {
              if (isVmSession) {
                writeToVmSession(sessionId, msg.data);
              } else {
                writeToSession(sessionId, msg.data);
              }
            }
            break;

          case 'resize':
            // Resize terminal
            if (sessionId && msg.cols && msg.rows) {
              if (isVmSession) {
                resizeVmSession(sessionId, msg.cols, msg.rows);
              } else {
                resizeSession(sessionId, msg.cols, msg.rows);
              }
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            console.warn('Unknown WebSocket message type:', msg.type);
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      if (isVmSession) {
        closeVmSessionByWebSocket(ws);
      } else {
        closeSessionByWebSocket(ws);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      if (isVmSession) {
        closeVmSessionByWebSocket(ws);
      } else {
        closeSessionByWebSocket(ws);
      }
    });
  });

  return wss;
}

async function main() {
  // Use SERVER_PORT from env or default to 4001
  const port = parseInt(process.env.SERVER_PORT || '4001', 10);

  // Test Docker connection
  const dockerConnected = await testConnection();
  if (!dockerConnected) {
    console.warn('⚠️  Warning: Could not connect to Docker daemon');
    console.warn('   Make sure Docker is running and accessible');
  } else {
    console.log('✓ Docker connection established');
  }

  // Create HTTP server
  const server = createServer(async (req, res) => {
    // Collect request body for non-GET/HEAD methods
    let body: Buffer | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    // Handle Hono requests
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: body ? new Uint8Array(body) : undefined,
    });

    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      const reader = response.body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        return pump();
      };
      await pump();
    } else {
      res.end();
    }
  });

  // Setup WebSocket server
  const wss = setupWebSocketServer(server);

  // Function to start listening with retry on EADDRINUSE
  const startListening = (retryCount = 0): void => {
    server.listen(port, () => {
      console.log(`\n🚀 Caisson API`);
      console.log(`   Running on http://localhost:${port}`);
      console.log(`   WebSocket: ws://localhost:${port}/ws/terminal`);
      console.log(`   API docs: http://localhost:${port}/api/health\n`);
    });
  };

  // Handle server errors (including EADDRINUSE)
  server.on('error', async (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`\n⚠️  Port ${port} is already in use.`);
      console.log('   Attempting to kill the existing process...');

      const killed = await killProcessOnPort(port);
      if (killed) {
        console.log('   Retrying to start server...\n');
        // Small delay before retry
        setTimeout(() => startListening(1), 100);
      } else {
        console.error(`\n❌ Could not free port ${port}.`);
        console.error('   Please manually kill the process using:');
        console.error(`   lsof -ti :${port} | xargs kill -9\n`);
        process.exit(1);
      }
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  startListening();

  // Graceful shutdown handler
  const shutdown = (signal: string) => {
    console.log(`\n📤 Received ${signal}, shutting down gracefully...`);

    // Close all terminal sessions (kills SSH/docker exec processes)
    closeAllSessions();
    closeAllVmSessions();

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1001, 'Server shutting down');
      }
    });

    // Close WebSocket server
    wss.close((err) => {
      if (err) {
        console.error('Error closing WebSocket server:', err);
      } else {
        console.log('   WebSocket server closed');
      }
    });

    // Close HTTP server
    server.close((err) => {
      if (err) {
        console.error('Error closing HTTP server:', err);
        process.exit(1);
      }
      console.log('   HTTP server closed');
      console.log('👋 Goodbye!\n');
      process.exit(0);
    });

    // Force exit after timeout if graceful shutdown fails
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(console.error);
