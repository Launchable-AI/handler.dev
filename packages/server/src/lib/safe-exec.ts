/**
 * Safe command execution utilities.
 *
 * Uses execFileSync / execFile (via promisify) which bypass the shell entirely.
 * Arguments are passed directly as an argv array — no shell parsing, no
 * expansion, no injection. This makes them immune to command injection attacks
 * regardless of what user-controlled strings are passed as arguments.
 */

import { execFileSync, execFile, type StdioOptions } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface SafeExecSyncOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  stdio?: StdioOptions;
  encoding?: BufferEncoding | 'buffer';
}

export function safeExecSync(
  command: string,
  args: string[],
  options?: SafeExecSyncOptions
): string {
  return execFileSync(command, args, {
    stdio: options?.input ? ['pipe', 'pipe', 'pipe'] : (options?.stdio ?? 'pipe'),
    timeout: options?.timeout ?? 30000,
    encoding: (options?.encoding as BufferEncoding) ?? 'utf-8',
    env: options?.env,
    input: options?.input,
  }) as string;
}

/**
 * Like safeExecSync but returns a Buffer instead of a string.
 * Useful when you need raw output (e.g., binary data or when encoding is 'buffer').
 */
export function safeExecSyncBuffer(
  command: string,
  args: string[],
  options?: Omit<SafeExecSyncOptions, 'encoding'>
): Buffer {
  return execFileSync(command, args, {
    stdio: options?.input ? ['pipe', 'pipe', 'pipe'] : (options?.stdio ?? 'pipe'),
    timeout: options?.timeout ?? 30000,
    env: options?.env,
    input: options?.input,
  });
}

export async function safeExec(
  command: string,
  args: string[],
  options?: { timeout?: number; env?: NodeJS.ProcessEnv }
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: options?.timeout ?? 30000,
    env: options?.env,
  });
  return stdout;
}
