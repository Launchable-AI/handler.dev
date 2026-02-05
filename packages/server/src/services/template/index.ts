/**
 * Template Service
 *
 * Unified service for managing templates (Dockerfiles, VM images, snapshots)
 * that can be built into artifacts for different backends.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import type {
  Template,
  TemplateType,
  TemplateStatus,
  TemplateArtifact,
  TemplateArtifactBackend,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  BuildTemplateRequest,
  BuildJob,
  TemplateListFilter,
} from '../../types/template.js';
import * as docker from '../docker.js';
import * as containerBuilder from '../container-builder.js';

export class TemplateService extends EventEmitter {
  private templatesDir: string;
  private templates: Map<string, Template> = new Map();
  private buildJobs: Map<string, BuildJob> = new Map();
  private initialized = false;

  constructor(dataDir: string) {
    super();
    this.templatesDir = path.join(dataDir, 'templates');
  }

  /**
   * Initialize the template service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[TemplateService] Initializing...');

    // Create templates directory
    if (!fs.existsSync(this.templatesDir)) {
      fs.mkdirSync(this.templatesDir, { recursive: true, mode: 0o700 });
    }

    // Load existing templates
    await this.loadTemplates();

    // Also scan Docker images and convert to templates
    await this.syncDockerImages();

    this.initialized = true;
    console.log(`[TemplateService] Initialized with ${this.templates.size} templates`);
  }

  /**
   * Load existing templates from disk
   */
  private async loadTemplates(): Promise<void> {
    const entries = fs.readdirSync(this.templatesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadataPath = path.join(this.templatesDir, entry.name, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const template = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Template;
            this.templates.set(template.id, template);
          } catch (error) {
            console.error(`[TemplateService] Failed to load template ${entry.name}:`, error);
          }
        }
      }
    }
  }

  /**
   * Sync Docker images as templates
   */
  private async syncDockerImages(): Promise<void> {
    try {
      const images = await docker.listImages();

      for (const image of images) {
        // Skip images without tags
        if (!image.repoTags || image.repoTags.length === 0 || image.repoTags[0] === '<none>:<none>') {
          continue;
        }

        const tag = image.repoTags[0];
        const existingTemplate = Array.from(this.templates.values()).find(
          (t) => t.artifacts.some((a) => a.backend === 'docker' && a.artifactId === tag)
        );

        // If no template exists for this image, create one
        if (!existingTemplate) {
          const id = `tpl-docker-${image.id.slice(7, 19)}`;
          const template: Template = {
            id,
            name: tag.split(':')[0],
            type: 'dockerfile',
            status: 'ready',
            baseImage: tag,
            artifacts: [
              {
                backend: 'docker',
                artifactId: tag,
                sizeMb: Math.round(image.size / 1024 / 1024),
                builtAt: new Date(image.created).toISOString(),
                status: 'ready',
              },
            ],
            createdAt: new Date(image.created).toISOString(),
            updatedAt: new Date(image.created).toISOString(),
          };

          this.templates.set(id, template);
        }
      }
    } catch (error) {
      console.warn('[TemplateService] Failed to sync Docker images:', error);
    }
  }

  /**
   * Save template metadata to disk
   */
  private saveTemplateMetadata(template: Template): void {
    const templateDir = path.join(this.templatesDir, template.id);
    if (!fs.existsSync(templateDir)) {
      fs.mkdirSync(templateDir, { recursive: true });
    }

    const metadataPath = path.join(templateDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(template, null, 2));

    // Also save Dockerfile if present
    if (template.dockerfile) {
      const dockerfilePath = path.join(templateDir, 'Dockerfile');
      fs.writeFileSync(dockerfilePath, template.dockerfile);
    }
  }

  /**
   * Generate a unique template ID
   */
  private generateTemplateId(): string {
    return 'tpl-' + crypto.randomUUID().slice(0, 8);
  }

  /**
   * List all templates
   */
  async list(filter?: TemplateListFilter): Promise<Template[]> {
    let templates = Array.from(this.templates.values());

    // Apply filters
    if (filter?.type && filter.type.length > 0) {
      templates = templates.filter((t) => filter.type!.includes(t.type));
    }

    if (filter?.status && filter.status.length > 0) {
      templates = templates.filter((t) => filter.status!.includes(t.status));
    }

    if (filter?.tags && filter.tags.length > 0) {
      templates = templates.filter((t) =>
        t.tags && filter.tags!.some((tag) => t.tags!.includes(tag))
      );
    }

    if (filter?.search) {
      const search = filter.search.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.name.toLowerCase().includes(search) ||
          (t.description && t.description.toLowerCase().includes(search))
      );
    }

    // Sort by update date (newest first)
    templates.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return templates;
  }

  /**
   * Get a template by ID
   */
  async get(id: string): Promise<Template | null> {
    return this.templates.get(id) || null;
  }

  /**
   * Get a template by name
   */
  async getByName(name: string): Promise<Template | null> {
    for (const template of this.templates.values()) {
      if (template.name === name) {
        return template;
      }
    }
    return null;
  }

  /**
   * Create a new template
   */
  async create(request: CreateTemplateRequest): Promise<Template> {
    // Check for name uniqueness
    const existing = await this.getByName(request.name);
    if (existing) {
      throw new Error(`Template with name '${request.name}' already exists`);
    }

    const id = this.generateTemplateId();
    const now = new Date().toISOString();

    const template: Template = {
      id,
      name: request.name,
      description: request.description,
      type: request.type,
      status: request.dockerfile ? 'draft' : 'ready',
      dockerfile: request.dockerfile,
      baseImage: request.baseImage,
      artifacts: [],
      createdAt: now,
      updatedAt: now,
      tags: request.tags,
    };

    this.templates.set(id, template);
    this.saveTemplateMetadata(template);

    this.emit('template:created', template);
    console.log(`[TemplateService] Template ${id} created: ${template.name}`);

    return template;
  }

  /**
   * Update a template
   */
  async update(id: string, updates: UpdateTemplateRequest): Promise<Template> {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Template ${id} not found`);
    }

    // Check name uniqueness if changing name
    if (updates.name && updates.name !== template.name) {
      const existing = await this.getByName(updates.name);
      if (existing) {
        throw new Error(`Template with name '${updates.name}' already exists`);
      }
    }

    // Apply updates
    if (updates.name !== undefined) template.name = updates.name;
    if (updates.description !== undefined) template.description = updates.description;
    if (updates.dockerfile !== undefined) {
      template.dockerfile = updates.dockerfile;
      // Mark as draft if Dockerfile changed (needs rebuild)
      template.status = 'draft';
    }
    if (updates.baseImage !== undefined) template.baseImage = updates.baseImage;
    if (updates.tags !== undefined) template.tags = updates.tags;

    template.updatedAt = new Date().toISOString();

    this.saveTemplateMetadata(template);

    this.emit('template:updated', template);
    console.log(`[TemplateService] Template ${id} updated`);

    return template;
  }

  /**
   * Delete a template
   */
  async delete(id: string): Promise<void> {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Template ${id} not found`);
    }

    // Delete template directory
    const templateDir = path.join(this.templatesDir, id);
    if (fs.existsSync(templateDir)) {
      fs.rmSync(templateDir, { recursive: true, force: true });
    }

    this.templates.delete(id);

    this.emit('template:deleted', { id });
    console.log(`[TemplateService] Template ${id} deleted`);
  }

  /**
   * Build a template for specified backends
   */
  async build(id: string, request: BuildTemplateRequest): Promise<BuildJob[]> {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Template ${id} not found`);
    }

    if (!template.dockerfile && !template.baseImage) {
      throw new Error('Template has no Dockerfile or base image to build');
    }

    const jobs: BuildJob[] = [];

    for (const backend of request.backends) {
      // Check if artifact already exists and force is not set
      const existingArtifact = template.artifacts.find(
        (a) => a.backend === backend && a.status === 'ready'
      );

      if (existingArtifact && !request.options?.force) {
        console.log(`[TemplateService] Artifact for ${backend} already exists, skipping`);
        continue;
      }

      const jobId = `build-${crypto.randomUUID().slice(0, 8)}`;
      const job: BuildJob = {
        id: jobId,
        templateId: id,
        backend,
        status: 'pending',
        progress: 0,
        logs: [],
        startedAt: new Date().toISOString(),
      };

      this.buildJobs.set(jobId, job);
      jobs.push(job);

      // Start build asynchronously
      this.executeBuild(job, template, request.options).catch((error) => {
        console.error(`[TemplateService] Build job ${jobId} failed:`, error);
      });
    }

    return jobs;
  }

  /**
   * Execute a build job
   */
  private async executeBuild(
    job: BuildJob,
    template: Template,
    options?: { force?: boolean; noCache?: boolean }
  ): Promise<void> {
    const addLog = (line: string) => {
      job.logs.push(`[${new Date().toISOString()}] ${line}`);
      this.emit('build:log', { jobId: job.id, line });
    };

    try {
      job.status = 'building';
      job.progress = 10;
      addLog(`Starting ${job.backend} build for template ${template.name}`);

      if (job.backend === 'docker') {
        // Docker build
        if (template.dockerfile) {
          job.progress = 20;
          addLog('Building Docker image from Dockerfile...');

          // Build image using container-builder
          const imageTag = `${template.name}:latest`.toLowerCase().replace(/[^a-z0-9:_.-]/g, '-');

          // Note: This is a simplified build - in production you'd want
          // to stream logs and track progress more granularly
          try {
            const result = await containerBuilder.buildAndCreateContainer({
              name: template.name,
              dockerfile: template.dockerfile,
            });

            job.progress = 90;
            addLog(`Docker image built: ${result.container.image}`);

            // Update artifact
            const artifact: TemplateArtifact = {
              backend: 'docker',
              artifactId: result.container.image,
              builtAt: new Date().toISOString(),
              status: 'ready',
            };

            // Remove old artifact and add new one
            template.artifacts = template.artifacts.filter((a) => a.backend !== 'docker');
            template.artifacts.push(artifact);
            template.status = 'ready';
            template.updatedAt = new Date().toISOString();
            this.saveTemplateMetadata(template);

          } catch (error) {
            throw error;
          }
        } else if (template.baseImage) {
          job.progress = 50;
          addLog(`Using base image: ${template.baseImage}`);

          // Just reference the existing image
          const artifact: TemplateArtifact = {
            backend: 'docker',
            artifactId: template.baseImage,
            builtAt: new Date().toISOString(),
            status: 'ready',
          };

          template.artifacts = template.artifacts.filter((a) => a.backend !== 'docker');
          template.artifacts.push(artifact);
          template.status = 'ready';
          template.updatedAt = new Date().toISOString();
          this.saveTemplateMetadata(template);
        }
      } else if (job.backend === 'vm') {
        // VM image build - not implemented yet
        throw new Error('VM image building not yet implemented');
      } else if (job.backend === 'daytona') {
        // Daytona snapshot - not implemented yet
        throw new Error('Daytona snapshot building not yet implemented');
      }

      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      addLog('Build completed successfully');

      this.emit('build:completed', job);

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date().toISOString();
      addLog(`Build failed: ${job.error}`);

      // Mark artifact as error
      const artifact = template.artifacts.find((a) => a.backend === job.backend);
      if (artifact) {
        artifact.status = 'error';
        artifact.error = job.error;
      } else {
        template.artifacts.push({
          backend: job.backend,
          artifactId: '',
          builtAt: new Date().toISOString(),
          status: 'error',
          error: job.error,
        });
      }

      template.status = 'error';
      template.error = job.error;
      this.saveTemplateMetadata(template);

      this.emit('build:failed', job);
    }
  }

  /**
   * Get build job status
   */
  getBuildJob(jobId: string): BuildJob | null {
    return this.buildJobs.get(jobId) || null;
  }

  /**
   * Get build jobs for a template
   */
  getTemplateBuildJobs(templateId: string): BuildJob[] {
    return Array.from(this.buildJobs.values()).filter(
      (job) => job.templateId === templateId
    );
  }

  /**
   * Create a template from a running sandbox snapshot
   */
  async createFromSnapshot(sandboxId: string, name: string): Promise<Template> {
    // This would commit a running container or create a VM snapshot
    // Implementation depends on the sandbox type
    throw new Error('Snapshot creation not yet implemented');
  }
}

// Singleton instance
let templateServiceInstance: TemplateService | null = null;

/**
 * Get or create the template service singleton
 */
export function getTemplateService(dataDir?: string): TemplateService {
  if (!templateServiceInstance) {
    if (!dataDir) {
      dataDir = `${process.env.HOME}/.local/share/handler`;
    }
    templateServiceInstance = new TemplateService(dataDir);
  }
  return templateServiceInstance;
}

/**
 * Initialize the template service
 */
export async function initializeTemplateService(dataDir?: string): Promise<TemplateService> {
  const service = getTemplateService(dataDir);
  await service.initialize();
  return service;
}
