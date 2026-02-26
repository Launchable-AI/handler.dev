import { describe, it, expect, vi } from 'vitest';
import { safeExecSync, safeExec } from '../safe-exec.js';

describe('safeExecSync', () => {
  it('executes a command and returns stdout', () => {
    const result = safeExecSync('echo', ['hello world']);
    expect(result.trim()).toBe('hello world');
  });

  it('passes arguments as separate argv entries (no shell injection)', () => {
    // If this were shell-interpolated, the semicolon would execute a second command.
    // With execFileSync, it's just a literal argument to echo.
    const result = safeExecSync('echo', ['safe; echo pwned']);
    expect(result.trim()).toBe('safe; echo pwned');
  });

  it('throws on non-existent command', () => {
    expect(() => safeExecSync('nonexistent-command-xyz', [])).toThrow();
  });

  it('throws on command timeout', () => {
    expect(() => safeExecSync('sleep', ['10'], { timeout: 100 })).toThrow();
  });
});

describe('safeExec', () => {
  it('executes a command asynchronously and returns stdout', async () => {
    const result = await safeExec('echo', ['async test']);
    expect(result.trim()).toBe('async test');
  });

  it('rejects on non-existent command', async () => {
    await expect(safeExec('nonexistent-command-xyz', [])).rejects.toThrow();
  });
});
