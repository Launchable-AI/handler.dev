import { Hono } from 'hono';
import * as worktreeService from '../services/worktree.js';

const worktrees = new Hono();

// Fork a worktree from a sandbox
worktrees.post('/fork', async (c) => {
  try {
    const body = await c.req.json();
    const { sandboxId, branchName, baseBranch, cwd } = body;

    if (!sandboxId || !branchName) {
      return c.json({ error: 'sandboxId and branchName are required' }, 400);
    }

    const result = await worktreeService.forkWorktree({
      sandboxId,
      branchName,
      baseBranch,
      cwd,
    });

    return c.json({
      id: result.id,
      sandboxId: result.containerId,
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

// List worktrees for a sandbox
worktrees.get('/:sandboxId', async (c) => {
  try {
    const sandboxId = c.req.param('sandboxId');
    const list = await worktreeService.listWorktrees(sandboxId);
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

    const result = await worktreeService.mergeWorktree({
      sandboxId,
      worktreeId,
      strategy,
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
    await worktreeService.deleteWorktree(id);
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
    const status = await worktreeService.getWorktreeStatus(id);
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
