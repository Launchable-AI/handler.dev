/**
 * Shared utility for executing commands inside sandboxes.
 *
 * Dispatches to Docker exec or SSH based on the sandbox's backend type.
 */

import * as dockerService from '../services/docker.js';
import { getFirecrackerService } from '../services/firecracker.js';
import { safeExec } from './safe-exec.js';

/** Common SSH options used across all SSH/SCP calls */
export const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=5',
  '-o', 'BatchMode=yes',
];

/**
 * Run a command inside a sandbox, dispatching to Docker exec or SSH based on backend.
 * Returns stdout as a string. Throws on failure.
 */
export async function execInSandbox(
  sandbox: { id: string; backend: string; guestIp?: string },
  command: string,
  opts?: { timeout?: number },
): Promise<string> {
  if (sandbox.backend === 'docker') {
    const containerId = sandbox.id.startsWith('docker-') ? sandbox.id.slice(7) : sandbox.id;
    return dockerService.execInContainer(containerId, ['sh', '-c', command]);
  }

  // VM backends — run via SSH
  if (!sandbox.guestIp) throw new Error('No guest IP');

  let keyPath = '';
  if (sandbox.backend === 'firecracker') {
    const svc = getFirecrackerService();
    keyPath = svc ? svc.getSshKeyPath() : '';
  }
  if (!keyPath) throw new Error('No SSH key available');

  return safeExec('ssh', [
    '-i', keyPath,
    ...SSH_OPTS,
    `agent@${sandbox.guestIp}`,
    command,
  ], { timeout: opts?.timeout ?? 10000 });
}
