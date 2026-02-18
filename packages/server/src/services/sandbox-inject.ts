/**
 * Shared utility for injecting files into running sandboxes.
 *
 * Used by agent-config inject and MCP deployment connect endpoints.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { getSandboxService, initializeSandboxService } from './sandbox/index.js';
import { getCloudHypervisorService, initializeCloudHypervisorService } from './hypervisor.js';
import { getFirecrackerService, initializeFirecrackerService } from './firecracker.js';
import { getDaytonaService, initializeDaytonaService } from './daytona.js';
import { getAwsService, initializeAwsService } from './aws.js';

/** Common SSH options */
const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
];

export interface FileToInject {
  content: string;
  destPath: string;
  filename: string;
}

/**
 * Ensure the sandbox service is initialized and return it.
 */
export async function ensureSandboxService() {
  try {
    return getSandboxService();
  } catch {
    let hypervisor, firecracker, daytona, aws;
    try { await initializeCloudHypervisorService(); hypervisor = getCloudHypervisorService(); } catch {}
    try { await initializeFirecrackerService(); firecracker = getFirecrackerService(); } catch {}
    try { await initializeDaytonaService(); const d = getDaytonaService(); if (await d.isAvailable()) daytona = d; } catch {}
    try { await initializeAwsService(); const a = getAwsService(); if (await a.isAvailable()) aws = a; } catch {}
    await initializeSandboxService({
      hypervisor: hypervisor ?? undefined,
      firecracker: firecracker ?? undefined,
      daytona: daytona ?? undefined,
      aws: aws ?? undefined,
    });
    return getSandboxService();
  }
}

/**
 * Expand ~ to the appropriate home directory for the sandbox backend.
 */
function expandTilde(filePath: string, backend: string): string {
  if (!filePath.startsWith('~')) return filePath;
  const home = backend === 'docker' ? '/home/dev'
    : backend === 'daytona' ? '/home/daytona'
    : backend === 'aws' ? '/home/ubuntu'
    : backend === 'azure' ? '/home/azureuser'
    : backend === 'gcp' ? '/home/handler'
    : backend === 'digitalocean' ? '/root'
    : backend === 'linode' ? '/root'
    : '/home/agent'; // cloud-hypervisor, firecracker
  return filePath.replace(/^~(?=\/|$)/, home);
}

/**
 * Inject files into a running sandbox. Returns the number of files injected.
 */
