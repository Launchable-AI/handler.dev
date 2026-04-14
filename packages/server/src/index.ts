import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { testConnection } from './services/docker.js';
import { getFirecrackerService } from './services/firecracker.js';

const execAsync = promisify(exec);

// PID file location - use /tmp for simplicity
const PID_FILE = '/tmp/handler-server.pid';

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Find and kill any process using the specified port
 */
async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    // Find process using the port (exclude our own PID)
    const ourPid = process.pid;
    const { stdout } = await execAsync(`lsof -ti :${port} 2>/dev/null || true`);
    const pids = stdout.trim().split('\n').filter(p => p && p !== String(ourPid));

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

/**
 * Kill process from PID file if it exists
 */
async function killFromPidFile(): Promise<boolean> {
  try {
    if (!fs.existsSync(PID_FILE)) {
      return false;
    }

    const pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
    if (!pid) {
      fs.unlinkSync(PID_FILE);
      return false;
    }

    // Check if process is still running
    try {
      process.kill(parseInt(pid), 0); // Signal 0 just checks if process exists
      console.log(`Found stale server process ${pid} from PID file`);
      await execAsync(`kill -9 ${pid}`);
      console.log(`   Killed process ${pid}`);
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch {
      // Process doesn't exist anymore
    }

    fs.unlinkSync(PID_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write current PID to file
 */
function writePidFile(): void {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

/**
 * Remove PID file
 */
function removePidFile(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Clean up stale processes before starting
 */
async function cleanupBeforeStart(port: number): Promise<void> {
  // First, check PID file for previous instance
  await killFromPidFile();

  // Check if port is available
  const available = await isPortAvailable(port);
  if (!available) {
    console.log(`⚠️  Port ${port} is in use, cleaning up...`);
    const killed = await killProcessOnPort(port);
    if (killed) {
      // Verify port is now available
      const nowAvailable = await isPortAvailable(port);
      if (!nowAvailable) {
        console.error(`❌ Could not free port ${port} after cleanup`);
        console.error(`   Please manually kill the process using:`);
        console.error(`   lsof -ti :${port} | xargs kill -9`);
        process.exit(1);
      }
      console.log(`   Port ${port} is now available`);
    } else {
      console.error(`❌ Could not identify process using port ${port}`);
      console.error(`   Please manually kill the process using:`);
      console.error(`   lsof -ti :${port} | xargs kill -9`);
      process.exit(1);
    }
  }
}
import {
  createTerminalSession,
  resumeTerminalSession,
  writeToSession,
  resizeSession,
  closeSessionByWebSocket,
  closeAllSessions,
  getSession,
} from './services/terminal.js';
import { injectPromptTheme } from './services/shell-init.js';
import { setConfig } from './services/config.js';
import type { ShellPromptTheme } from './services/config.js';
import {
  createVmTerminalSession,
  resumeVmTerminalSession,
  createDaytonaTerminalSession,
  createAwsTerminalSession,
  createCloudTerminalSession,
  writeToVmSession,
  resizeVmSession,
  closeVmSessionByWebSocket,
  closeAllVmSessions,
  getVmSession,
} from './services/vm-terminal.js';
import { getDaytonaService } from './services/daytona.js';
import { getAwsService } from './services/aws.js';
import { getAzureService } from './services/azure.js';
import { getGcpService } from './services/gcp.js';
import { getDigitalOceanService } from './services/digitalocean.js';
import { getLinodeService } from './services/linode.js';
import { validateSandboxId, validateIpAddress } from './lib/validation.js';
import containers from './routes/containers.js';
import images from './routes/images.js';
import volumes from './routes/volumes.js';
import dockerfiles from './routes/dockerfiles.js';
import configRoutes from './routes/config.js';
import ai from './routes/ai.js';
import mcp from './routes/mcp.js';
import notes from './routes/notes.js';
import vms from './routes/vms.js';
import backends from './routes/backends.js';
import vmVolumes from './routes/vm-volumes.js';
import sandboxes from './routes/sandboxes.js';
import unifiedVolumes from './routes/unified-volumes.js';
import templateRoutes from './routes/templates.js';
import daytonaRoutes from './routes/daytona.js';
import awsRoutes from './routes/aws.js';
import agentConfigRoutes from './routes/agent-config.js';
import azureRoutes from './routes/azure.js';
import gcpRoutes from './routes/gcp.js';
import digitaloceanRoutes from './routes/digitalocean.js';
import linodeRoutes from './routes/linode.js';
import worktreeRoutes from './routes/worktrees.js';
import registryRoutes from './routes/registry.js';
import githubRoutes from './routes/github.js';
import githubAppRoutes from './routes/github-app.js';
import workRoutes from './routes/work.js';
import quickFileRoutes from './routes/quick-files.js';
import sshKeyRoutes from './routes/ssh-keys.js';
import imageBuilderRoutes from './routes/image-builder.js';
import {
  createImageShellSession,
  writeToImageShell,
  resizeImageShell,
  closeImageShellByWebSocket,
  cleanupAllImageShells,
} from './services/image-shell.js';

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

  return c.json({
    status: 'ok',
    docker: dockerConnected ? 'connected' : 'disconnected',
    devMode: process.env.environment === 'development',
  });
});

// Routes
app.route('/api/containers', containers);
app.route('/api/images', images);
app.route('/api/volumes', volumes);
app.route('/api/dockerfiles', dockerfiles);
app.route('/api/config', configRoutes);
app.route('/api/ai', ai);
app.route('/api/mcp', mcp);
app.route('/api/notes', notes);
app.route('/api/vms', vms);
app.route('/api/backends', backends);
app.route('/api/vm-volumes', vmVolumes);
app.route('/api/sandboxes', sandboxes);
app.route('/api/unified-volumes', unifiedVolumes);
app.route('/api/templates', templateRoutes);
app.route('/api/daytona', daytonaRoutes);
app.route('/api/backends/aws', awsRoutes);
app.route('/api/agent-configs', agentConfigRoutes);
app.route('/api/backends/azure', azureRoutes);
app.route('/api/backends/gcp', gcpRoutes);
app.route('/api/backends/digitalocean', digitaloceanRoutes);
app.route('/api/backends/linode', linodeRoutes);
app.route('/api/worktrees', worktreeRoutes);
app.route('/api/registry', registryRoutes);
app.route('/api/github', githubRoutes);
app.route('/api/github-app', githubAppRoutes);
app.route('/api/work', workRoutes);
app.route('/api/quick-files', quickFileRoutes);
app.route('/api/ssh-keys', sshKeyRoutes);
app.route('/api/image-builder', imageBuilderRoutes);

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
              validateSandboxId(msg.containerId);
              sessionId = createTerminalSession(
                ws,
                msg.containerId,
                msg.shell || '/bin/bash',
                msg.cols || 80,
                msg.rows || 24,
                msg.workdir,
                msg.attachTmuxSession
              );
              isVmSession = false;
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'containerId is required' }));
            }
            break;

          case 'resume':
            // Resume an existing terminal session (container with tmux)
            if (msg.sessionId) {
              try {
                const result = await resumeTerminalSession(
                  ws,
                  msg.sessionId,
                  msg.cols || 80,
                  msg.rows || 24
                );
                if (result) {
                  sessionId = result.sessionId;
                  isVmSession = false;
                  // Send scrollback to client if available
                  if (result.scrollback) {
                    ws.send(JSON.stringify({ type: 'scrollback', data: result.scrollback }));
                  }
                } else {
                  // Session not found or tmux session died
                  ws.send(JSON.stringify({ type: 'session-not-found', oldSessionId: msg.sessionId }));
                }
              } catch (err) {
                console.error('[WS Terminal] Failed to resume session:', err);
                ws.send(JSON.stringify({
                  type: 'session-not-found',
                  oldSessionId: msg.sessionId,
                  message: err instanceof Error ? err.message : 'Failed to resume session'
                }));
              }
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'sessionId is required for resume' }));
            }
            break;

          case 'resume-vm':
            // Resume an existing VM terminal session (with tmux)
            if (msg.sessionId) {
              try {
                const result = await resumeVmTerminalSession(
                  ws,
                  msg.sessionId,
                  msg.cols || 80,
                  msg.rows || 24
                );
                if (result) {
                  sessionId = result.sessionId;
                  isVmSession = true;
                  if (result.scrollback) {
                    ws.send(JSON.stringify({ type: 'scrollback', data: result.scrollback }));
                  }
                } else {
                  ws.send(JSON.stringify({ type: 'session-not-found', oldSessionId: msg.sessionId }));
                }
              } catch (err) {
                console.error('[WS Terminal] Failed to resume VM session:', err);
                ws.send(JSON.stringify({
                  type: 'session-not-found',
                  oldSessionId: msg.sessionId,
                  message: err instanceof Error ? err.message : 'Failed to resume VM session'
                }));
              }
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'sessionId is required for resume-vm' }));
            }
            break;

          case 'start-vm':
            // Start a new VM terminal session (Firecracker)
            if (msg.vmId && msg.vmIp) {
              validateSandboxId(msg.vmId);
              validateIpAddress(msg.vmIp);
              const vmService = getFirecrackerService();
              const dataDir = vmService.getDataDir();
              sessionId = createVmTerminalSession(
                ws,
                msg.vmId,
                msg.vmIp,
                dataDir,
                msg.shell || '/bin/bash',
                msg.cols || 80,
                msg.rows || 24,
                msg.sessionKey,
                msg.attachTmuxSession
              );
              isVmSession = true;
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'vmId and vmIp are required' }));
            }
            break;

          case 'start-daytona':
            // Start a new Daytona terminal session
            if (msg.sandboxId) {
              validateSandboxId(msg.sandboxId);
              try {
                const daytona = getDaytonaService();
                // Strip 'daytona-' prefix if present
                const workspaceId = msg.sandboxId.startsWith('daytona-')
                  ? msg.sandboxId.slice(8)
                  : msg.sandboxId;

                // Get SSH access from Daytona API
                console.log(`[WS Terminal] Getting SSH access for Daytona sandbox: ${workspaceId}`);
                const sshAccess = await daytona.createSshAccess(workspaceId);

                sessionId = createDaytonaTerminalSession(
                  ws,
                  workspaceId,
                  sshAccess.sshCommand,
                  msg.cols || 80,
                  msg.rows || 24
                );
                isVmSession = true; // Use VM session handlers for write/resize/close
              } catch (err) {
                console.error('[WS Terminal] Failed to create Daytona terminal:', err);
                ws.send(JSON.stringify({
                  type: 'error',
                  message: err instanceof Error ? err.message : 'Failed to get SSH access'
                }));
              }
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'sandboxId is required' }));
            }
            break;

          case 'start-aws':
            // Start a new AWS terminal session
            if (msg.instanceId && msg.publicIp) {
              validateSandboxId(msg.instanceId);
              validateIpAddress(msg.publicIp);
              try {
                const awsService = getAwsService();
                const sshPrivateKey = await awsService.getSshPrivateKey();

                if (!sshPrivateKey) {
                  ws.send(JSON.stringify({
                    type: 'error',
                    message: 'SSH key not available for AWS instances'
                  }));
                  break;
                }

                console.log(`[WS Terminal] Creating AWS terminal for instance: ${msg.instanceId}`);

                sessionId = createAwsTerminalSession(
                  ws,
                  msg.instanceId,
                  msg.publicIp,
                  sshPrivateKey,
                  msg.cols || 80,
                  msg.rows || 24
                );
                isVmSession = true; // Use VM session handlers for write/resize/close
              } catch (err) {
                console.error('[WS Terminal] Failed to create AWS terminal:', err);
                ws.send(JSON.stringify({
                  type: 'error',
                  message: err instanceof Error ? err.message : 'Failed to create terminal'
                }));
              }
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'instanceId and publicIp are required' }));
            }
            break;

          case 'start-azure':
          case 'start-gcp':
          case 'start-digitalocean':
          case 'start-linode':
            // Start a cloud backend terminal session via SSH
            if (msg.instanceId && msg.publicIp) {
              validateSandboxId(msg.instanceId);
              validateIpAddress(msg.publicIp);
              try {
                const backendType = msg.type.replace('start-', '');
                const backendService = backendType === 'azure' ? getAzureService()
                  : backendType === 'gcp' ? getGcpService()
                  : backendType === 'digitalocean' ? getDigitalOceanService()
                  : getLinodeService();

                const sshPrivateKey = await backendService.getSshPrivateKey();
                if (!sshPrivateKey) {
                  ws.send(JSON.stringify({ type: 'error', message: 'SSH key not available' }));
                  break;
                }

                const sshUser = msg.sshUser || (backendType === 'azure' ? 'azureuser' : backendType === 'gcp' ? 'handler' : 'root');

                console.log(`[WS Terminal] Creating ${backendType} terminal for instance: ${msg.instanceId}`);

                sessionId = createCloudTerminalSession(
                  ws,
                  msg.instanceId,
                  msg.publicIp,
                  sshPrivateKey,
                  sshUser,
                  msg.cols || 80,
                  msg.rows || 24
                );
                isVmSession = true;
              } catch (err) {
                console.error(`[WS Terminal] Failed to create ${msg.type.replace('start-', '')} terminal:`, err);
                ws.send(JSON.stringify({
                  type: 'error',
                  message: err instanceof Error ? err.message : 'Failed to create terminal'
                }));
              }
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'instanceId and publicIp are required' }));
            }
            break;

          case 'start-image-shell':
            // Start a shell into an image's rootfs (dev-mode only)
            if (process.env.environment !== 'development') {
              ws.send(JSON.stringify({ type: 'error', message: 'Image shell is only available in development mode' }));
              break;
            }
            if (msg.imageName) {
              try {
                sessionId = createImageShellSession(
                  msg.imageName,
                  ws,
                  msg.cols || 80,
                  msg.rows || 24,
                );
                isVmSession = false; // Uses its own write/resize handlers
              } catch (err) {
                console.error('[WS Terminal] Failed to create image shell:', err);
                ws.send(JSON.stringify({
                  type: 'error',
                  message: err instanceof Error ? err.message : 'Failed to create image shell'
                }));
              }
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'imageName is required' }));
            }
            break;

          case 'input':
            // Send input to terminal
            if (sessionId && msg.data) {
              if (sessionId.startsWith('image-')) {
                writeToImageShell(sessionId, msg.data);
              } else if (isVmSession) {
                writeToVmSession(sessionId, msg.data);
              } else {
                writeToSession(sessionId, msg.data);
              }
            }
            break;

          case 'resize':
            // Resize terminal
            if (sessionId && msg.cols && msg.rows) {
              if (sessionId.startsWith('image-')) {
                resizeImageShell(sessionId, msg.cols, msg.rows);
              } else if (isVmSession) {
                resizeVmSession(sessionId, msg.cols, msg.rows);
              } else {
                resizeSession(sessionId, msg.cols, msg.rows);
              }
            }
            break;

          case 'set-prompt-theme':
            // Live-switch prompt theme for this session
            if (sessionId && msg.theme) {
              const validThemes: ShellPromptTheme[] = ['minimal', 'clean', 'bracket', 'lambda', 'cyberpunk', 'multiline'];
              if (validThemes.includes(msg.theme)) {
                const session = isVmSession ? getVmSession(sessionId) : getSession(sessionId);
                if (session) {
                  injectPromptTheme(session.process, msg.theme);
                }
                // Persist the theme selection
                setConfig({ shellPromptTheme: msg.theme }).catch(err => {
                  console.error('[WS] Failed to persist prompt theme:', err);
                });
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
      closeImageShellByWebSocket(ws);
      if (isVmSession) {
        closeVmSessionByWebSocket(ws);
      } else {
        closeSessionByWebSocket(ws);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      closeImageShellByWebSocket(ws);
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

  // Clean up any stale processes before starting
  await cleanupBeforeStart(port);

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
    // Skip Hono for WebSocket upgrade paths — handled by ws library
    if (req.url === '/ws/terminal' && req.headers.upgrade) {
      return;
    }

    // Stream request body instead of buffering (supports large file uploads)
    let body: ReadableStream<Uint8Array> | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = new ReadableStream({
        start(controller) {
          req.on('data', (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          req.on('end', () => {
            controller.close();
          });
          req.on('error', (err) => {
            controller.error(err);
          });
        },
      });
    }

    // Handle Hono requests
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body,
      // @ts-expect-error duplex is required for streaming request bodies in Node.js
      duplex: 'half',
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

  // Handle server errors
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // This shouldn't happen since we do proactive cleanup, but handle it anyway
      console.error(`\n❌ Port ${port} is still in use after cleanup.`);
      console.error('   Please manually kill the process using:');
      console.error(`   lsof -ti :${port} | xargs kill -9\n`);
    } else {
      console.error('Server error:', err);
    }
    removePidFile();
    process.exit(1);
  });

  // Start listening — bind to localhost only so sandboxes (Docker containers,
  // Firecracker VMs) cannot reach the API via bridge/TAP gateway IPs.
  server.listen(port, '127.0.0.1', async () => {
    // Write PID file after successful startup
    writePidFile();
    console.log(`\n🚀 Handler API (PID: ${process.pid})`);
    console.log(`   Running on http://localhost:${port}`);
    console.log(`   WebSocket: ws://localhost:${port}/ws/terminal`);
    console.log(`   API docs: http://localhost:${port}/api/health\n`);

    // Start MCP health monitor
    try {
      const { startHealthMonitor } = await import('./services/mcp-health.js');
      startHealthMonitor();
    } catch (err) {
      console.warn('Failed to start MCP health monitor:', err);
    }
  });

  // Track if shutdown is in progress to prevent duplicate handling
  let isShuttingDown = false;

  // Graceful shutdown handler
  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      console.log(`\n⚠️  Shutdown already in progress, forcing exit...`);
      removePidFile();
      process.exit(1);
    }
    isShuttingDown = true;

    console.log(`\n📤 Received ${signal}, shutting down gracefully...`);

    // Remove PID file early to prevent race conditions on restart
    removePidFile();

    // Stop MCP health monitor
    try {
      import('./services/mcp-health.js').then(({ stopHealthMonitor }) => stopHealthMonitor()).catch(() => {});
    } catch { /* ignore */ }

    // Close all terminal sessions (kills SSH/docker exec processes)
    closeAllSessions();
    closeAllVmSessions();
    cleanupAllImageShells();

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

  // Handle uncaught exceptions - clean up PID file before crashing
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    removePidFile();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    // Don't exit, but log the error
  });

  // Ensure PID file cleanup on any exit
  process.on('exit', () => {
    removePidFile();
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  removePidFile();
  process.exit(1);
});
