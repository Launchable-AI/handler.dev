# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Handler?

Handler is a web application for spawning and managing isolated compute sandboxes. It provides a unified API/UI over multiple backends: Docker, Cloud-Hypervisor VMs, Firecracker microVMs, Daytona, and cloud providers (AWS, Azure, GCP, DigitalOcean, Linode).

## Commands

```bash
# Install dependencies
pnpm install

# Dev (runs server on :4001 and web on :5173 concurrently)
pnpm dev

# Dev individual packages
pnpm dev:server    # tsx watch packages/server/src/index.ts
pnpm dev:web       # vite dev server

# Build all
pnpm build

# Lint all
pnpm lint
```

Requires Node 22+. Uses pnpm workspaces.

## Monorepo Structure

- `packages/server/` — Hono (Node.js) backend API
- `packages/web/` — React 19 + Vite frontend
- `helpers/tap-helper/` — Rust TAP device helper for VM networking
- `scripts/` — VM image and setup scripts
  - `scripts/setup.sh`, `scripts/uninstall.sh`, `scripts/status.sh` — Top-level user entry points
  - `scripts/lib/` — Shared shell utilities (`os-utils.sh`)
  - `scripts/user/` — End-user scripts (public read): `download-image.sh`, `install-firecracker.sh`, `install-tap-helper.sh`
  - `scripts/dev/` — Developer/maintainer scripts (requires AWS write): `prepare-fc-image.sh`, `upload-fc-image.sh`, `build-fc-kernel.sh`, `test-vm.sh`, `download-ubuntu-minimal.sh`, `base-images.json`, `global-manifest.json`, `migrations/`
- `guest-init/` — Init scripts baked into VM images
- `data/` — Runtime config, SSH keys, volumes, Dockerfiles

## Architecture

### Adapter Pattern (core abstraction)

All sandbox operations go through a `SandboxAdapter` interface with backend-specific implementations. The coordinator in `packages/server/src/services/sandbox/index.ts` dispatches to the correct adapter based on the sandbox's `backend` field.

Adapters live in `packages/server/src/services/sandbox/` (docker, vm, daytona, aws, azure, gcp, digitalocean, linode). Heavy backend logic lives in dedicated service files under `packages/server/src/services/` (e.g., `hypervisor.ts`, `firecracker.ts`, `docker.ts`).

### Server

- **Routes** (`packages/server/src/routes/`): One file per resource (sandboxes, containers, vms, images, templates, volumes). Uses Hono + zod-validator.
- **Services** (`packages/server/src/services/`): Business logic. The sandbox service uses the adapter pattern; volume and template services are separate.
- **Types** (`packages/server/src/types/`): Shared TypeScript interfaces (`Sandbox`, `Volume`, `Template`) with a `backend` discriminator on Sandbox.

### Frontend

- **API client** (`packages/web/src/api/client.ts`): All endpoint definitions in one file.
- **Hooks** (`packages/web/src/hooks/`): React Query hooks (`useSandboxes`, `useContainers`, `useVolumes`, `useTemplates`).
- **Components** (`packages/web/src/components/`):
  - `sandbox/` — SandboxList, SandboxCard, CreateSandboxForm, SandboxFileBrowser
  - `Terminal/` — xterm.js integration with WebSocket, OSC 7337 escape sequences for shell state tracking
  - `TerminalPanel.tsx` — Terminal panel with tabs, horizontal split view, drag-and-drop tab assignment
  - `CommandCentre/` — Command palette
  - Canvas workspace uses ReactFlow for draggable terminal nodes
- **Path alias**: `@/*` maps to `packages/web/src/*`

### Terminal Session Persistence

Terminal sessions for Docker containers and VMs use **tmux** for persistence (configurable via `tmuxEnabled` in app config, default: `true`):
- Sessions survive WebSocket disconnects and server restarts
- Clients automatically reconnect to existing tmux sessions
- Scrollback history is restored on reconnection
- Session metadata stored in `data/terminal-sessions.json`
- A "tmux" badge appears in the terminal status bar with 3 states:
  - **Green**: connected to tmux session (persistence active)
  - **Orange**: tmux installed but detached (user detached or exited all panes, fell back to bare shell)
  - **Red**: tmux not installed (no persistence available)
  - Hidden when tmux persistence is disabled in config

Key files:
- `packages/server/src/services/terminal.ts` — tmux-based terminal sessions (Docker)
- `packages/server/src/services/vm-terminal.ts` — tmux-based terminal sessions (VMs)
- `packages/server/src/services/session-store.ts` — session persistence
- `packages/web/src/components/Terminal/TerminalInstance.tsx` — auto-reconnection logic

For tmux persistence to work, containers/VMs must have `tmux` installed (the default.dockerfile and Firecracker images include it). When `tmuxEnabled` is set to `false` in config, plain shell sessions are used instead. The tmux status bar can be toggled via `tmuxStatusBar` in config (default: `false` / hidden).

### Terminal Theming

Terminal background supports independent dark/light mode control (can differ from the system theme):
- `packages/web/src/lib/terminal-themes.ts` — Dark and light xterm ITheme definitions, `TerminalThemeMode` type (`'dark' | 'light' | 'system'`)
- Terminal theme mode is stored in localStorage and can be set to System (follows app theme), Dark, or Light
- Shell init (`packages/server/src/services/shell-init.ts`) injects color aliases (`ls --color=auto`, `grep --color=auto`) and `dircolors` for colorized output

### Shell Prompt Themes