export async function injectFilesIntoSandbox(
  sandboxId: string,
  files: FileToInject[],
): Promise<number> {
  const service = await ensureSandboxService();
  const sandbox = await service.get(sandboxId);
  if (!sandbox) {
    throw new Error('Sandbox not found');
  }
  if (sandbox.status !== 'running') {
    throw new Error('Sandbox must be running to inject files');
  }
  if (files.length === 0) {
    return 0;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-inject-'));
  let injectedCount = 0;

  try {
    for (const rawFile of files) {
      const file = { ...rawFile, destPath: expandTilde(rawFile.destPath, sandbox.backend) };
      const tempFilePath = path.join(tempDir, file.filename);
      fs.writeFileSync(tempFilePath, file.content);

      if (sandbox.backend === 'docker') {
        const dockerMeta = sandbox.backendMeta as { type: 'docker'; containerId: string } | undefined;
        const containerId = dockerMeta?.containerId || sandbox.id.replace('docker-', '');

        try {
          execFileSync('docker', ['exec', containerId, 'mkdir', '-p', file.destPath], { stdio: 'pipe' });
        } catch { /* ignore */ }

        execFileSync('docker', ['cp', tempFilePath, `${containerId}:${file.destPath}/${file.filename}`], { stdio: 'pipe' });

        try {
          execFileSync('docker', ['exec', containerId, 'chown', 'dev:dev', `${file.destPath}/${file.filename}`], { stdio: 'pipe' });
        } catch { /* ignore */ }

        injectedCount++;
      } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
        const vmService = sandbox.backend === 'cloud-hypervisor'
          ? service.getHypervisorService()
          : service.getFirecrackerService();
        const keyPath = vmService?.getSshKeyPath?.() || '';

        if (keyPath && sandbox.guestIp) {
          try {
            execFileSync('ssh', ['-i', keyPath, ...SSH_OPTS, `agent@${sandbox.guestIp}`, 'mkdir', '-p', file.destPath], { stdio: 'pipe', timeout: 10000 });
          } catch { /* ignore */ }

          execFileSync('scp', ['-i', keyPath, ...SSH_OPTS, tempFilePath, `agent@${sandbox.guestIp}:${file.destPath}/${file.filename}`], { stdio: 'pipe', timeout: 30000 });
          injectedCount++;
        }
      } else if (sandbox.backend === 'daytona') {
        const daytonaMeta = sandbox.backendMeta as { type: 'daytona'; sshKey?: string } | undefined;
        if (sandbox.guestIp && daytonaMeta?.sshKey) {
          const tempKeyPath = path.join(tempDir, 'daytona_key');
          fs.writeFileSync(tempKeyPath, daytonaMeta.sshKey, { mode: 0o600 });

          const port = String(sandbox.sshPort || 22);
          try {
            execFileSync('ssh', ['-i', tempKeyPath, '-p', port, ...SSH_OPTS, `dev@${sandbox.guestIp}`, 'mkdir', '-p', file.destPath], { stdio: 'pipe', timeout: 10000 });
          } catch { /* ignore */ }

          execFileSync('scp', ['-i', tempKeyPath, '-P', port, ...SSH_OPTS, tempFilePath, `dev@${sandbox.guestIp}:${file.destPath}/${file.filename}`], { stdio: 'pipe', timeout: 30000 });
          injectedCount++;
        }
      } else if (sandbox.backend === 'aws') {
        if (sandbox.guestIp) {
          try {
            const awsService = getAwsService();
            const sshPrivateKey = await awsService.getSshPrivateKey();
            if (sshPrivateKey) {
              const tempKeyPath = path.join(tempDir, 'aws_key');
              fs.writeFileSync(tempKeyPath, sshPrivateKey, { mode: 0o600 });

              try {
                execFileSync('ssh', ['-i', tempKeyPath, ...SSH_OPTS, `ubuntu@${sandbox.guestIp}`, 'mkdir', '-p', file.destPath], { stdio: 'pipe', timeout: 10000 });
              } catch { /* ignore */ }

              execFileSync('scp', ['-i', tempKeyPath, ...SSH_OPTS, tempFilePath, `ubuntu@${sandbox.guestIp}:${file.destPath}/${file.filename}`], { stdio: 'pipe', timeout: 30000 });
              injectedCount++;
            }
          } catch { /* ignore */ }
        }
      }
    }

    return injectedCount;
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
}

/**
 * Execute a command inside a running sandbox. Returns stdout or null on failure.
 */
export async function execInSandbox(
  sandboxId: string,
  command: string,
  timeoutMs = 10000,
): Promise<string | null> {
  const service = await ensureSandboxService();
  const sandbox = await service.get(sandboxId);
  if (!sandbox || sandbox.status !== 'running') {
    return null;
  }

  try {
    if (sandbox.backend === 'docker') {
      const dockerMeta = sandbox.backendMeta as { type: 'docker'; containerId: string } | undefined;
      const containerId = dockerMeta?.containerId || sandbox.id.replace('docker-', '');
      const result = execFileSync('docker', ['exec', containerId, 'sh', '-c', command], {
        stdio: 'pipe',
        timeout: timeoutMs,
      });
      return result.toString();
    } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
      const vmService = sandbox.backend === 'cloud-hypervisor'
        ? service.getHypervisorService()
        : service.getFirecrackerService();
      const keyPath = vmService?.getSshKeyPath?.() || '';
      if (keyPath && sandbox.guestIp) {
        const result = execFileSync('ssh', ['-i', keyPath, ...SSH_OPTS, `agent@${sandbox.guestIp}`, command], {
          stdio: 'pipe',
          timeout: timeoutMs,
        });
        return result.toString();
      }
    }
  } catch {
    // Command failed or timed out
  }
  return null;
}

/**
 * Read a file from a running sandbox. Returns content or null if not found.
 */
export async function readFileFromSandbox(
  sandboxId: string,
  filePath: string,
): Promise<string | null> {
  const service = await ensureSandboxService();
  const sandbox = await service.get(sandboxId);
  if (!sandbox || sandbox.status !== 'running') {
    return null;
  }

  try {
    if (sandbox.backend === 'docker') {
      const dockerMeta = sandbox.backendMeta as { type: 'docker'; containerId: string } | undefined;
      const containerId = dockerMeta?.containerId || sandbox.id.replace('docker-', '');
      const result = execFileSync('docker', ['exec', containerId, 'cat', filePath], { stdio: 'pipe', timeout: 5000 });
      const content = result.toString();
      return content || null;
    } else if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
      const vmService = sandbox.backend === 'cloud-hypervisor'
        ? service.getHypervisorService()
        : service.getFirecrackerService();
      const keyPath = vmService?.getSshKeyPath?.() || '';
      if (keyPath && sandbox.guestIp) {
        const result = execFileSync('ssh', ['-i', keyPath, ...SSH_OPTS, `agent@${sandbox.guestIp}`, 'cat', filePath], { stdio: 'pipe', timeout: 10000 });
        const content = result.toString();
        return content || null;
      }
    }
    // For daytona/aws, would need similar SSH reads — fall through to null for now
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}
