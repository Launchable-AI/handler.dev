import Docker from 'dockerode';
import { PassThrough } from 'stream';
import { findAvailablePort, findAvailableSshPort } from '../utils/port.js';

const docker = new Docker();

interface WorktreeRecord {
  id: string;
  parentContainerId: string;
  childContainerId?: string;
  branch: string;
  worktreePath: string;
  gitRoot: string;
  ports: Array<{ container: number; host: number }>;
  status: 'creating' | 'ready' | 'merging' | 'merged' | 'error';
}

// In-memory store of worktree records
const worktrees = new Map<string, WorktreeRecord>();

/**
 * Execute a command inside a running container and return stdout.
 */
async function execInContainer(containerId: string, cmd: string[], workdir?: string): Promise<string> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    ...(workdir ? { WorkingDir: workdir } : {}),
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise<string>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    docker.modem.demuxStream(stream, stdout, stderr);

    stream.on('end', async () => {
      const output = Buffer.concat(stdoutChunks).toString('utf-8');
      const errOutput = Buffer.concat(stderrChunks).toString('utf-8');
      // Check exit code
      const inspect = await exec.inspect();
      if (inspect.ExitCode !== 0) {
        reject(new Error(`Command failed (exit ${inspect.ExitCode}): ${errOutput || output}`));
      } else {
        resolve(output);
      }
    });
    stream.on('error', reject);
  });
}

/**
 * Create a git worktree inside a container and optionally spawn a child container.
 */
