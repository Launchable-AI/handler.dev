/**
 * Backend-agnostic worktree service.
 *
 * All command execution is delegated to a `CommandRunner` provided by the
 * caller (typically the route layer), which dispatches to Docker exec or SSH
 * depending on the sandbox backend.
 */

/**
 * A function that runs a shell command inside a sandbox.
 * The runner is responsible for targeting the correct backend (Docker exec, SSH, etc.).
 * @param cmd  Shell command string to execute
 * @returns stdout as a string
 */
export type CommandRunner = (cmd: string) => Promise<string>;

interface WorktreeRecord {
  id: string;
  sandboxId: string;
  branch: string;
  worktreePath: string;
  gitRoot: string;
  status: 'creating' | 'ready' | 'merging' | 'merged' | 'error';
}

// In-memory store of worktree records
const worktrees = new Map<string, WorktreeRecord>();

/**
 * Create a git worktree inside a sandbox.
 */
export async function forkWorktree(options: {
  sandboxId: string;
  branchName: string;
  baseBranch?: string;
  cwd?: string;
  run: CommandRunner;
}): Promise<WorktreeRecord> {
  const { sandboxId, branchName, baseBranch, cwd, run } = options;
  const id = `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const worktreePath = `/home/agent/worktrees/${branchName}`;

  // Resolve the git toplevel from the provided cwd (or default workspace)
  const startDir = cwd || '/home/agent';
  let gitRoot: string;
  try {
    gitRoot = (await run(
      `cd ${JSON.stringify(startDir)} && git rev-parse --show-toplevel`
    )).trim();
  } catch {
    throw new Error(`No git repository found at ${startDir}`);
  }

  const record: WorktreeRecord = {
    id,
    sandboxId,
    branch: branchName,
    worktreePath,
    gitRoot,
    status: 'creating',
  };
  worktrees.set(id, record);

  try {
    // Ensure /worktrees directory exists
    await run('mkdir -p /home/agent/worktrees');

    // Check if the repo has any commits (HEAD must be valid)
    try {
      await run(`cd ${JSON.stringify(gitRoot)} && git rev-parse HEAD`);
    } catch {
      throw new Error('Cannot fork: repository has no commits yet. Make at least one commit first.');
    }

    // Create the worktree (run from the git root)
    const base = baseBranch || 'HEAD';
    await run(
      `cd ${JSON.stringify(gitRoot)} && git worktree add -b ${JSON.stringify(branchName)} ${JSON.stringify(worktreePath)} ${JSON.stringify(base)}`
    );

    record.status = 'ready';
    worktrees.set(id, record);
    return record;
  } catch (err) {
    record.status = 'error';
    worktrees.set(id, record);
    throw err;
  }
}

/**
 * List worktrees for a given sandbox.
 */
export async function listWorktrees(sandboxId: string, run: CommandRunner): Promise<Array<{
  id: string;
  branch: string;
  path: string;
  head: string;
}>> {
  try {
    const output = await run('git worktree list --porcelain');
    const worktreeList: Array<{ id: string; branch: string; path: string; head: string }> = [];
    const blocks = output.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      let path = '';
      let head = '';
      let branch = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) path = line.slice(9);
        if (line.startsWith('HEAD ')) head = line.slice(5);
        if (line.startsWith('branch ')) branch = line.slice(7).replace('refs/heads/', '');
      }

      if (path) {
        worktreeList.push({
          id: `wt-${path}`,
          branch: branch || 'detached',
          path,
          head,
        });
      }
    }

    return worktreeList;
  } catch {
    return [];
  }
}

/**
 * Merge a worktree branch back into its parent branch.
 */
export async function mergeWorktree(options: {
  sandboxId: string;
  worktreeId: string;
  strategy?: 'merge' | 'rebase';
  run: CommandRunner;
}): Promise<{ success: boolean; conflicts?: string[] }> {
  const { sandboxId, worktreeId, strategy = 'merge', run } = options;
  const record = worktrees.get(worktreeId);
  if (!record) {
    throw new Error(`Worktree ${worktreeId} not found`);
  }

  record.status = 'merging';
  worktrees.set(worktreeId, record);

  const gitRoot = record.gitRoot;

  try {
    if (strategy === 'rebase') {
      await run(`cd ${JSON.stringify(gitRoot)} && git rebase ${JSON.stringify(record.branch)}`);
    } else {
      await run(
        `cd ${JSON.stringify(gitRoot)} && git merge ${JSON.stringify(record.branch)} --no-ff -m ${JSON.stringify(`Merge worktree branch '${record.branch}'`)}`
      );
    }

    record.status = 'merged';
    worktrees.set(worktreeId, record);
    return { success: true };
  } catch (err) {
    // Check for merge conflicts
    try {
      const statusOutput = await run(`cd ${JSON.stringify(gitRoot)} && git diff --name-only --diff-filter=U`);
      const conflicts = statusOutput.trim().split('\n').filter(Boolean);
      if (conflicts.length > 0) {
        // Abort the merge
        await run(`cd ${JSON.stringify(gitRoot)} && git merge --abort`).catch(() => {});
        record.status = 'error';
        worktrees.set(worktreeId, record);
        return { success: false, conflicts };
      }
    } catch {
      // ignore
    }

    record.status = 'error';
    worktrees.set(worktreeId, record);
    throw err;
  }
}

/**
 * Delete a worktree and clean up the branch.
 */
export async function deleteWorktree(worktreeId: string, run?: CommandRunner): Promise<void> {
  const record = worktrees.get(worktreeId);
  if (!record) {
    // Record lost (e.g. server restart) — nothing to clean up server-side
    worktrees.delete(worktreeId);
    return;
  }

  // Remove git worktree
  if (run && record.worktreePath) {
    const workdir = record.gitRoot || '/home/agent';
    try {
      await run(`cd ${JSON.stringify(workdir)} && git worktree remove ${JSON.stringify(record.worktreePath)} --force`);
    } catch {
      // Worktree may already be removed
    }

    // Delete the branch
    if (record.branch) {
      try {
        await run(`cd ${JSON.stringify(workdir)} && git branch -D ${JSON.stringify(record.branch)}`);
      } catch {
        // Branch may already be deleted
      }
    }
  }

  worktrees.delete(worktreeId);
}

/**
 * Get status of a worktree (clean/dirty/conflict).
 */
export async function getWorktreeStatus(worktreeId: string, run: CommandRunner): Promise<{
  status: 'clean' | 'dirty' | 'conflict';
  changedFiles?: string[];
  conflictFiles?: string[];
}> {
  const record = worktrees.get(worktreeId);
  if (!record) {
    throw new Error(`Worktree ${worktreeId} not found`);
  }

  try {
    const statusOutput = await run(`git -C ${JSON.stringify(record.worktreePath)} status --porcelain`);

    const lines = statusOutput.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      return { status: 'clean' };
    }

    const conflictFiles = lines
      .filter(l => l.startsWith('UU ') || l.startsWith('AA ') || l.startsWith('DD '))
      .map(l => l.slice(3));

    if (conflictFiles.length > 0) {
      return { status: 'conflict', conflictFiles };
    }

    const changedFiles = lines.map(l => l.slice(3));
    return { status: 'dirty', changedFiles };
  } catch {
    return { status: 'clean' };
  }
}

/**
 * Get a worktree record by ID.
 */
export function getWorktreeRecord(id: string): WorktreeRecord | undefined {
  return worktrees.get(id);
}
