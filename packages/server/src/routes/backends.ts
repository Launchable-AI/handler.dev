import { Hono } from 'hono';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { testConnection } from '../services/docker.js';
import { getConfig, setConfig } from '../services/config.js';
import { getDaytonaService } from '../services/daytona.js';
import os from 'os';

const execAsync = promisify(exec);

const backends = new Hono();

interface BackendInfo {
  installed: boolean;
  enabled: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

interface BackendStatus {
  docker: BackendInfo;
  cloudHypervisor: BackendInfo;
  firecracker: BackendInfo;
  daytona: BackendInfo;
}

// Helper to check if a binary exists in PATH or common locations
async function findBinary(name: string, additionalPaths: string[] = []): Promise<string | null> {
  // Check common installation paths
  const paths = [
    ...additionalPaths,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/opt/${name}/${name}`,
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Try which command
  try {
    const { stdout } = await execAsync(`which ${name}`);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Get version from binary
async function getBinaryVersion(binary: string, versionArg: string = '--version'): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`${binary} ${versionArg} 2>&1`);
    // Extract version number from output
    const match = stdout.match(/(\d+\.\d+\.?\d*)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

// Check Docker status
async function getDockerStatus(): Promise<BackendInfo> {
  const info: BackendInfo = {
    installed: false,
    enabled: false,
    running: false,
  };

  // Check if Docker is installed
  const dockerPath = await findBinary('docker');
  if (!dockerPath) {
    return info;
  }

  info.installed = true;
  info.version = await getBinaryVersion(dockerPath);

  // Check if Docker daemon is running
  try {
    const connected = await testConnection();
    info.running = connected;
    info.enabled = connected; // If Docker is running, it's enabled
  } catch (err) {
    info.error = err instanceof Error ? err.message : 'Failed to connect to Docker';
  }

  return info;
}

// Check Cloud-Hypervisor status
async function getCloudHypervisorStatus(): Promise<BackendInfo> {
  const info: BackendInfo = {
    installed: false,
    enabled: false,
    running: false,
  };

  // Check if cloud-hypervisor binary exists
  const chPath = await findBinary('cloud-hypervisor');
  if (!chPath) {
    return info;
  }

  info.installed = true;
  info.version = await getBinaryVersion(chPath);

  // Check KVM availability (required for cloud-hypervisor)
  try {
    if (existsSync('/dev/kvm')) {
      info.enabled = true;
      // Check if any cloud-hypervisor processes are running
      const { stdout } = await execAsync('pgrep -f cloud-hypervisor 2>/dev/null || true');
      info.running = stdout.trim().length > 0;
    } else {
      info.error = 'KVM not available - check virtualization support';
    }
  } catch {
    info.enabled = existsSync('/dev/kvm');
  }

  return info;
}

// Check Firecracker status
async function getFirecrackerStatus(): Promise<BackendInfo> {
  const info: BackendInfo = {
    installed: false,
    enabled: false,
    running: false,
  };

  // Check if firecracker binary exists
  const fcPath = await findBinary('firecracker');
  if (!fcPath) {
    return info;
  }

  info.installed = true;
  info.version = await getBinaryVersion(fcPath);

  // Check KVM availability (required for Firecracker)
  try {
    if (existsSync('/dev/kvm')) {
      info.enabled = true;
      // Check if any firecracker processes are running
      const { stdout } = await execAsync('pgrep -f firecracker 2>/dev/null || true');
      info.running = stdout.trim().length > 0;
    } else {
      info.error = 'KVM not available - check virtualization support';
    }
  } catch {
    info.enabled = existsSync('/dev/kvm');
  }

  return info;
}

// Check Daytona cloud backend status (doesn't hit API - just checks config)
// Use the /backends/daytona/test endpoint for actual connectivity checks
async function getDaytonaStatus(): Promise<BackendInfo> {
  const info: BackendInfo = {
    installed: false,
    enabled: false,
    running: false,
  };

  try {
    const config = await getConfig();
    const daytona = config.cloudBackends?.daytona;

    // If no API key is configured, it's not installed (from user perspective)
    if (!daytona?.apiKey) {
      return info;
    }

    // API key is configured, so it's "installed"
    info.installed = true;
    info.enabled = daytona.enabled ?? false;

    // Don't hit the Daytona API on regular status polling to avoid rate limits
    // Assume it's running if enabled - use test endpoint for explicit checks
    if (daytona.enabled) {
      info.running = true;
    }
  } catch (err) {
    info.error = err instanceof Error ? err.message : 'Failed to check Daytona status';
  }

  return info;
}

// GET /backends/status - Get status of all backends
backends.get('/status', async (c) => {
  const [docker, cloudHypervisor, firecracker, daytona] = await Promise.all([
    getDockerStatus(),
    getCloudHypervisorStatus(),
    getFirecrackerStatus(),
    getDaytonaStatus(),
  ]);

  const status: BackendStatus = {
    docker,
    cloudHypervisor,
    firecracker,
    daytona,
  };

  return c.json(status);
});

// POST /backends/:backend/enable - Enable a backend
backends.post('/:backend/enable', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      // Docker doesn't really have an "enable" concept through our app
      // It's either running or not via systemd
      try {
        await execAsync('sudo -n systemctl start docker');
        return c.json({ success: true, message: 'Docker service started' });
      } catch (err) {
        return c.json({ success: false, message: 'Run: sudo systemctl start docker' }, 500);
      }

    case 'cloud-hypervisor':
    case 'firecracker':
      // These are just binary tools, enabling means ensuring KVM is accessible
      if (existsSync('/dev/kvm')) {
        return c.json({ success: true, message: `${backend} is ready (KVM available)` });
      }
      return c.json({ success: false, message: 'KVM not available' }, 400);

    case 'daytona':
      // Enable Daytona cloud backend
      try {
        const config = await getConfig();
        if (!config.cloudBackends?.daytona?.apiKey) {
          return c.json({ success: false, message: 'Daytona API key not configured' }, 400);
        }
        await setConfig({
          cloudBackends: {
            ...config.cloudBackends,
            daytona: {
              ...config.cloudBackends.daytona,
              enabled: true,
            },
          },
        });
        return c.json({ success: true, message: 'Daytona backend enabled' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to enable Daytona' }, 500);
      }

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// POST /backends/:backend/disable - Disable a backend
backends.post('/:backend/disable', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      try {
        await execAsync('sudo -n systemctl stop docker');
        return c.json({ success: true, message: 'Docker service stopped' });
      } catch (err) {
        return c.json({ success: false, message: 'Run: sudo systemctl stop docker' }, 500);
      }

    case 'cloud-hypervisor':
    case 'firecracker':
      // Can't really "disable" these - they're just binaries
      return c.json({ success: true, message: `${backend} doesn't require disabling` });

    case 'daytona':
      // Disable Daytona cloud backend
      try {
        const config = await getConfig();
        if (config.cloudBackends?.daytona) {
          await setConfig({
            cloudBackends: {
              ...config.cloudBackends,
              daytona: {
                ...config.cloudBackends.daytona,
                enabled: false,
              },
            },
          });
        }
        return c.json({ success: true, message: 'Daytona backend disabled' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to disable Daytona' }, 500);
      }

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// POST /backends/:backend/install - Install a backend
backends.post('/:backend/install', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      try {
        // Install Docker using official script
        await execAsync('curl -fsSL https://get.docker.com | sh', { timeout: 300000 });
        await execAsync('sudo -n usermod -aG docker $USER');
        return c.json({ success: true, message: 'Docker installed. You may need to log out and back in for group changes.' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to install Docker. See https://docs.docker.com/engine/install/' }, 500);
      }

    case 'cloud-hypervisor':
      try {
        // Use the install script if available
        const scriptPath = `${process.cwd()}/scripts/install-cloud-hypervisor.sh`;
        if (existsSync(scriptPath)) {
          await execAsync(`bash ${scriptPath}`, { timeout: 300000 });
        } else {
          // Fallback: Download from releases
          const arch = process.arch === 'x64' ? 'x86_64' : 'aarch64';
          await execAsync(`
            curl -sL https://github.com/cloud-hypervisor/cloud-hypervisor/releases/latest/download/cloud-hypervisor-static-${arch} -o /tmp/cloud-hypervisor &&
            chmod +x /tmp/cloud-hypervisor &&
            sudo -n mv /tmp/cloud-hypervisor /usr/local/bin/
          `, { timeout: 120000 });
        }
        return c.json({ success: true, message: 'Cloud-Hypervisor installed' });
      } catch (err) {
        return c.json({ success: false, message: 'Run: sudo ./scripts/install-cloud-hypervisor.sh' }, 500);
      }

    case 'firecracker':
      try {
        // Use the install script if available
        const scriptPath = `${process.cwd()}/scripts/install-firecracker.sh`;
        if (existsSync(scriptPath)) {
          await execAsync(`bash ${scriptPath}`, { timeout: 300000 });
        } else {
          // Fallback: Download from releases
          const arch = process.arch === 'x64' ? 'x86_64' : 'aarch64';
          await execAsync(`
            LATEST=$(curl -s https://api.github.com/repos/firecracker-microvm/firecracker/releases/latest | grep '"tag_name"' | cut -d'"' -f4) &&
            curl -sL "https://github.com/firecracker-microvm/firecracker/releases/download/\${LATEST}/firecracker-\${LATEST}-${arch}.tgz" -o /tmp/firecracker.tgz &&
            tar -xzf /tmp/firecracker.tgz -C /tmp &&
            sudo -n mv /tmp/release-\${LATEST}-${arch}/firecracker-\${LATEST}-${arch} /usr/local/bin/firecracker &&
            rm -rf /tmp/firecracker.tgz /tmp/release-*
          `, { timeout: 120000 });
        }
        return c.json({ success: true, message: 'Firecracker installed' });
      } catch (err) {
        return c.json({ success: false, message: 'Run: sudo ./scripts/install-firecracker.sh' }, 500);
      }

    case 'daytona':
      // Daytona is a cloud service - "install" means configure it
      return c.json({
        success: false,
        message: 'Daytona is a cloud service. Configure it via the Cloud Backends settings.',
      }, 400);

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// POST /backends/:backend/uninstall - Uninstall a backend
backends.post('/:backend/uninstall', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      try {
        await execAsync('sudo -n apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin');
        await execAsync('sudo -n rm -rf /var/lib/docker /var/lib/containerd');
        return c.json({ success: true, message: 'Docker uninstalled' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to uninstall Docker. See https://docs.docker.com/engine/install/' }, 500);
      }

    case 'cloud-hypervisor':
      try {
        await execAsync('sudo -n rm -f /usr/local/bin/cloud-hypervisor');
        return c.json({ success: true, message: 'Cloud-Hypervisor uninstalled' });
      } catch (err) {
        return c.json({ success: false, message: 'Run: sudo rm -f /usr/local/bin/cloud-hypervisor' }, 500);
      }

    case 'firecracker':
      try {
        await execAsync('sudo -n rm -f /usr/local/bin/firecracker');
        return c.json({ success: true, message: 'Firecracker uninstalled' });
      } catch (err) {
        return c.json({ success: false, message: 'Run: sudo rm -f /usr/local/bin/firecracker' }, 500);
      }

    case 'daytona':
      // Remove Daytona configuration
      try {
        const config = await getConfig();
        await setConfig({
          cloudBackends: {
            ...config.cloudBackends,
            daytona: undefined,
          },
        });
        return c.json({ success: true, message: 'Daytona configuration removed' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to remove Daytona configuration' }, 500);
      }

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// ============ Cloud Backends ============

// POST /backends/daytona/configure - Configure Daytona cloud backend
backends.post('/daytona/configure', async (c) => {
  try {
    const body = await c.req.json();
    const { apiUrl, apiKey, enabled } = body as {
      apiUrl?: string;
      apiKey?: string;
      enabled?: boolean;
    };

    const config = await getConfig();
    const currentDaytona = config.cloudBackends?.daytona || {
      apiUrl: 'https://app.daytona.io/api',
      apiKey: '',
      enabled: false,
    };

    const newDaytona = {
      apiUrl: apiUrl ?? currentDaytona.apiUrl,
      apiKey: apiKey ?? currentDaytona.apiKey,
      enabled: enabled ?? currentDaytona.enabled,
    };

    await setConfig({
      cloudBackends: {
        ...config.cloudBackends,
        daytona: newDaytona,
      },
    });

    return c.json({ success: true, daytona: { ...newDaytona, apiKey: '***' } });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /backends/daytona/test - Test Daytona API connection
backends.post('/daytona/test', async (c) => {
  try {
    const body = await c.req.json();
    const { apiUrl, apiKey } = body as { apiUrl?: string; apiKey?: string };

    const config = await getConfig();
    const testApiUrl = apiUrl || config.cloudBackends?.daytona?.apiUrl || 'https://app.daytona.io/api';
    const testApiKey = apiKey || config.cloudBackends?.daytona?.apiKey;

    if (!testApiKey) {
      return c.json({ success: false, error: 'API key is required' }, 400);
    }

    // Test the API connection
    const response = await fetch(`${testApiUrl}/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      return c.json({ success: true, message: 'Connection successful' });
    } else {
      const errorText = await response.text().catch(() => 'Unknown error');
      return c.json({
        success: false,
        error: `API returned ${response.status}: ${errorText}`,
      });
    }
  } catch (err) {
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    }, 500);
  }
});

// POST /backends/daytona/refresh - Force refresh Daytona workspace cache
backends.post('/daytona/refresh', async (c) => {
  try {
    const daytona = getDaytonaService();
    if (!await daytona.isAvailable()) {
      return c.json({ success: false, error: 'Daytona is not configured or enabled' }, 400);
    }
    daytona.invalidateCache();
    return c.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /backends/daytona/config - Get Daytona configuration (without API key)
backends.get('/daytona/config', async (c) => {
  try {
    const config = await getConfig();
    const daytona = config.cloudBackends?.daytona;

    if (!daytona) {
      return c.json({
        configured: false,
        apiUrl: 'https://app.daytona.io/api',
        enabled: false,
      });
    }

    return c.json({
      configured: !!daytona.apiKey,
      apiUrl: daytona.apiUrl,
      enabled: daytona.enabled,
      hasApiKey: !!daytona.apiKey,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============ Daytona Volumes ============

// GET /backends/daytona/volumes - List all Daytona volumes
backends.get('/daytona/volumes', async (c) => {
  try {
    const daytona = getDaytonaService();
    if (!await daytona.isAvailable()) {
      return c.json({ error: 'Daytona is not configured or enabled' }, 400);
    }
    const volumes = await daytona.listVolumes();
    return c.json(volumes);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// GET /backends/daytona/volumes/:id - Get a specific Daytona volume
backends.get('/daytona/volumes/:id', async (c) => {
  try {
    const daytona = getDaytonaService();
    if (!await daytona.isAvailable()) {
      return c.json({ error: 'Daytona is not configured or enabled' }, 400);
    }
    const volume = await daytona.getVolume(c.req.param('id'));
    if (!volume) {
      return c.json({ error: 'Volume not found' }, 404);
    }
    return c.json(volume);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// POST /backends/daytona/volumes - Create a new Daytona volume
backends.post('/daytona/volumes', async (c) => {
  try {
    const daytona = getDaytonaService();
    if (!await daytona.isAvailable()) {
      return c.json({ error: 'Daytona is not configured or enabled' }, 400);
    }
    const body = await c.req.json();
    const { name } = body as { name: string };
    if (!name) {
      return c.json({ error: 'Volume name is required' }, 400);
    }
    const volume = await daytona.createVolume(name);
    return c.json(volume, 201);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// DELETE /backends/daytona/volumes/:id - Delete a Daytona volume
backends.delete('/daytona/volumes/:id', async (c) => {
  try {
    const daytona = getDaytonaService();
    if (!await daytona.isAvailable()) {
      return c.json({ error: 'Daytona is not configured or enabled' }, 400);
    }
    await daytona.deleteVolume(c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// ============ Host Stats ============

interface HostStats {
  cpu: {
    usage: number; // percentage
    cores: number;
    model: string;
  };
  memory: {
    total: number; // bytes
    used: number;
    free: number;
    usage: number; // percentage
  };
  disk: {
    total: number; // bytes
    used: number;
    free: number;
    usage: number; // percentage
  };
  uptime: number; // seconds
  hostname: string;
}

// Get CPU usage by reading /proc/stat
async function getCpuUsage(): Promise<number> {
  try {
    const stat1 = readFileSync('/proc/stat', 'utf8');
    const line1 = stat1.split('\n')[0];
    const parts1 = line1.split(/\s+/).slice(1).map(Number);

    await new Promise(resolve => setTimeout(resolve, 100));

    const stat2 = readFileSync('/proc/stat', 'utf8');
    const line2 = stat2.split('\n')[0];
    const parts2 = line2.split(/\s+/).slice(1).map(Number);

    const idle1 = parts1[3] + parts1[4];
    const idle2 = parts2[3] + parts2[4];
    const total1 = parts1.reduce((a, b) => a + b, 0);
    const total2 = parts2.reduce((a, b) => a + b, 0);

    const idleDelta = idle2 - idle1;
    const totalDelta = total2 - total1;

    return Math.round((1 - idleDelta / totalDelta) * 100);
  } catch {
    return 0;
  }
}

// Get disk usage for root filesystem
async function getDiskUsage(): Promise<{ total: number; used: number; free: number; usage: number }> {
  try {
    const { stdout } = await execAsync('df -B1 / | tail -1');
    const parts = stdout.trim().split(/\s+/);
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const free = parseInt(parts[3], 10);
    return {
      total,
      used,
      free,
      usage: Math.round((used / total) * 100),
    };
  } catch {
    return { total: 0, used: 0, free: 0, usage: 0 };
  }
}

// GET /backends/host-stats - Get host system statistics
backends.get('/host-stats', async (c) => {
  const cpus = os.cpus();
  const cpuUsage = await getCpuUsage();
  const diskStats = await getDiskUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const stats: HostStats = {
    cpu: {
      usage: cpuUsage,
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usage: Math.round((usedMem / totalMem) * 100),
    },
    disk: diskStats,
    uptime: os.uptime(),
    hostname: os.hostname(),
  };

  return c.json(stats);
});

export default backends;
