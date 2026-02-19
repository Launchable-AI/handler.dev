/**
 * SSH Key Management Routes
 *
 * Global endpoints for managing the VM SSH keypair used by all VM backends
 * (Firecracker, Cloud-Hypervisor). Allows users to download the current
 * private key or regenerate the keypair entirely.
 */

import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DATA_DIR } from '../lib/paths.js';

const sshKeys = new Hono();

const SSH_KEYS_DIR = path.join(DATA_DIR, 'ssh-keys');
const PRIVATE_KEY_PATH = path.join(SSH_KEYS_DIR, 'id_ed25519');
const PUBLIC_KEY_PATH = path.join(SSH_KEYS_DIR, 'id_ed25519.pub');

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

export default sshKeys;
