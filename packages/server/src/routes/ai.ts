import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  streamDockerfileAssistant,
  isAIConfigured,
  getDockerfilePrompt,
  setDockerfilePrompt,
  getDefaultDockerfilePrompt,
  getMCPInstallPrompt,
  setMCPInstallPrompt,
  getDefaultMCPInstallPrompt,
  getMCPSearchPrompt,
  setMCPSearchPrompt,
  getDefaultMCPSearchPrompt,
  getModel,
  setModel,
  getDefaultModel,
  getAvailableModels,
} from '../services/ai.js';

const ai = new Hono();

const DockerfileChatSchema = z.object({
  message: z.string().min(1),
  dockerfileContent: z.string().optional(),
});

const UpdatePromptSchema = z.object({
  prompt: z.string().nullable(),
});

// Check if AI is configured
ai.get('/status', async (c) => {
  return c.json({
    configured: isAIConfigured(),
  });
});

// Get all prompts and model settings
ai.get('/prompts', async (c) => {
  return c.json({
    dockerfile: {
      current: getDockerfilePrompt(),
      default: getDefaultDockerfilePrompt(),
      isCustom: getDockerfilePrompt() !== getDefaultDockerfilePrompt(),
    },
    mcpInstall: {
      current: getMCPInstallPrompt(),
      default: getDefaultMCPInstallPrompt(),
      isCustom: getMCPInstallPrompt() !== getDefaultMCPInstallPrompt(),
    },
    mcpSearch: {
      current: getMCPSearchPrompt(),
      default: getDefaultMCPSearchPrompt(),
      isCustom: getMCPSearchPrompt() !== getDefaultMCPSearchPrompt(),
    },
    model: {
      current: getModel(),
      default: getDefaultModel(),
      available: getAvailableModels(),
    },
  });
});

// Update dockerfile prompt
ai.put('/prompts/dockerfile', zValidator('json', UpdatePromptSchema), async (c) => {
  const { prompt } = c.req.valid('json');
  setDockerfilePrompt(prompt);
  return c.json({ success: true, prompt: getDockerfilePrompt() });
});

// Update MCP install prompt
ai.put('/prompts/mcp-install', zValidator('json', UpdatePromptSchema), async (c) => {
  const { prompt } = c.req.valid('json');
  setMCPInstallPrompt(prompt);
  return c.json({ success: true, prompt: getMCPInstallPrompt() });
});

// Update MCP search prompt
ai.put('/prompts/mcp-search', zValidator('json', UpdatePromptSchema), async (c) => {
  const { prompt } = c.req.valid('json');
  setMCPSearchPrompt(prompt);
  return c.json({ success: true, prompt: getMCPSearchPrompt() });
});

// Update model
const UpdateModelSchema = z.object({
  model: z.string().nullable(),
});

ai.put('/model', zValidator('json', UpdateModelSchema), async (c) => {
  const { model } = c.req.valid('json');
  setModel(model);
  return c.json({ success: true, model: getModel() });
});

// Stream dockerfile assistant chat
ai.post('/dockerfile-chat', zValidator('json', DockerfileChatSchema), async (c) => {
  const { message, dockerfileContent } = c.req.valid('json');

  if (!isAIConfigured()) {
    return c.json({ error: 'OpenRouter API key not configured' }, 503);
  }

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
        await streamDockerfileAssistant(message, dockerfileContent || '', {
          onChunk: (chunk) => sendEvent('chunk', chunk),
          onError: (error) => sendEvent('error', error),
          onDone: () => sendEvent('done', 'complete'),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        sendEvent('error', errorMessage);
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
});

export default ai;
