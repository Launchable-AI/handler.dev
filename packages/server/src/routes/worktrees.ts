import { Hono } from 'hono';
import * as worktreeService from '../services/worktree.js';
import type { CommandRunner } from '../services/worktree.js';
import { getSandboxService, initializeSandboxService } from '../services/sandbox/index.js';
import { getFirecrackerService } from '../services/firecracker.js';
import { execInSandbox } from '../lib/exec-in-sandbox.js';

const worktrees = new Hono();

// Lazy initialization state (mirrors sandboxes.ts pattern)
let sandboxServiceInitialized = false;

async function ensureSandboxServiceInitialized() {
  if (sandboxServiceInitialized) {
    return getSandboxService();
  }
  await initializeSandboxService();
  sandboxServiceInitialized = true;
  return getSandboxService();
}

/**
 * Build a CommandRunner for the given sandbox that dispatches to
 * Docker exec or SSH depending on the backend.
 */
function buildRunner(sandbox: { id: string; backend: string; guestIp?: string }): CommandRunner {
  return (cmd: string) => execInSandbox(sandbox, cmd);
}

// Fork a worktree from a sandbox
worktrees.post('/fork', async (c) => {
  try {
    const body = await c.req.json();
    const { sandboxId, branchName, baseBranch, cwd } = body;

    if (!sandboxId || !branchName) {
      return c.json({ error: 'sandboxId and branchName are required' }, 400);
    }

    // Resolve the sandbox to determine backend
    const service = await ensureSandboxServiceInitialized();
    const sandbox = await service.get(sandboxId);
    if (!sandbox) {
      return c.json({ error: `Sandbox ${sandboxId} not found` }, 404);
    }
    if (sandbox.status !== 'running') {
      return c.json({ error: 'Sandbox is not running' }, 400);
    }

    const run = buildRunner(sandbox);

    const result = await worktreeService.forkWorktree({
      sandboxId,
      branchName,
      baseBranch,
      cwd,
      run,
    });

    return c.json({
      id: result.id,
      sandboxId: result.sandboxId,
      worktreePath: result.worktreePath,
      branch: result.branch,
    });
  } catch (err) {
    console.error('Failed to fork worktree:', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to fork worktree' },
      500
    );
  }
});

/**
 * Clone a Firecracker VM via snapshot.
 * Takes a snapshot, waits for disk to be ready, boots a new VM from it.
 */
async function cloneVm(
  sandbox: { id: string; backend: string },
  cloneName: string,
): Promise<{ id: string; sandboxId: string; ip?: string; backendType: string; name: string }> {
  const fcService = getFirecrackerService();
  if (!fcService) {
    throw new Error('Firecracker service not available');
  }

  // 1. Create a snapshot
  const snapshot = await fcService.createSnapshot(sandbox.id, cloneName);

  // 2. Wait for disk copy to complete (poll up to 60s)
  const maxWait = 60_000;
  const pollInterval = 500;
  let waited = 0;
  while (!snapshot.diskReady && waited < maxWait) {
    await new Promise(r => setTimeout(r, pollInterval));
    waited += pollInterval;
    const snapshots = fcService.listVmSnapshots(sandbox.id);
    const latest = snapshots.find(s => s.id === snapshot.id);
    if (latest?.diskReady) {
      snapshot.diskReady = true;
      break;
    }
  }

  if (!snapshot.diskReady) {
    throw new Error('Snapshot disk copy timed out. Try again shortly.');
  }

  // 3. Create a new VM from the snapshot
  const newVm = await fcService.createVm({
    name: cloneName,
    fromSnapshot: { vmId: sandbox.id, snapshotId: snapshot.id },
  });

  return {
    id: `clone-${newVm.id}`,
    sandboxId: `fc-${newVm.id}`,
    ip: newVm.guestIp,
    backendType: sandbox.backend,
    name: cloneName,
  };
}

