import { describe, it, expect } from 'vitest';
import {
  validateSandboxId,
  validatePath,
  validateFilename,
  validateIpAddress,
} from '../validation.js';

describe('validateSandboxId', () => {
  it('accepts valid alphanumeric IDs', () => {
    expect(validateSandboxId('abc123')).toBe('abc123');
    expect(validateSandboxId('my-container')).toBe('my-container');
    expect(validateSandboxId('test_sandbox.v2')).toBe('test_sandbox.v2');
  });

  it('rejects empty string', () => {
    expect(() => validateSandboxId('')).toThrow('Invalid sandbox ID');
  });

  it('rejects IDs starting with special characters', () => {
    expect(() => validateSandboxId('.hidden')).toThrow('Invalid sandbox ID');
    expect(() => validateSandboxId('-dash')).toThrow('Invalid sandbox ID');
    expect(() => validateSandboxId('_underscore')).toThrow('Invalid sandbox ID');
  });

  it('rejects IDs with shell metacharacters', () => {
    expect(() => validateSandboxId('id;rm -rf /')).toThrow('Invalid sandbox ID');
    expect(() => validateSandboxId('id$(cmd)')).toThrow('Invalid sandbox ID');
    expect(() => validateSandboxId('id`cmd`')).toThrow('Invalid sandbox ID');
    expect(() => validateSandboxId('id|cat /etc/passwd')).toThrow('Invalid sandbox ID');
  });

  it('rejects IDs exceeding 128 characters', () => {
    const longId = 'a'.repeat(129);
    expect(() => validateSandboxId(longId)).toThrow('Invalid sandbox ID');
  });

  it('accepts IDs at exactly 128 characters', () => {
    const maxId = 'a'.repeat(128);
    expect(validateSandboxId(maxId)).toBe(maxId);
  });
});

describe('validatePath', () => {
  it('accepts valid absolute paths', () => {
    expect(validatePath('/home/user/file.txt')).toBe('/home/user/file.txt');
  });

  it('accepts relative paths without traversal', () => {
    expect(validatePath('src/index.ts')).toBe('src/index.ts');
  });

  it('rejects empty path', () => {
    expect(() => validatePath('')).toThrow('Path is required');
  });

  it('rejects paths with null bytes', () => {
    expect(() => validatePath('/etc/passwd\0.txt')).toThrow('Path contains null bytes');
  });

  it('rejects path traversal', () => {
    expect(() => validatePath('../../../etc/passwd')).toThrow('Path traversal not allowed');
    expect(() => validatePath('foo/../../bar')).toThrow('Path traversal not allowed');
  });

  it('normalizes absolute traversals that stay within root', () => {
    // /home/../../../etc/shadow normalizes to /etc/shadow (no .. left)
    expect(validatePath('/home/../../../etc/shadow')).toBe('/etc/shadow');
  });

  it('normalizes paths while preserving safety', () => {
    expect(validatePath('/home/user/./file.txt')).toBe('/home/user/file.txt');
    expect(validatePath('src//lib//utils.ts')).toBe('src/lib/utils.ts');
  });
});

describe('validateFilename', () => {
  it('accepts valid filenames', () => {
    expect(validateFilename('index.ts')).toBe('index.ts');
    expect(validateFilename('my-file_v2.tar.gz')).toBe('my-file_v2.tar.gz');
  });

  it('rejects empty filename', () => {
    expect(() => validateFilename('')).toThrow('Invalid filename');
  });

  it('rejects filenames with path separators', () => {
    expect(() => validateFilename('path/file.txt')).toThrow('Invalid filename');
    expect(() => validateFilename('path\\file.txt')).toThrow('Invalid filename');
  });

  it('rejects null bytes', () => {
    expect(() => validateFilename('file\0.txt')).toThrow('Invalid filename');
  });

  it('rejects . and ..', () => {
    expect(() => validateFilename('.')).toThrow('Invalid filename');
    expect(() => validateFilename('..')).toThrow('Invalid filename');
  });

  it('rejects filenames over 255 characters', () => {
    const longName = 'a'.repeat(256);
    expect(() => validateFilename(longName)).toThrow('Invalid filename');
  });

  it('accepts filenames at exactly 255 characters', () => {
    const maxName = 'a'.repeat(255);
    expect(validateFilename(maxName)).toBe(maxName);
  });
});

describe('validateIpAddress', () => {
  it('accepts valid IPv4 addresses', () => {
    expect(validateIpAddress('192.168.1.1')).toBe('192.168.1.1');
    expect(validateIpAddress('10.0.0.1')).toBe('10.0.0.1');
    expect(validateIpAddress('255.255.255.255')).toBe('255.255.255.255');
    expect(validateIpAddress('0.0.0.0')).toBe('0.0.0.0');
  });

  it('rejects non-IP strings', () => {
    expect(() => validateIpAddress('not-an-ip')).toThrow('Invalid IP address');
    expect(() => validateIpAddress('')).toThrow('Invalid IP address');
  });

  it('rejects IPs with extra octets', () => {
    expect(() => validateIpAddress('1.2.3.4.5')).toThrow('Invalid IP address');
  });

  it('rejects embedded commands', () => {
    expect(() => validateIpAddress('$(whoami)')).toThrow('Invalid IP address');
    expect(() => validateIpAddress('1.1.1.1;cat /etc/passwd')).toThrow('Invalid IP address');
  });
});