Six PS1 prompt themes: `minimal`, `clean`, `bracket`, `lambda`, `cyberpunk`, `multiline`. Configured via `shellPromptTheme` in app config.
- `packages/server/src/services/shell-init.ts` — Theme definitions (ANSI escape sequences) and shell initialization
- `packages/web/src/lib/prompt-themes.ts` — Preview definitions with dark/light color variants
- Themes are injected via stdin after shell start, with live-switching support
- Shell init is also persisted to `~/.config/handler/prompt.sh` and sourced from `.bashrc`, so new tmux panes/splits inherit the Handler prompt theme

### File Transfer

File upload, download, and browsing for all sandbox backends through a unified API:

- **Upload**: `POST /api/sandboxes/:id/upload` — multipart form upload to any backend
- **Directory upload**: `POST /api/sandboxes/:id/upload-directory` — tar-based batch upload
- **File listing**: `GET /api/sandboxes/:id/files?path=...` — list files in a directory (all backends)
- **Download**: `GET /api/sandboxes/:id/files/download?path=...` — download a single file from any backend

Backend-specific transport:
- Docker: `docker exec ls -la` for listing, `docker cp` for file transfer
- VMs (Firecracker/Cloud-Hypervisor): delegates to `listVmFiles()`/`downloadFileFromVm()` on the respective service (SSH/SCP-based)
- Daytona/AWS/Azure/GCP/DigitalOcean/Linode: SSH `ls -la` for listing, SCP for transfer with backend-specific SSH keys

The sandbox card/row actions include a download button (visible when running) that opens a file browser popover with directory navigation. Click a directory to navigate into it; click a file to download it.

Key files:
- `packages/server/src/routes/sandboxes.ts` — Unified upload/download/listing routes
- `packages/web/src/api/client.ts` — `listSandboxFiles`, `uploadFileToSandbox`, `downloadFileFromSandbox` client functions
- `packages/web/src/hooks/useSandboxes.ts` — `useSandboxFiles()` React Query hook
- `packages/web/src/components/sandbox/SandboxFileBrowser.tsx` — File browser popover component
- `packages/web/src/components/sandbox/SandboxCard.tsx` — File browser in card actions
- `packages/web/src/components/sandbox/SandboxRow.tsx` — File browser in table row actions
- `packages/web/src/components/sandbox/SandboxCardCompact.tsx` — File browser in compact card actions

### Docker in Firecracker

Firecracker VM images include Docker CE pre-installed. Docker uses a **dedicated ext4 block device** for `/var/lib/docker` so overlay2 works natively (avoiding nested overlayfs issues):

- **Custom kernel** (`scripts/dev/build-fc-kernel.sh`): Builds a Linux kernel with full Docker support (iptables, netfilter, overlay2, namespaces, cgroups) compiled as built-ins (`=y`), since Firecracker boots with `nomodule`
- **Dedicated Docker volume**: Each VM gets a separate ext4 block device mounted at `/var/lib/docker` by `overlay-init` at boot. This lets Docker use overlay2 directly on ext4 instead of nesting overlayfs-on-overlayfs
- **Boot-time config**: `guest-init/overlay-init` parses the `docker_volume=vdX` kernel boot arg, mounts the device, and writes `/etc/docker/daemon.json` with `{"storage-driver":"overlay2"}`
- **Fallback**: The base image ships with `{"storage-driver":"vfs"}` in daemon.json as a fallback for VMs without a dedicated Docker volume
- Docker and containerd are disabled at boot; start manually with `sudo systemctl start docker`

Device assignment order: vda (rootfs) → parent layers (vdb, vdc...) → overlay (next) → docker volume (next) → data volumes (remaining)

Key files:
- `scripts/dev/build-fc-kernel.sh` — Custom kernel builder (Firecracker CI config + Docker fragment)
- `scripts/dev/prepare-fc-image.sh` — Image preparation (installs Docker CE, tmux, etc.)
- `guest-init/overlay-init` — In-guest init that sets up overlayfs, Docker volume, and SSH
- `packages/server/src/services/firecracker.ts` — VM creation with Docker volume allocation

### Security Hardening

The server is hardened against malicious agents inside sandboxes attempting to exploit the control-plane API. Three layers of defense:

1. **Network isolation**: The HTTP server binds to `127.0.0.1` only (`index.ts`), making the API unreachable from Docker bridge networks and VM TAP interfaces. Firewall rules in `scripts/setup.sh` provide defense in depth via iptables.

2. **Command injection elimination**: All shell commands that handle user-controlled data (uploaded filenames, file paths, sandbox IDs, VM IPs) use `execFileSync`/`execFile` with argument arrays instead of `execSync` with interpolated strings. This bypasses the shell entirely — no parsing, no expansion, no injection. See `packages/server/src/lib/safe-exec.ts` for the utility wrapper.

3. **Input validation**: All API inputs are validated at the boundary before reaching execution code. See `packages/server/src/lib/validation.ts` for validators (`validateSandboxId`, `validatePath`, `validateFilename`, `validateIpAddress`). Applied in route handlers (`sandboxes.ts`) and WebSocket message handlers (`index.ts`).

Key files:
- `packages/server/src/lib/safe-exec.ts` — Shell-free command execution utilities
- `packages/server/src/lib/validation.ts` — Input validation functions
- `SECURITY_HARDENING_PLAN.md` — Full threat model, exploit examples, and implementation plan

When adding new `execSync` calls that handle user input, always use `execFileSync` with an argument array instead. When adding new API endpoints that accept IDs or paths, apply the validators from `validation.ts`.

### Key tech choices

- Tailwind CSS v4 (beta) for styling
- Monaco editor for Dockerfile editing
- xterm.js with fit/webgl/web-links addons for terminal
- tmux for terminal session persistence (Docker containers and VMs)
- ReactFlow for canvas workspace visualization
- WebSocket for real-time terminal I/O and shell state
