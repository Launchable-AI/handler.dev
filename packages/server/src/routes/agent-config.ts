import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { getDataPath } from '../services/data-dir.js';
import * as agentConfigService from '../services/agent-config.js';
import { injectFilesIntoSandbox } from '../services/sandbox-inject.js';
import type { FileToInject } from '../services/sandbox-inject.js';
import type { SkillFrontmatter, SubagentConfig, PluginRef, PluginMarketplace } from '../types/agent-config.js';

const agentConfig = new Hono();

const MCPServerStdioSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
});

const MCPServerHttpSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
});

const MCPServerSseSchema = z.object({
  type: z.literal('sse'),
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
});

const MCPServerSchema = z.union([MCPServerStdioSchema, MCPServerHttpSchema, MCPServerSseSchema]);

const PermissionsSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const SkillFrontmatterSchema = z.object({
  description: z.string().optional(),
  'disable-model-invocation': z.boolean().optional(),
  'user-invocable': z.boolean().optional(),
  'allowed-tools': z.string().optional(),
  model: z.string().optional(),
  context: z.string().optional(),
  agent: z.string().optional(),
  'argument-hint': z.string().optional(),
}).optional();

const SkillSchema = z.object({
  name: z.string().min(1),
  content: z.string(),
  frontmatter: SkillFrontmatterSchema,
});

const RuleSchema = z.object({
  filename: z.string().min(1),
  content: z.string(),
});

const HookEntrySchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1),
  timeout: z.number().optional(),
});

const HookMatcherSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookEntrySchema),
});

const HookEventEnum = z.enum([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit',
  'Stop', 'Notification', 'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop',
  'PermissionRequest', 'PreCompact', 'Setup',
]);

const HooksSchema = z.record(HookEventEnum, z.array(HookMatcherSchema));

const SubagentSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'dontAsk', 'bypassPermissions', 'plan']).optional(),
  skills: z.array(z.string()).optional(),
  systemPrompt: z.string(),
});

const PluginRefSchema = z.object({
  name: z.string().min(1),
  marketplace: z.string().min(1),
  enabled: z.boolean(),
});

const PluginMarketplaceSchema = z.object({
  type: z.literal('github'),
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  mcpServers: z.record(MCPServerSchema).optional(),
  claudeMd: z.string().optional(),
  permissions: PermissionsSchema.optional(),
  skills: z.array(SkillSchema).optional(),
  rules: z.array(RuleSchema).optional(),
  hooks: HooksSchema.optional(),
  env: z.record(z.string()).optional(),
  model: z.string().optional(),
  subagents: z.array(SubagentSchema).optional(),
  plugins: z.array(PluginRefSchema).optional(),
  marketplaces: z.array(PluginMarketplaceSchema).optional(),
});

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  mcpServers: z.record(MCPServerSchema).optional(),
  claudeMd: z.string().optional(),
  permissions: PermissionsSchema.optional(),
  skills: z.array(SkillSchema).optional(),
  rules: z.array(RuleSchema).optional(),
  hooks: HooksSchema.optional(),
  env: z.record(z.string()).optional(),
  model: z.string().optional(),
  subagents: z.array(SubagentSchema).optional(),
  plugins: z.array(PluginRefSchema).optional(),
  marketplaces: z.array(PluginMarketplaceSchema).optional(),
});

// Serialize frontmatter fields to YAML string
function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string') {
      // Quote strings that contain special YAML characters
      if (value.includes(':') || value.includes('#') || value.includes('"') || value.includes("'")) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

// ============ Plugin Marketplace Proxy ============

interface MarketplacePlugin {
  name: string;
  description: string;
  version?: string;
  homepage?: string;
  category?: string;
  tags?: string[];
  source?: { type: string; url?: string; path?: string };
}

interface MarketplaceData {
  name: string;
  slug: string;
  description?: string;
  owner?: string;
  repo?: string;
  plugins: MarketplacePlugin[];
}

