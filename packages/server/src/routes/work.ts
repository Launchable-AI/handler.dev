/**
 * Work routes - start work on repositories
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { startWork, getWorkStatus } from '../services/work.js';

const work = new Hono();

// Start work on a repository
work.post(
  '/start',
  zValidator(
    'json',
    z.object({
      repoFullName: z.string().min(1),
      branch: z.string().optional(),
      backend: z.enum(['docker', 'cloud-hypervisor', 'firecracker', 'daytona', 'aws', 'azure', 'gcp', 'digitalocean', 'linode']),
      agentConfigId: z.string().optional(),
    })
  ),
  async (c) => {
    try {
      const options = c.req.valid('json');
      const result = await startWork(options);
      return c.json(result);
    } catch (error) {
      console.error('[Work] Failed to start work:', error);
      return c.json({
        error: error instanceof Error ? error.message : 'Failed to start work'
      }, 500);
    }
  }
);

// Get work status
work.get('/status/:sandboxId', async (c) => {
  try {
    const { sandboxId } = c.req.param();
    const status = await getWorkStatus(sandboxId);
    return c.json(status);
  } catch (error) {
    console.error('[Work] Failed to get status:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to get status'
    }, 500);
  }
});

export default work;
