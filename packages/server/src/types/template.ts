/**
 * Unified Template Types
 *
 * This module defines the "Template" abstraction that allows managing
 * Dockerfiles, VM base images, and Daytona snapshots through a single interface.
 */

export type TemplateType = 'dockerfile' | 'vm-image' | 'snapshot';
export type TemplateStatus = 'draft' | 'building' | 'ready' | 'error';
export type TemplateArtifactBackend = 'docker' | 'vm' | 'daytona';

/**
 * A built artifact from a template
 */
export interface TemplateArtifact {
  /** Target backend */
  backend: TemplateArtifactBackend;
  /** Backend-specific ID (Docker image tag, VM image name, etc.) */
  artifactId: string;
  /** Size in MB */
  sizeMb?: number;
  /** When this artifact was built */
  builtAt: string;
  /** Build error if failed */
  error?: string;
  /** Build status */
  status: 'building' | 'ready' | 'error';
}

/**
 * Unified Template interface
 */
export interface Template {
  /** Template ID: tpl-xxx */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Template type */
  type: TemplateType;
  /** Current status */
  status: TemplateStatus;
  /** Dockerfile content (for dockerfile type) */
  dockerfile?: string;
  /** Base image/parent template reference */
  baseImage?: string;
  /** Built artifacts for different backends */
  artifacts: TemplateArtifact[];
  /** Creation timestamp (ISO string) */
  createdAt: string;
  /** Last update timestamp (ISO string) */
  updatedAt: string;
  /** Tags for categorization */
  tags?: string[];
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Request to create a new template
 */
export interface CreateTemplateRequest {
  /** Template name */
  name: string;
  /** Description */
  description?: string;
  /** Template type */
  type: TemplateType;
  /** Dockerfile content (for dockerfile type) */
  dockerfile?: string;
  /** Base image reference */
  baseImage?: string;
  /** Tags */
  tags?: string[];
}

/**
 * Request to update a template
 */
export interface UpdateTemplateRequest {
  /** Template name */
  name?: string;
  /** Description */
  description?: string;
  /** Dockerfile content */
  dockerfile?: string;
  /** Base image reference */
  baseImage?: string;
  /** Tags */
  tags?: string[];
}

/**
 * Request to build a template
 */
export interface BuildTemplateRequest {
  /** Target backends to build for */
  backends: TemplateArtifactBackend[];
  /** Build options */
  options?: {
    /** Force rebuild even if artifact exists */
    force?: boolean;
    /** No cache during build */
    noCache?: boolean;
  };
}

/**
 * Build job status
 */
export interface BuildJob {
  /** Job ID */
  id: string;
  /** Template ID */
  templateId: string;
  /** Target backend */
  backend: TemplateArtifactBackend;
  /** Build status */
  status: 'pending' | 'building' | 'completed' | 'failed';
  /** Progress (0-100) */
  progress: number;
  /** Build logs */
  logs: string[];
  /** Start time */
  startedAt: string;
  /** Completion time */
  completedAt?: string;
  /** Error message */
  error?: string;
}

/**
 * Filter options for listing templates
 */
export interface TemplateListFilter {
  /** Filter by type */
  type?: TemplateType[];
  /** Filter by status */
  status?: TemplateStatus[];
  /** Filter by tags */
  tags?: string[];
  /** Search by name */
  search?: string;
}
