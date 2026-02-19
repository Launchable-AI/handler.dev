import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { readdir, readFile, writeFile, unlink, mkdir, copyFile, stat, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT } from '../lib/paths.js';
import { SaveDockerfileSchema, RenameDockerfileSchema } from '../types/index.js';
import * as dockerService from '../services/docker.js';
import { getPublicKey } from '../services/container-builder.js';

interface DockerfileInfo {
  name: string;
  modifiedAt: string;
  isSystem?: boolean;
  description?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCKERFILES_DIR = join(PROJECT_ROOT, 'data', 'dockerfiles');
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

interface TemplateInfo {
  name: string;
  description: string;
}

// Template descriptions
const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  'default': 'Full dev environment with SSH, neovim, python, nodejs, tmux, and OpenCode',
  'base': 'Dev environment without SSH - use with docker exec',
  'ubuntu-ssh': 'Minimal Ubuntu with SSH server only',
};

const dockerfiles = new Hono();

// List available templates
dockerfiles.get('/templates', async (c) => {
  try {
    const files = await readdir(TEMPLATES_DIR);
    const templateFiles = files.filter((f) => f.endsWith('.dockerfile'));

    const templates: TemplateInfo[] = templateFiles.map((f) => {
      const name = f.replace('.dockerfile', '');
      return {
        name,
        description: TEMPLATE_DESCRIPTIONS[name] || 'Custom template',
      };
    });

    return c.json(templates);
  } catch {
    return c.json([]);
  }
});

// Get template content
dockerfiles.get('/templates/:name', async (c) => {
  const name = c.req.param('name');
  const filePath = join(TEMPLATES_DIR, `${name}.dockerfile`);

  try {
    const content = await readFile(filePath, 'utf-8');
    return c.json({ name, content, description: TEMPLATE_DESCRIPTIONS[name] || 'Custom template' });
  } catch {
    return c.json({ error: 'Template not found' }, 404);
  }
});

// Ensure dockerfiles directory exists and has default template
async function ensureDir() {
  await mkdir(DOCKERFILES_DIR, { recursive: true });

  // Copy default template if no dockerfiles exist
  const files = await readdir(DOCKERFILES_DIR).catch(() => []);
  const hasDockerfiles = files.some((f) => f.endsWith('.dockerfile'));

  if (!hasDockerfiles) {
    const defaultSrc = join(TEMPLATES_DIR, 'default.dockerfile');
    const defaultDst = join(DOCKERFILES_DIR, 'default.dockerfile');
    if (existsSync(defaultSrc)) {
      await copyFile(defaultSrc, defaultDst);
    }
  }
}

// List all saved Dockerfiles with metadata (including system templates)
dockerfiles.get('/', async (c) => {
  await ensureDir();

  try {
    // Get user dockerfiles
    const userFiles = await readdir(DOCKERFILES_DIR);
    const userDockerfiles = userFiles.filter((f) => f.endsWith('.dockerfile'));

    const userList: DockerfileInfo[] = await Promise.all(
      userDockerfiles.map(async (f) => {
        const filePath = join(DOCKERFILES_DIR, f);
        const stats = await stat(filePath);
        return {
          name: f.replace('.dockerfile', ''),
          modifiedAt: stats.mtime.toISOString(),
          isSystem: false,
        };
      })
    );

    // Get system templates
    const templateFiles = await readdir(TEMPLATES_DIR).catch(() => []);
    const systemDockerfiles = templateFiles.filter((f) => f.endsWith('.dockerfile'));

    const systemList: DockerfileInfo[] = await Promise.all(
      systemDockerfiles.map(async (f) => {
        const filePath = join(TEMPLATES_DIR, f);
        const stats = await stat(filePath);
        const name = f.replace('.dockerfile', '');
        return {
          name,
          modifiedAt: stats.mtime.toISOString(),
          isSystem: true,
          description: TEMPLATE_DESCRIPTIONS[name],
        };
      })
    );

    // Combine: user files first (sorted by modified), then system templates
    // Filter out system templates that have the same name as user files to avoid duplicates
    userList.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    const userNames = new Set(userList.map(f => f.name));
    const filteredSystemList = systemList.filter(f => !userNames.has(f.name));
    filteredSystemList.sort((a, b) => a.name.localeCompare(b.name));

    return c.json([...userList, ...filteredSystemList]);
  } catch {
    return c.json([]);
  }
});

