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
  - `scripts/dev/` — Developer/maintainer scripts (requires AWS write): `prepare-fc-image.sh`, `upload-fc-image.sh`, `test-vm.sh`, `download-ubuntu-minimal.sh`, `base-images.json`, `global-manifest.json`, `migrations/`
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
  - `sandbox/` — SandboxList, SandboxCard, CreateSandboxForm
  - `Terminal/` — xterm.js integration with WebSocket, OSC 7337 escape sequences for shell state tracking
  - `CommandCentre/` — Command palette
  - Canvas workspace uses ReactFlow for draggable terminal nodes
- **Path alias**: `@/*` maps to `packages/web/src/*`

### Terminal Session Persistence

Terminal sessions for Docker containers and VMs use **tmux** for persistence (configurable via `tmuxEnabled` in app config, default: `true`):
- Sessions survive WebSocket disconnects and server restarts
- Clients automatically reconnect to existing tmux sessions
- Scrollback history is restored on reconnection
- Session metadata stored in `data/terminal-sessions.json`
- A "tmux" badge appears in the terminal status bar when a session uses tmux

Key files:
- `packages/server/src/services/terminal.ts` — tmux-based terminal sessions (Docker)
- `packages/server/src/services/vm-terminal.ts` — tmux-based terminal sessions (VMs)
- `packages/server/src/services/session-store.ts` — session persistence
- `packages/web/src/components/Terminal/TerminalInstance.tsx` — auto-reconnection logic

For tmux persistence to work, containers/VMs must have `tmux` installed (the default.dockerfile and Firecracker images include it). When `tmuxEnabled` is set to `false` in config, plain shell sessions are used instead.

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

### Docker in Firecracker

Firecracker VM images include Docker CE pre-installed with special configuration for nested operation:
- `/etc/docker/daemon.json` uses `{"iptables": false, "storage-driver": "vfs"}` (no iptables in microVM, no overlay2 nesting)
- Docker and containerd are disabled at boot; start manually with `sudo systemctl start docker`
- Image preparation: `scripts/dev/prepare-fc-image.sh`

### Key tech choices

- Tailwind CSS v4 (beta) for styling
- Monaco editor for Dockerfile editing
- xterm.js with fit/webgl/web-links addons for terminal
- tmux for terminal session persistence (Docker containers)
- ReactFlow for canvas workspace visualization
- WebSocket for real-time terminal I/O and shell state
