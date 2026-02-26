# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Handler, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use one of these methods:

1. **GitHub Security Advisories**: [Report a vulnerability](https://github.com/Launchable-AI/handler.dev/security/advisories/new) through GitHub's private reporting feature.
2. **Email**: Send details to security@launchable.ai

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity, but we aim for patches within 30 days for critical issues

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Security Best Practices

When contributing to Handler, please follow these practices:

- Use `execFileSync` with argument arrays instead of `execSync` with string interpolation for shell commands
- Validate all user input at API boundaries using the validators in `packages/server/src/lib/validation.ts`
- Never expose secrets in command-line arguments; use stdin (`input` option) instead
- The server binds to `127.0.0.1` only; do not change this without careful consideration