const KNOWN_MARKETPLACES: Array<{ owner: string; repo: string; branch: string; path: string }> = [
  { owner: 'anthropics', repo: 'claude-plugins-official', branch: 'main', path: '.claude-plugin/marketplace.json' },
  { owner: 'anthropics', repo: 'claude-code', branch: 'main', path: 'plugins/.claude-plugin/marketplace.json' },
  { owner: 'kivilaid', repo: 'plugin-marketplace', branch: 'main', path: '.claude-plugin/marketplace.json' },
];

// ============ Custom Marketplace Persistence ============

async function getCustomMarketplacesFile() { return getDataPath('plugin-marketplaces.json'); }

interface CustomMarketplace {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

interface CustomMarketplacesStore {
  marketplaces: CustomMarketplace[];
}

async function loadCustomMarketplaces(): Promise<CustomMarketplace[]> {
  try {
    const filePath = await getCustomMarketplacesFile();
    const raw = await readFile(filePath, 'utf-8');
    const store = JSON.parse(raw) as CustomMarketplacesStore;
    return store.marketplaces || [];
  } catch {
    return [];
  }
}

async function saveCustomMarketplaces(marketplaces: CustomMarketplace[]): Promise<void> {
  const filePath = await getCustomMarketplacesFile();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ marketplaces } as CustomMarketplacesStore, null, 2));
}

export function resetMarketplaceCache(): void {
  marketplaceCache.clear();
}

const marketplaceCache = new Map<string, { data: MarketplaceData; fetchedAt: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function fetchMarketplace(owner: string, repo: string, branchOverride?: string, pathOverride?: string): Promise<MarketplaceData | null> {
  const key = `${owner}/${repo}`;
  const cached = marketplaceCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const known = KNOWN_MARKETPLACES.find(m => m.owner === owner && m.repo === repo);
  const branch = branchOverride || known?.branch || 'main';
  const path = pathOverride || known?.path || '.claude-plugin/marketplace.json';

  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as MarketplaceData;
    if (!data.slug) {
      data.slug = `${owner}-${repo}`.replace(/[^a-zA-Z0-9-]/g, '-');
    }
    data.owner = owner;
    data.repo = repo;
    marketplaceCache.set(key, { data, fetchedAt: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// List all presets
agentConfig.get('/', async (c) => {
  const configs = await agentConfigService.getAgentConfigs();
  return c.json({ configs });
});

// Browse all known + custom marketplaces (must be before /:id to avoid matching)
agentConfig.get('/plugins/marketplaces', async (c) => {
  const customMarketplaces = await loadCustomMarketplaces();
  const results: (MarketplaceData & { isCustom: boolean })[] = [];

  const knownFetches = KNOWN_MARKETPLACES.map(async (m) => {
    const data = await fetchMarketplace(m.owner, m.repo, m.branch, m.path);
    if (data) results.push({ ...data, isCustom: false });
  });
  const customFetches = customMarketplaces.map(async (m) => {
    const data = await fetchMarketplace(m.owner, m.repo, m.branch, m.path);
    if (data) results.push({ ...data, isCustom: true });
  });
  await Promise.all([...knownFetches, ...customFetches]);
  return c.json({ marketplaces: results });
});

// Add a custom marketplace
agentConfig.post('/plugins/marketplaces', zValidator('json', z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  path: z.string().optional(),
})), async (c) => {
  const { owner, repo, branch, path } = c.req.valid('json');
  const effectiveBranch = branch || 'main';
  const effectivePath = path || '.claude-plugin/marketplace.json';

  // Check if already exists (known or custom)
  const isKnown = KNOWN_MARKETPLACES.some(m => m.owner === owner && m.repo === repo);
  if (isKnown) {
    return c.json({ error: 'This marketplace is already a built-in source' }, 400);
  }
  const existing = await loadCustomMarketplaces();
  if (existing.some(m => m.owner === owner && m.repo === repo)) {
    return c.json({ error: 'This marketplace has already been added' }, 400);
  }

  // Validate by fetching
  // Clear cache to force fresh fetch
  marketplaceCache.delete(`${owner}/${repo}`);
  const data = await fetchMarketplace(owner, repo, effectiveBranch, effectivePath);
  if (!data) {
    return c.json({ error: `Could not fetch marketplace.json from ${owner}/${repo}` }, 400);
  }

  // Persist
  existing.push({ owner, repo, branch: effectiveBranch, path: effectivePath });
  await saveCustomMarketplaces(existing);

  return c.json({ ...data, isCustom: true }, 201);
});

// Remove a custom marketplace
agentConfig.delete('/plugins/marketplaces/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const existing = await loadCustomMarketplaces();
  const filtered = existing.filter(m => !(m.owner === owner && m.repo === repo));
  if (filtered.length === existing.length) {
    return c.json({ error: 'Custom marketplace not found' }, 404);
  }
  await saveCustomMarketplaces(filtered);
  marketplaceCache.delete(`${owner}/${repo}`);
  return c.json({ success: true });
});

agentConfig.get('/plugins/marketplace/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const data = await fetchMarketplace(owner, repo);
  if (!data) {
    return c.json({ error: 'Marketplace not found or unavailable' }, 404);
  }
  return c.json(data);
});

