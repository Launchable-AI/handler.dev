/**
 * Input validation utilities.
 *
 * These functions reject malformed inputs at the API boundary so they never
 * reach execution code. Defense in depth — even if network isolation and
 * command injection elimination both fail, bad inputs are caught early.
 */

import * as path from 'path';

const SANDBOX_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function validateSandboxId(id: string): string {
  if (!id || !SANDBOX_ID_REGEX.test(id) || id.length > 128) {
    throw new Error('Invalid sandbox ID');
  }
  return id;
}

export function validatePath(inputPath: string): string {
  if (!inputPath) {
    throw new Error('Path is required');
  }
  if (inputPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  const normalized = path.posix.normalize(inputPath);

  if (normalized.includes('..')) {
    throw new Error('Path traversal not allowed');
  }

  return normalized;
}

export function validateFilename(name: string): string {
  if (!name || name.includes('\0')) {
    throw new Error('Invalid filename');
  }
  // Extract basename if the browser sends a path (e.g., webkitdirectory files)
  const basename = name.includes('/') ? name.split('/').pop()!
    : name.includes('\\') ? name.split('\\').pop()!
    : name;
  if (!basename || basename === '.' || basename === '..' || basename.length > 255) {
    throw new Error('Invalid filename');
  }
  return basename;
}

export function validateIpAddress(ip: string): string {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error('Invalid IP address');
  }
  return ip;
}
