# Contributing to Handler

Thank you for your interest in contributing to Handler! This guide will help you get started.

## Development Setup

1. **Prerequisites**: Node.js 22+, pnpm, Docker
2. **Clone the repo**:
   ```bash
   git clone https://github.com/Launchable-AI/handler.dev.git
   cd handler.dev
   ```
3. **Install dependencies**:
   ```bash
   pnpm install
   ```
4. **Start development servers**:
   ```bash
   pnpm dev
   ```
   This runs the backend on `:4001` and the frontend on `:5173`.

## Project Structure

- `packages/server/` — Hono (Node.js) backend API
- `packages/web/` — React 19 + Vite frontend
- `helpers/tap-helper/` — Rust TAP device helper for VM networking
- `scripts/` — VM image and setup scripts

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation.

## Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** and ensure they follow existing code patterns.
3. **Test your changes**:
   ```bash
   pnpm build   # Verify no type errors
   pnpm lint    # Verify no lint errors
   ```
4. **Commit** with a clear, descriptive message.

## Pull Request Process

1. Push your branch and open a PR against `main`.
2. Describe what your PR does and why.
3. Ensure `pnpm build` and `pnpm lint` pass.
4. A maintainer will review your PR.

## Coding Standards

- **TypeScript** for all server and frontend code.
- **Tailwind CSS v4** for styling (no inline styles or CSS modules).
- **React Query** for server state management.
- **Security**: Use `execFileSync` with argument arrays instead of `execSync` with string interpolation when executing shell commands with user input. See `packages/server/src/lib/safe-exec.ts`.
- **No `execSync` with user-controlled input**: All shell commands that handle user-controlled data must use `execFileSync`/`execFile` with argument arrays.

## Reporting Issues

Use [GitHub Issues](https://github.com/Launchable-AI/handler.dev/issues) to report bugs or request features.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