// Get specific Dockerfile (checks user dir first, then system templates)
dockerfiles.get('/:name', async (c) => {
  const name = c.req.param('name');
  const userPath = join(DOCKERFILES_DIR, `${name}.dockerfile`);
  const systemPath = join(TEMPLATES_DIR, `${name}.dockerfile`);

  // Try user directory first
  if (existsSync(userPath)) {
    const content = await readFile(userPath, 'utf-8');
    return c.json({ name, content, isSystem: false });
  }

  // Try system templates
  if (existsSync(systemPath)) {
    const content = await readFile(systemPath, 'utf-8');
    return c.json({ name, content, isSystem: true, description: TEMPLATE_DESCRIPTIONS[name] });
  }

  return c.json({ error: 'Dockerfile not found' }, 404);
});

// Save Dockerfile
dockerfiles.post('/:name', zValidator('json', SaveDockerfileSchema), async (c) => {
  await ensureDir();

  const name = c.req.param('name');
  const { content } = c.req.valid('json');
  const filePath = join(DOCKERFILES_DIR, `${name}.dockerfile`);

  try {
    await writeFile(filePath, content, 'utf-8');
    return c.json({ success: true, name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Delete Dockerfile
dockerfiles.delete('/:name', async (c) => {
  const name = c.req.param('name');
  const filePath = join(DOCKERFILES_DIR, `${name}.dockerfile`);

  try {
    await unlink(filePath);
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Dockerfile not found' }, 404);
  }
});

// Rename Dockerfile
dockerfiles.patch('/:name', zValidator('json', RenameDockerfileSchema), async (c) => {
  const name = c.req.param('name');
  const { newName } = c.req.valid('json');
  const oldPath = join(DOCKERFILES_DIR, `${name}.dockerfile`);
  const newPath = join(DOCKERFILES_DIR, `${newName}.dockerfile`);

  // Check if source exists
  if (!existsSync(oldPath)) {
    return c.json({ error: 'Dockerfile not found' }, 404);
  }

  // Check if target already exists
  if (existsSync(newPath)) {
    return c.json({ error: 'A Dockerfile with that name already exists' }, 409);
  }

  try {
    await rename(oldPath, newPath);
    return c.json({ success: true, name: newName });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Build image from Dockerfile (with streaming logs)
dockerfiles.post('/:name/build', async (c) => {
  const name = c.req.param('name');
  const version = c.req.query('version'); // Optional version tag (e.g., timestamp)
  const userPath = join(DOCKERFILES_DIR, `${name}.dockerfile`);
  const systemPath = join(TEMPLATES_DIR, `${name}.dockerfile`);

  // Check user directory first, then system templates
  const filePath = existsSync(userPath) ? userPath : existsSync(systemPath) ? systemPath : null;
  if (!filePath) {
    return c.json({ error: 'Dockerfile not found' }, 404);
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    // Docker image tags must be lowercase
    // Use provided version or default to 'latest'
    const tagVersion = version || 'latest';
    const tag = `handler-${name.toLowerCase()}:${tagVersion}`;

    // Inject SSH public key (replaces {{PUBLIC_KEY}} placeholder)
    const publicKey = await getPublicKey();
    const dockerfileWithKey = content.replace(/\{\{PUBLIC_KEY\}\}/g, publicKey);

    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (event: string, data: string) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          await dockerService.buildImageWithLogs(dockerfileWithKey, tag, (log) => {
            sendEvent('log', log);
          }, name);  // Pass dockerfile name for tracking
          sendEvent('done', tag);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Build failed';
          sendEvent('error', message);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

export default dockerfiles;
