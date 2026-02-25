/**
 * SSH Key Management Routes
 *
 * Global endpoints for managing the VM SSH keypair used by all VM backends
 * (Firecracker, Cloud-Hypervisor). Allows users to download the current
 * private key, regenerate the keypair, and view the public key.
 */

import { Hono } from 'hono';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { getDataPath } from '../services/data-dir.js';

const sshKeys = new Hono();

async function getSshKeysDir() { return getDataPath('ssh-keys'); }
async function getPrivateKeyPath() { return getDataPath('ssh-keys', 'id_ed25519'); }
async function getPublicKeyPath() { return getDataPath('ssh-keys', 'id_ed25519.pub'); }

/**
 * GET /api/ssh-keys/info
 * Returns the current public key content and whether a keypair exists
 */
sshKeys.get('/info', async (c) => {
  const publicKeyPath = await getPublicKeyPath();
  const exists = fs.existsSync(publicKeyPath);
  if (!exists) {
    return c.json({ exists: false, publicKey: null });
  }

  const publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();
  return c.json({ exists: true, publicKey });
});

/**
 * GET /api/ssh-keys/download
 * Download the current VM SSH private key
 */
sshKeys.get('/download', async (c) => {
  const privateKeyPath = await getPrivateKeyPath();
  if (!fs.existsSync(privateKeyPath)) {
    return c.json({ error: 'No SSH key exists yet. Start a VM or regenerate to create one.' }, 404);
  }

  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');

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
    const sshKeysDir = await getSshKeysDir();
    const privateKeyPath = await getPrivateKeyPath();
    const publicKeyPath = await getPublicKeyPath();

    // Ensure directory exists
    if (!fs.existsSync(sshKeysDir)) {
      fs.mkdirSync(sshKeysDir, { recursive: true });
    }

    // Remove existing keys if they exist
    if (fs.existsSync(privateKeyPath)) {
      fs.unlinkSync(privateKeyPath);
    }
    if (fs.existsSync(publicKeyPath)) {
      fs.unlinkSync(publicKeyPath);
    }

    // Generate new keypair using execFileSync (safe, no shell)
    execFileSync('ssh-keygen', [
      '-t', 'ed25519',
      '-f', privateKeyPath,
      '-N', '',
      '-q',
    ]);

    // Set proper permissions
    fs.chmodSync(privateKeyPath, 0o600);

    const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');

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
