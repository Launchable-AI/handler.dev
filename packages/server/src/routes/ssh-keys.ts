/**
 * SSH Key Management Routes
 *
 * Global endpoints for managing the VM SSH keypair used by all VM backends
 * (Firecracker, Cloud-Hypervisor). Allows users to download the current
 * private key, regenerate the keypair, view the public key, or push
 * the current key to stopped VMs' overlays.
 */

import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';
import { DATA_DIR } from '../lib/paths.js';

const sshKeys = new Hono();

const SSH_KEYS_DIR = path.join(DATA_DIR, 'ssh-keys');
const PRIVATE_KEY_PATH = path.join(SSH_KEYS_DIR, 'id_ed25519');
const PUBLIC_KEY_PATH = path.join(SSH_KEYS_DIR, 'id_ed25519.pub');
const FIRECRACKER_VMS_DIR = path.join(DATA_DIR, 'firecracker-vms');

/**
 * GET /api/ssh-keys/info
 * Returns the current public key content and whether a keypair exists
 */
sshKeys.get('/info', async (c) => {
  const exists = fs.existsSync(PUBLIC_KEY_PATH);
  if (!exists) {
    return c.json({ exists: false, publicKey: null });
  }

  const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim();
  return c.json({ exists: true, publicKey });
});

/**
 * GET /api/ssh-keys/download
 * Download the current VM SSH private key
 */
sshKeys.get('/download', async (c) => {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    return c.json({ error: 'No SSH key exists yet. Start a VM or regenerate to create one.' }, 404);
  }

  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');

  return new Response(privateKey, {
    headers: {
      'Content-Type': 'application/x-pem-file',
      'Content-Disposition': 'attachment; filename="handler_vm_key.pem"',
    },
  });
});

/**
 * POST /api/ssh-keys/regenerate
 * Generate a new ed25519 keypair, replacing any existing one.
 * Returns the new private key as a PEM file download.
 */
sshKeys.post('/regenerate', async (c) => {
  try {
    // Ensure directory exists
    if (!fs.existsSync(SSH_KEYS_DIR)) {
      fs.mkdirSync(SSH_KEYS_DIR, { recursive: true });
    }

    // Remove existing keys if they exist
    if (fs.existsSync(PRIVATE_KEY_PATH)) {
      fs.unlinkSync(PRIVATE_KEY_PATH);
    }
    if (fs.existsSync(PUBLIC_KEY_PATH)) {
      fs.unlinkSync(PUBLIC_KEY_PATH);
    }

    // Generate new keypair using execFileSync (safe, no shell)
    execFileSync('ssh-keygen', [
      '-t', 'ed25519',
      '-f', PRIVATE_KEY_PATH,
      '-N', '',
      '-q',
    ]);

    // Set proper permissions
    fs.chmodSync(PRIVATE_KEY_PATH, 0o600);

    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');

    return new Response(privateKey, {
      headers: {
        'Content-Type': 'application/x-pem-file',
        'Content-Disposition': 'attachment; filename="handler_vm_key.pem"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate SSH key';
    console.error('[ssh-keys] Failed to regenerate:', error);
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /api/ssh-keys/push
 * Push the current SSH public key to all stopped/error VMs' overlay filesystems.
 * Uses debugfs to write the key into each VM's overlay ext4 image.
 * Running VMs are skipped (they'll get the key via MMDS on next boot).
 */
sshKeys.post('/push', async (c) => {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    return c.json({ error: 'No SSH key exists yet. Generate one first.' }, 400);
  }

  // Check debugfs availability
  try {
    execSync('which debugfs', { stdio: 'pipe' });
  } catch {
    return c.json({ error: 'debugfs not available. Install with: sudo apt-get install e2fsprogs' }, 500);
  }

  const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim();

  if (!fs.existsSync(FIRECRACKER_VMS_DIR)) {
    return c.json({ pushed: 0, skipped: 0, errors: [], message: 'No VMs found' });
  }

  const vmDirs = fs.readdirSync(FIRECRACKER_VMS_DIR).filter(d =>
    d.startsWith('fc-') && fs.statSync(path.join(FIRECRACKER_VMS_DIR, d)).isDirectory()
  );

  let pushed = 0;
  let skipped = 0;
  const errors: { vmId: string; error: string }[] = [];

  for (const vmDir of vmDirs) {
    const vmPath = path.join(FIRECRACKER_VMS_DIR, vmDir);
    const statePath = path.join(vmPath, 'state.json');
    const overlayPath = path.join(vmPath, 'overlay.ext4');

    // Skip VMs without state or overlay
    if (!fs.existsSync(statePath) || !fs.existsSync(overlayPath)) {
      skipped++;
      continue;
    }

    let state: { id: string; name: string; status: string };
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    } catch {
      skipped++;
      continue;
    }

    // Only push to stopped/error VMs — running VMs will get the key via MMDS on next boot
    if (state.status === 'running' || state.status === 'starting' || state.status === 'creating') {
      skipped++;
      continue;
    }

    // Inject key via debugfs
    const keysContent = publicKey + '\n';
    const tmpKeysFile = path.join(vmPath, 'authorized_keys.tmp');
    const tmpCmdFile = path.join(vmPath, 'debugfs_commands.tmp');

    try {
      fs.writeFileSync(tmpKeysFile, keysContent, { mode: 0o600 });

      const debugfsCommands = [
        'mkdir /upper',
        'mkdir /upper/home',
        'mkdir /upper/home/agent',
        'mkdir /upper/home/agent/.ssh',
        'rm /upper/home/agent/.ssh/authorized_keys',
        `write ${tmpKeysFile} /upper/home/agent/.ssh/authorized_keys`,
      ].join('\n') + '\n';

      fs.writeFileSync(tmpCmdFile, debugfsCommands);

      // Run e2fsck first to fix any filesystem issues
      try {
        execSync(`e2fsck -fy "${overlayPath}" 2>&1`, { stdio: 'pipe' });
      } catch {
        // e2fsck returns non-zero when it fixes things, which is fine
      }

      execSync(`debugfs -w -f "${tmpCmdFile}" "${overlayPath}" 2>&1`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });

      console.log(`[ssh-keys] Pushed SSH key to ${state.name} (${state.id})`);
      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[ssh-keys] Failed to push key to ${state.id}:`, msg);
      errors.push({ vmId: state.id, error: msg });
    } finally {
      if (fs.existsSync(tmpKeysFile)) fs.unlinkSync(tmpKeysFile);
      if (fs.existsSync(tmpCmdFile)) fs.unlinkSync(tmpCmdFile);
    }
  }

  return c.json({
    pushed,
    skipped,
    errors,
    message: `Pushed SSH key to ${pushed} VM${pushed !== 1 ? 's' : ''}${skipped > 0 ? `, skipped ${skipped}` : ''}${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
  });
});

export default sshKeys;