agentConfig.get('/plugins/search', async (c) => {
  const query = (c.req.query('q') || '').toLowerCase();
  const results: Array<MarketplacePlugin & { marketplace: string; marketplaceOwner: string; marketplaceRepo: string }> = [];
  const customMarketplaces = await loadCustomMarketplaces();
  const allSources = [
    ...KNOWN_MARKETPLACES,
    ...customMarketplaces,
  ];

  const fetches = allSources.map(async (m) => {
    const data = await fetchMarketplace(m.owner, m.repo, m.branch, m.path);
    if (!data) return;
    for (const plugin of data.plugins) {
      if (!query ||
          plugin.name.toLowerCase().includes(query) ||
          plugin.description?.toLowerCase().includes(query) ||
          plugin.category?.toLowerCase().includes(query) ||
          plugin.tags?.some(t => t.toLowerCase().includes(query))) {
        results.push({
          ...plugin,
          marketplace: data.slug,
          marketplaceOwner: m.owner,
          marketplaceRepo: m.repo,
        });
      }
    }
  });

  await Promise.all(fetches);
  return c.json({ plugins: results });
});

// Get a single preset
agentConfig.get('/:id', async (c) => {
  const { id } = c.req.param();
  const config = await agentConfigService.getAgentConfig(id);

  if (!config) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  return c.json(config);
});

// Create a preset
agentConfig.post('/', zValidator('json', CreateSchema), async (c) => {
  const input = c.req.valid('json');
  const config = await agentConfigService.createAgentConfig(input);
  return c.json(config, 201);
});

// Update a preset
agentConfig.patch('/:id', zValidator('json', UpdateSchema), async (c) => {
  const { id } = c.req.param();
  const input = c.req.valid('json');
  const config = await agentConfigService.updateAgentConfig(id, input);

  if (!config) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  return c.json(config);
});

// Delete a preset
agentConfig.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const deleted = await agentConfigService.deleteAgentConfig(id);

  if (!deleted) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  return c.json({ success: true });
});

