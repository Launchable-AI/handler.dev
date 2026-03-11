import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Mock Docker service before importing anything that uses it
vi.mock('../../services/docker.js', () => ({
  testConnection: vi.fn(),
}));

import { testConnection } from '../../services/docker.js';

const mockTestConnection = vi.mocked(testConnection);

// Reproduce the health endpoint from index.ts to test in isolation
function createHealthApp() {
  const app = new Hono();
  app.get('/api/health', async (c) => {
    const dockerConnected = await mockTestConnection();

    return c.json({
      status: 'ok',
      docker: dockerConnected ? 'connected' : 'disconnected',
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

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.docker).toBe('connected');
  });

  it('returns docker disconnected when Docker is unavailable', async () => {
    mockTestConnection.mockResolvedValue(false);

    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.docker).toBe('disconnected');
  });

  it('reports devMode based on environment variable', async () => {
    mockTestConnection.mockResolvedValue(true);

    const original = process.env.environment;
    process.env.environment = 'development';

    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.devMode).toBe(true);

    process.env.environment = original;
  });

  it('devMode is false when not in development', async () => {
    mockTestConnection.mockResolvedValue(true);

    const original = process.env.environment;
    delete process.env.environment;

    const res = await app.request('/api/health');
    const body = await res.json();
    expect(body.devMode).toBe(false);

    process.env.environment = original;
  });
});
