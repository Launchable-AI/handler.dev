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

/** Common SSH options — match the opts used by vm-terminal, firecracker, etc. */
const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=5',
  '-o', 'BatchMode=yes',
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
 * Inject files into an SSH-accessible sandbox via a single tar pipe.
 * All files are packed into a tar archive and extracted in one SSH session,
 * avoiding the per-file SSH handshake overhead of separate mkdir + scp calls.
 *
 * Two workarounds for VM shell init (prompt.sh):
 * 1. The remote command is prefixed with `trap "" TERM; kill 0 2>/dev/null;`
 *    to kill the background Claude status poller that prompt.sh spawns, which
 *    otherwise holds stdout open and prevents the SSH session from ever closing.
 * 2. Tar lists individual file paths (not '.') so parent directory entries like
 *    ./ and ./home/ are not included — avoids "Cannot change mode" errors when
 *    tar tries to set permissions on system dirs the SSH user doesn't own.
 */
function injectViaTar(params: {
  keyPath?: string;
  keyContent?: string;
  user: string;
  ip: string;
  port?: string;
  files: Array<{ destPath: string; filename: string; content: string }>;
}): number {
  const { user, ip, port, files } = params;
  if (files.length === 0) return 0;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-tar-'));
  try {
    // Write SSH key to temp file if provided as content (Daytona, AWS)
    let keyPath = params.keyPath || '';
    if (params.keyContent) {
      keyPath = path.join(tempDir, 'ssh_key');
      fs.writeFileSync(keyPath, params.keyContent, { mode: 0o600 });
    }

    // Build payload directory mirroring destination paths
    const payloadDir = path.join(tempDir, 'payload');
    const relativePaths: string[] = [];
    for (const file of files) {
      const dir = path.join(payloadDir, file.destPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file.filename), file.content);
      // Track relative path for tar (e.g. "home/agent/config.sh")
      // path.join strips the leading / so we get a clean relative path
      relativePaths.push(path.join(file.destPath, file.filename).replace(/^\//, ''));
    }

    // Create tar archive listing only the files — not '.' which would include
    // parent dir entries that cause permission errors on extraction
    const tarData = execFileSync('tar', ['cf', '-', '-C', payloadDir, ...relativePaths], {
      maxBuffer: 50 * 1024 * 1024,
    });

    // Extract via single SSH connection.
    // The trap/kill prefix terminates the background status poller spawned by
    // the VM's shell init (prompt.sh) so the SSH session can close cleanly.
    const sshArgs = ['-T', '-i', keyPath, ...SSH_OPTS];
    if (port) sshArgs.push('-p', port);
    sshArgs.push(
      `${user}@${ip}`,
      'trap "" TERM; kill 0 2>/dev/null; tar xf - -C / --no-same-owner',
    );

    execFileSync('ssh', sshArgs, {
      input: tarData,
      timeout: 30000,
    });

    return files.length;
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
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

  // Expand tildes for all files upfront
  const expanded = files.map(f => ({
    ...f,
    destPath: expandTilde(f.destPath, sandbox.backend),
  }));

  if (sandbox.backend === 'docker') {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-inject-'));
    let injectedCount = 0;
    try {
      for (const file of expanded) {
        const tempFilePath = path.join(tempDir, file.filename);
        fs.writeFileSync(tempFilePath, file.content);

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
      }
      return injectedCount;
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  }

  if (sandbox.backend === 'cloud-hypervisor' || sandbox.backend === 'firecracker') {
    const vmService = sandbox.backend === 'cloud-hypervisor'
      ? service.getHypervisorService()
      : service.getFirecrackerService();
    const keyPath = vmService?.getSshKeyPath?.() || '';
    if (keyPath && sandbox.guestIp) {
      return injectViaTar({ keyPath, user: 'agent', ip: sandbox.guestIp, files: expanded });
    }
    return 0;
  }

  if (sandbox.backend === 'daytona') {
    const daytonaMeta = sandbox.backendMeta as { type: 'daytona'; sshKey?: string } | undefined;
    if (sandbox.guestIp && daytonaMeta?.sshKey) {
      return injectViaTar({
        keyContent: daytonaMeta.sshKey,
        user: 'dev',
        ip: sandbox.guestIp,
        port: String(sandbox.sshPort || 22),
        files: expanded,
      });
    }
    return 0;
  }

  if (sandbox.backend === 'aws') {
    if (sandbox.guestIp) {
      try {
        const awsService = getAwsService();
        const sshPrivateKey = await awsService.getSshPrivateKey();
        if (sshPrivateKey) {
          return injectViaTar({
            keyContent: sshPrivateKey,
            user: 'ubuntu',
            ip: sandbox.guestIp,
            files: expanded,
          });
        }
      } catch { /* ignore */ }
    }
    return 0;
  }

  return 0;
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
