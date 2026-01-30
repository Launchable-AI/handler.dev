# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Caisson?

Caisson is a web application for spawning and managing isolated compute sandboxes. It provides a unified API/UI over multiple backends: Docker, Cloud-Hypervisor VMs, Firecracker microVMs, Daytona, and cloud providers (AWS, Azure, GCP, DigitalOcean, Linode).

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
- `scripts/` — VM setup scripts
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

### Key tech choices

- Tailwind CSS v4 (beta) for styling
- Monaco editor for Dockerfile editing
- xterm.js with fit/webgl/web-links addons for terminal
- ReactFlow for canvas workspace visualization
- WebSocket for real-time terminal I/O and shell state