// Inject a preset into a running sandbox
agentConfig.post('/:id/inject/:sandboxId', async (c) => {
  const { id, sandboxId } = c.req.param();

  const config = await agentConfigService.getAgentConfig(id);
  if (!config) {
    return c.json({ error: 'Agent config not found' }, 404);
  }

  // Build the files to inject
  const filesToInject: FileToInject[] = [];

  // 1. ~/.claude.json (MCP servers config)
  if (Object.keys(config.mcpServers).length > 0) {
    filesToInject.push({
      content: JSON.stringify({ mcpServers: config.mcpServers }, null, 2),
      destPath: '/home/dev',
      filename: '.claude.json',
    });
  }

  // 2. ~/.claude/CLAUDE.md
  if (config.claudeMd) {
    filesToInject.push({
      content: config.claudeMd,
      destPath: '/home/dev/.claude',
      filename: 'CLAUDE.md',
    });
  }

  // 3. ~/.claude/settings.json (permissions + hooks + env + model + plugins)
  const settingsJson: Record<string, unknown> = {};
  if (config.permissions.allow?.length || config.permissions.deny?.length) {
    settingsJson.permissions = config.permissions;
  }
  if (config.hooks && Object.keys(config.hooks).length > 0) {
    settingsJson.hooks = config.hooks;
  }
  if (config.env && Object.keys(config.env).length > 0) {
    settingsJson.env = config.env;
  }
  if (config.model) {
    settingsJson.model = config.model;
  }
  // Add plugin marketplaces and enabled plugins
  if (config.marketplaces && config.marketplaces.length > 0) {
    settingsJson.extraKnownMarketplaces = config.marketplaces.map(m => ({
      type: m.type,
      owner: m.owner,
      repo: m.repo,
    }));
  }
  if (config.plugins && config.plugins.length > 0) {
    settingsJson.enabledPlugins = config.plugins
      .filter(p => p.enabled)
      .map(p => `${p.name}@${p.marketplace}`);
  }
  if (Object.keys(settingsJson).length > 0) {
    filesToInject.push({
      content: JSON.stringify(settingsJson, null, 2),
      destPath: '/home/dev/.claude',
      filename: 'settings.json',
    });
  }

  // 4. ~/.claude/skills/<name>/SKILL.md (with YAML frontmatter if present)
  if (config.skills && config.skills.length > 0) {
    for (const skill of config.skills) {
      let fileContent = '';
      if (skill.frontmatter && Object.keys(skill.frontmatter).length > 0) {
        const yaml = serializeFrontmatter(skill.frontmatter as Record<string, unknown>);
        fileContent = `---\n${yaml}\n---\n\n${skill.content}`;
      } else {
        fileContent = skill.content;
      }
      filesToInject.push({
        content: fileContent,
        destPath: `/home/dev/.claude/skills/${skill.name}`,
        filename: 'SKILL.md',
      });
    }
  }

  // 5. ~/.claude/rules/<filename>
  if (config.rules && config.rules.length > 0) {
    for (const rule of config.rules) {
      filesToInject.push({
        content: rule.content,
        destPath: '/home/dev/.claude/rules',
        filename: rule.filename,
      });
    }
  }

  // 6. ~/.claude/agents/<name>.md (subagents with YAML frontmatter)
  if (config.subagents && config.subagents.length > 0) {
    for (const agent of config.subagents) {
      const fmFields: Record<string, unknown> = {
        description: agent.description,
      };
      if (agent.tools?.length) fmFields.tools = agent.tools;
      if (agent.disallowedTools?.length) fmFields.disallowedTools = agent.disallowedTools;
      if (agent.model) fmFields.model = agent.model;
      if (agent.permissionMode) fmFields.permissionMode = agent.permissionMode;
      if (agent.skills?.length) fmFields.skills = agent.skills;

      const yaml = serializeFrontmatter(fmFields);
      const fileContent = `---\n${yaml}\n---\n\n${agent.systemPrompt}`;

      filesToInject.push({
        content: fileContent,
        destPath: '/home/dev/.claude/agents',
        filename: `${agent.name}.md`,
      });
    }
  }

  if (filesToInject.length === 0) {
    return c.json({ success: true, message: 'No files to inject', filesInjected: 0 });
  }

  try {
    const injectedCount = await injectFilesIntoSandbox(sandboxId, filesToInject);
    return c.json({ success: true, filesInjected: injectedCount });
  } catch (error) {
    console.error('[AgentConfig] Inject error:', error);
    const message = error instanceof Error ? error.message : 'Failed to inject config';
    return c.json({ error: message }, 500);
  }
});

export default agentConfig;