// Clone a Firecracker VM (independent duplicate via snapshot)
worktrees.post('/clone', async (c) => {
  try {
    const body = await c.req.json();
    const { sandboxId, name } = body;

    if (!sandboxId) {
      return c.json({ error: 'sandboxId is required' }, 400);
    }

    const service = await ensureSandboxServiceInitialized();
    const sandbox = await service.get(sandboxId);
    if (!sandbox) {
      return c.json({ error: `Sandbox ${sandboxId} not found` }, 404);
    }
    if (sandbox.status !== 'running') {
      return c.json({ error: 'Sandbox is not running' }, 400);
    }
    if (sandbox.backend !== 'firecracker') {
      return c.json({ error: 'Clone is only supported for Firecracker VMs' }, 400);
    }

    // Auto-generate name if not provided
    const cloneName = name || `${sandbox.name || sandboxId}-clone-${Date.now()}`;

    const result = await cloneVm(sandbox, cloneName);
    return c.json(result);
  } catch (err) {
    console.error('Failed to clone VM:', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to clone VM' },
      500
    );
  }
});

// List worktrees for a sandbox
worktrees.get('/:sandboxId', async (c) => {
  try {
    const sandboxId = c.req.param('sandboxId');

    const service = await ensureSandboxServiceInitialized();
    const sandbox = await service.get(sandboxId);
    if (!sandbox || sandbox.status !== 'running') {
      return c.json([]);
    }

    const run = buildRunner(sandbox);
    const list = await worktreeService.listWorktrees(sandboxId, run);
    return c.json(list);
  } catch (err) {
    console.error('Failed to list worktrees:', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to list worktrees' },
      500
    );
  }
});

// Merge a worktree branch back to parent
worktrees.post('/merge', async (c) => {
  try {
    const body = await c.req.json();
    const { sandboxId, worktreeId, strategy } = body;

    if (!sandboxId || !worktreeId) {
      return c.json({ error: 'sandboxId and worktreeId are required' }, 400);
    }

    const service = await ensureSandboxServiceInitialized();
    const sandbox = await service.get(sandboxId);
    if (!sandbox || sandbox.status !== 'running') {
      return c.json({ error: 'Sandbox not found or not running' }, 400);
    }

    const run = buildRunner(sandbox);
    const result = await worktreeService.mergeWorktree({
      sandboxId,
      worktreeId,
      strategy,
      run,
    });

    return c.json(result);
  } catch (err) {
    console.error('Failed to merge worktree:', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to merge worktree' },
      500
    );
  }
});

// Delete a worktree
worktrees.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    // Try to get the record to find the sandbox for cleanup
    const record = worktreeService.getWorktreeRecord(id);
    let run: CommandRunner | undefined;

    if (record) {
      const service = await ensureSandboxServiceInitialized();
      const sandbox = await service.get(record.sandboxId);
      if (sandbox && sandbox.status === 'running') {
        run = buildRunner(sandbox);
      }
    }

    await worktreeService.deleteWorktree(id, run);
    return c.json({ success: true });
  } catch (err) {
    console.error('Failed to delete worktree:', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to delete worktree' },
      500
    );
  }
});

// Get worktree status
worktrees.get('/:id/status', async (c) => {
  try {
    const id = c.req.param('id');

    const record = worktreeService.getWorktreeRecord(id);
    if (!record) {
      return c.json({ error: `Worktree ${id} not found` }, 404);
    }

    const service = await ensureSandboxServiceInitialized();
    const sandbox = await service.get(record.sandboxId);
    if (!sandbox || sandbox.status !== 'running') {
      return c.json({ error: 'Sandbox not found or not running' }, 400);
    }

    const run = buildRunner(sandbox);
    const status = await worktreeService.getWorktreeStatus(id, run);
    return c.json(status);
  } catch (err) {
    console.error('Failed to get worktree status:', err);
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to get worktree status' },
      500
    );
  }
});

export default worktrees;
