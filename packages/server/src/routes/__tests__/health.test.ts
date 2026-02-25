import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock Docker and Hypervisor services before importing anything that uses them
vi.mock('../../services/docker.js', () => ({
  testConnection: vi.fn(),
}));

vi.mock('../../services/hypervisor.js', () => ({
  getCloudHypervisorService: vi.fn(),
}));

import { testConnection } from '../../services/docker.js';
import { getCloudHypervisorService } from '../../services/hypervisor.js';

const mockTestConnection = vi.mocked(testConnection);
const mockGetHypervisor = vi.mocked(getCloudHypervisorService);

// Reproduce the health endpoint from index.ts to test in isolation
function createHealthApp() {
  const app = new Hono();
  app.get('/api/health', async (c) => {
    const dockerConnected = await mockTestConnection();

    let hypervisor = null;
    try {
      const service = mockGetHypervisor();
      const networkStatus = (service as any).getNetworkStatus();
      const vmStats = (service as any).getStats();
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
      devMode: process.env.environment === 'development',
    });
  });
  return app;
}

describe('GET /api/health', () => {
  let app: ReturnType<typeof createHealthApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createHealthApp();
  });

  it('returns status ok with docker connected', async () => {
    mockTestConnection.mockResolvedValue(true);
    mockGetHypervisor.mockImplementation(() => { throw new Error('not init'); });

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.docker).toBe('connected');
    expect(body.hypervisor).toEqual({ initialized: false });
  });

  it('returns docker disconnected when Docker is unavailable', async () => {
    mockTestConnection.mockResolvedValue(false);
    mockGetHypervisor.mockImplementation(() => { throw new Error('not init'); });

    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.docker).toBe('disconnected');
  });

  it('includes hypervisor info when initialized', async () => {
    mockTestConnection.mockResolvedValue(true);
    mockGetHypervisor.mockReturnValue({
      getNetworkStatus: () => ({ healthy: true }),
      getStats: () => ({ running: 2, total: 5 }),
    } as any);

    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.hypervisor).toEqual({
      initialized: true,
      network: 'healthy',
      vms: { running: 2, total: 5 },
    });
  });

  it('reports devMode based on environment variable', async () => {
    mockTestConnection.mockResolvedValue(true);
    mockGetHypervisor.mockImplementation(() => { throw new Error('not init'); });

    const original = process.env.environment;
    process.env.environment = 'development';

    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.devMode).toBe(true);

    process.env.environment = original;
  });

  it('devMode is false when not in development', async () => {
    mockTestConnection.mockResolvedValue(true);
    mockGetHypervisor.mockImplementation(() => { throw new Error('not init'); });

    const original = process.env.environment;
    delete process.env.environment;

    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.devMode).toBe(false);

    process.env.environment = original;
  });
});
