/**
 * Safe command execution utilities.
 *
 * Uses execFileSync / execFile (via promisify) which bypass the shell entirely.
 * Arguments are passed directly as an argv array — no shell parsing, no
 * expansion, no injection. This makes them immune to command injection attacks
 * regardless of what user-controlled strings are passed as arguments.
 */

import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function safeExecSync(
  command: string,
  args: string[],
  options?: { timeout?: number }
): string {
  return execFileSync(command, args, {
    stdio: 'pipe',
    timeout: options?.timeout ?? 30000,
    encoding: 'utf-8',
  });
}

export async function safeExec(
  command: string,
  args: string[],
  options?: { timeout?: number }
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: options?.timeout ?? 30000,
  });
  return stdout;
}
