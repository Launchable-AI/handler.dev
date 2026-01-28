/**
 * Sandbox Adapter Interface
 *
 * Defines the contract for backend adapters that convert various compute
 * environments (Docker, VMs, Daytona) to the unified Sandbox abstraction.
 */

import type {
  Sandbox,
  SandboxBackend,
  CreateSandboxRequest,
  SandboxListFilter,
} from '../../types/sandbox.js';

/**
 * Interface that all sandbox adapters must implement
 */
export interface SandboxAdapter {
  /** The backend type this adapter handles */
  readonly backend: SandboxBackend;

  /**
   * Check if this backend is available and configured
   */
  isAvailable(): Promise<boolean>;

  /**
   * List all sandboxes from this backend
   */
  list(): Promise<Sandbox[]>;

  /**
   * Get a specific sandbox by ID
   * @param id Full sandbox ID (with prefix)
   */
  get(id: string): Promise<Sandbox | null>;

  /**
   * Create a new sandbox
   */
  create(request: CreateSandboxRequest): Promise<Sandbox>;

  /**
   * Start a sandbox
   */
  start(id: string): Promise<Sandbox>;

  /**
   * Stop a sandbox
   */
  stop(id: string): Promise<Sandbox>;

  /**
   * Delete a sandbox
   */
  delete(id: string): Promise<void>;
}

/**
 * Configuration for the SandboxService
 */
export interface SandboxServiceConfig {
  /** Adapters to register */
  adapters?: SandboxAdapter[];
}

/**
 * Result type for operations that may partially fail
 */
export interface AdapterResult<T> {
  backend: SandboxBackend;
  success: boolean;
  data?: T;
  error?: string;
}