export async function forkWorktree(options: {
  sandboxId: string;
  branchName: string;
  baseBranch?: string;
  cwd?: string;
}): Promise<WorktreeRecord> {
  const { sandboxId, branchName, baseBranch, cwd } = options;
  const id = `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const worktreePath = `/home/dev/worktrees/${branchName}`;

  // Resolve the git toplevel from the provided cwd (or default workspace)
  const startDir = cwd || '/home/dev/workspace';
  let gitRoot: string;
  try {
    gitRoot = (await execInContainer(sandboxId, [
      'git', 'rev-parse', '--show-toplevel',
    ], startDir)).trim();
  } catch {
    throw new Error(`No git repository found at ${startDir}`);
  }

  const record: WorktreeRecord = {
    id,
    parentContainerId: sandboxId,
    branch: branchName,
    worktreePath,
    gitRoot,
    ports: [],
    status: 'creating',
  };
  worktrees.set(id, record);

  try {

    // Ensure /worktrees directory exists
    await execInContainer(sandboxId, ['mkdir', '-p', '/home/dev/worktrees']);

    // Check if the repo has any commits (HEAD must be valid)
    try {
      await execInContainer(sandboxId, ['git', 'rev-parse', 'HEAD'], gitRoot);
    } catch {
      throw new Error('Cannot fork: repository has no commits yet. Make at least one commit first.');
    }

    // Create the worktree (run from the git root)
    const base = baseBranch || 'HEAD';
    await execInContainer(sandboxId, [
      'git', 'worktree', 'add', '-b', branchName, worktreePath, base,
    ], gitRoot);

    // Get parent container info for image and port configuration
    const parentContainer = docker.getContainer(sandboxId);
    const parentInfo = await parentContainer.inspect();
    const parentImage = parentInfo.Config.Image;

    // Determine port offsets from parent's ports
    const parentPorts: Array<{ container: number; host: number }> = [];
    for (const [key, bindings] of Object.entries(parentInfo.NetworkSettings.Ports)) {
      if (!bindings) continue;
      const containerPort = parseInt(key.split('/')[0], 10);
      if (containerPort === 22) continue;
      const hostPort = parseInt(bindings[0]?.HostPort, 10);
      if (containerPort && hostPort) {
        parentPorts.push({ container: containerPort, host: hostPort });
      }
    }

    // Find available ports for the child container
    const childPorts: Array<{ container: number; host: number }> = [];
    for (const pp of parentPorts) {
      const newHostPort = await findAvailablePort(pp.host + 1);
      childPorts.push({ container: pp.container, host: newHostPort });
    }

    // Find SSH port for child
    const childSshPort = await findAvailableSshPort();

    // Get the host path of the worktree from the parent container's mounts
    // The worktree is inside the parent container, so we need to share it via a volume
    // Strategy: use the parent container's ID to create a volumes-from relationship
    const exposedPorts: Record<string, object> = { '22/tcp': {} };
    const portBindings: Record<string, Array<{ HostPort: string }>> = {
      '22/tcp': [{ HostPort: childSshPort.toString() }],
    };

    for (const port of childPorts) {
      const key = `${port.container}/tcp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: port.host.toString() }];
    }

    // Create child container that shares the parent's filesystem via volumes-from
    // Override entrypoint/cmd to just keep the container alive for docker exec.
    // The parent image's entrypoint (e.g. sshd) may fail or conflict in the child.
    const childContainer = await docker.createContainer({
      name: `caisson-wt-${branchName}-${Date.now()}`,
      Hostname: branchName,
      Image: parentImage,
      Entrypoint: ['sleep'],
      Cmd: ['infinity'],
      Labels: {
        caisson: 'true',
        'caisson.worktree': 'true',
        'caisson.worktree.id': id,
        'caisson.worktree.parent': sandboxId,
        'caisson.worktree.branch': branchName,
      },
      ExposedPorts: exposedPorts,
      WorkingDir: worktreePath,
      HostConfig: {
        PortBindings: portBindings,
        VolumesFrom: [`${parentInfo.Id}`],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });

    await childContainer.start();

    // Wait for container to be fully running and ready for docker exec
    for (let i = 0; i < 10; i++) {
      const info = await childContainer.inspect();
      if (info.State.Running) break;
      await new Promise(r => setTimeout(r, 300));
    }

    record.childContainerId = childContainer.id;
    record.ports = childPorts;
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
 * List worktrees for a given sandbox (parent container).
 */
export async function listWorktrees(sandboxId: string): Promise<Array<{
  id: string;
  branch: string;
  path: string;
  head: string;
}>> {
  try {
    const output = await execInContainer(sandboxId, ['git', 'worktree', 'list', '--porcelain']);
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
}): Promise<{ success: boolean; conflicts?: string[] }> {
  const { sandboxId, worktreeId, strategy = 'merge' } = options;
  const record = worktrees.get(worktreeId);
  if (!record) {
    throw new Error(`Worktree ${worktreeId} not found`);
  }

  record.status = 'merging';
  worktrees.set(worktreeId, record);

  const gitRoot = record.gitRoot;

  try {
    // Get the current branch of the parent (main workspace)
    const currentBranch = (await execInContainer(sandboxId, [
      'git', 'rev-parse', '--abbrev-ref', 'HEAD',
    ], gitRoot)).trim();

    // Perform merge
    if (strategy === 'rebase') {
      await execInContainer(sandboxId, ['git', 'rebase', record.branch], gitRoot);
    } else {
      await execInContainer(sandboxId, [
        'git', 'merge', record.branch, '--no-ff', '-m', `Merge worktree branch '${record.branch}'`,
      ], gitRoot);
    }

    record.status = 'merged';
    worktrees.set(worktreeId, record);
    return { success: true };
  } catch (err) {
    // Check for merge conflicts
    try {
      const statusOutput = await execInContainer(sandboxId, ['git', 'diff', '--name-only', '--diff-filter=U'], gitRoot);
      const conflicts = statusOutput.trim().split('\n').filter(Boolean);
      if (conflicts.length > 0) {
        // Abort the merge
        await execInContainer(sandboxId, ['git', 'merge', '--abort'], gitRoot).catch(() => {});
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
 * Delete a worktree and its child container.
 */
export async function deleteWorktree(worktreeId: string): Promise<void> {
  let record = worktrees.get(worktreeId);

  // If record not in memory (e.g. server restarted), try to recover from Docker labels
  if (!record) {
    try {
      const containers = await docker.listContainers({
        all: true,
        filters: { label: [`caisson.worktree.id=${worktreeId}`] },
      });
      if (containers.length > 0) {
        const info = containers[0];
        record = {
          id: worktreeId,
          parentContainerId: info.Labels['caisson.worktree.parent'] || '',
          childContainerId: info.Id,
          branch: info.Labels['caisson.worktree.branch'] || '',
          worktreePath: `/home/dev/worktrees/${info.Labels['caisson.worktree.branch'] || ''}`,
          gitRoot: '',
          ports: [],
          status: 'ready',
        };
        // Try to resolve gitRoot from parent
        if (record.parentContainerId) {
          try {
            record.gitRoot = (await execInContainer(record.parentContainerId, [
              'git', 'rev-parse', '--show-toplevel',
            ], '/home/dev/workspace')).trim();
          } catch {
            // Parent may be gone too
          }
        }
      }
    } catch {
      // Docker query failed
    }
  }

  if (!record) {
    // Nothing to clean up — just remove from map if present
    worktrees.delete(worktreeId);
    return;
  }

  // Stop and remove child container
  if (record.childContainerId) {
    try {
      const container = docker.getContainer(record.childContainerId);
      await container.stop().catch(() => {});
      await container.remove({ force: true });
    } catch {
      // Container may already be removed
    }
  }

  // Remove git worktree from parent
  if (record.parentContainerId && record.worktreePath) {
    try {
      const workdir = record.gitRoot || '/home/dev/workspace';
      await execInContainer(record.parentContainerId, [
        'git', 'worktree', 'remove', record.worktreePath, '--force',
      ], workdir);
    } catch {
      // Worktree may already be removed
    }
  }

  // Delete the branch
  if (record.parentContainerId && record.branch) {
    try {
      const workdir = record.gitRoot || '/home/dev/workspace';
      await execInContainer(record.parentContainerId, [
        'git', 'branch', '-D', record.branch,
      ], workdir);
    } catch {
      // Branch may already be deleted
    }
  }

  worktrees.delete(worktreeId);
}

/**
 * Get status of a worktree (clean/dirty/conflict).
 */
export async function getWorktreeStatus(worktreeId: string): Promise<{
  status: 'clean' | 'dirty' | 'conflict';
  changedFiles?: string[];
  conflictFiles?: string[];
}> {
  const record = worktrees.get(worktreeId);
  if (!record) {
    throw new Error(`Worktree ${worktreeId} not found`);
  }

  const containerId = record.childContainerId || record.parentContainerId;

  try {
    const statusOutput = await execInContainer(containerId, [
      'git', '-C', record.worktreePath, 'status', '--porcelain',
    ]);

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
