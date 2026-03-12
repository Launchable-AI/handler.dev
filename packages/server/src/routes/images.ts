import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as dockerService from '../services/docker.js';
import { isDockerAvailable } from '../services/docker.js';
import { PullImageSchema, BuildImageSchema } from '../types/index.js';

const RenameImageSchema = z.object({
  newTag: z.string().min(1),
});

const images = new Hono();

// List all images
images.get('/', async (c) => {
  if (!(await isDockerAvailable())) {
    return c.json([]);
  }
  try {
    const list = await dockerService.listImages();
    return c.json(list);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Pull image from registry
images.post('/pull', zValidator('json', PullImageSchema), async (c) => {
  const { image } = c.req.valid('json');

  try {
    await dockerService.pullImage(image);
    return c.json({ success: true, image });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Build image from Dockerfile
images.post('/build', zValidator('json', BuildImageSchema), async (c) => {
  const { dockerfile, tag } = c.req.valid('json');

  try {
    await dockerService.buildImage(dockerfile, tag);
    return c.json({ success: true, tag });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Rename image (re-tag)
images.patch('/:tag/rename', zValidator('json', RenameImageSchema), async (c) => {
  const currentTag = decodeURIComponent(c.req.param('tag'));
  const { newTag } = c.req.valid('json');

  try {
    console.log(`Renaming image: ${currentTag} -> ${newTag}`);
    await dockerService.renameImage(currentTag, newTag);
    return c.json({ success: true, newTag });
  } catch (error) {
    console.error('Failed to rename image:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Delete image
images.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    console.log(`Deleting image: ${id}`);
    await dockerService.removeImage(id);
    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to delete image:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

export default images;
