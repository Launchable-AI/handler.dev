import { vi } from 'vitest';

// Silence console output during tests to keep output clean.
// Individual tests can restore console if they need to assert on output.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
