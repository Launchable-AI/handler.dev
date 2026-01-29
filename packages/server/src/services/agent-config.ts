import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfigPreset, MCPServerConfig, SkillConfig, RuleConfig, HookMatcher, HookEvent, SubagentConfig, PluginRef, PluginMarketplace } from '../types/agent-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const CONFIG_FILE = join(PROJECT_ROOT, 'data', 'agent-configs.json');

interface AgentConfigsData {
  configs: AgentConfigPreset[];
}

const DEFAULT_DATA: AgentConfigsData = {
  configs: [],
};

let cachedData: AgentConfigsData | null = null;

async function loadConfigs(): Promise<AgentConfigsData> {
  if (cachedData) {
    return cachedData;
  }

  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    cachedData = JSON.parse(content) as AgentConfigsData;
    return cachedData;
  } catch {
    return DEFAULT_DATA;
  }
}

async function saveConfigs(data: AgentConfigsData): Promise<void> {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(data, null, 2));
  cachedData = data;
}

function generateId(): string {
  return `ac-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export async function getAgentConfigs(): Promise<AgentConfigPreset[]> {
  const data = await loadConfigs();
  return data.configs;
}

export async function getAgentConfig(id: string): Promise<AgentConfigPreset | null> {
  const data = await loadConfigs();
  return data.configs.find(c => c.id === id) || null;
}

export async function createAgentConfig(input: {
  name: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  claudeMd?: string;
  permissions?: { allow?: string[]; deny?: string[] };
  skills?: SkillConfig[];
  rules?: RuleConfig[];
  hooks?: Partial<Record<HookEvent, HookMatcher[]>>;
  env?: Record<string, string>;
  model?: string;
  subagents?: SubagentConfig[];
  plugins?: PluginRef[];
  marketplaces?: PluginMarketplace[];
}): Promise<AgentConfigPreset> {
  const data = await loadConfigs();
  const now = new Date().toISOString();

  const config: AgentConfigPreset = {
    id: generateId(),
    name: input.name,
    description: input.description,
    mcpServers: input.mcpServers || {},
    claudeMd: input.claudeMd || '',
    permissions: input.permissions || {},
    skills: input.skills || [],
    rules: input.rules || [],
    hooks: input.hooks || {},
    env: input.env || {},
    model: input.model || '',
    subagents: input.subagents || [],
    plugins: input.plugins || [],
    marketplaces: input.marketplaces || [],
    createdAt: now,
    updatedAt: now,
  };

  data.configs.unshift(config);
  await saveConfigs(data);
  return config;
}

export async function updateAgentConfig(id: string, input: {
  name?: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  claudeMd?: string;
  permissions?: { allow?: string[]; deny?: string[] };
  skills?: SkillConfig[];
  rules?: RuleConfig[];
  hooks?: Partial<Record<HookEvent, HookMatcher[]>>;
  env?: Record<string, string>;
  model?: string;
  subagents?: SubagentConfig[];
  plugins?: PluginRef[];
  marketplaces?: PluginMarketplace[];
}): Promise<AgentConfigPreset | null> {
  const data = await loadConfigs();
  const index = data.configs.findIndex(c => c.id === id);

  if (index === -1) {
    return null;
  }

  const config = data.configs[index];
  const updated: AgentConfigPreset = {
    ...config,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.mcpServers !== undefined && { mcpServers: input.mcpServers }),
    ...(input.claudeMd !== undefined && { claudeMd: input.claudeMd }),
    ...(input.permissions !== undefined && { permissions: input.permissions }),
    ...(input.skills !== undefined && { skills: input.skills }),
    ...(input.rules !== undefined && { rules: input.rules }),
    ...(input.hooks !== undefined && { hooks: input.hooks }),
    ...(input.env !== undefined && { env: input.env }),
    ...(input.model !== undefined && { model: input.model }),
    ...(input.subagents !== undefined && { subagents: input.subagents }),
    ...(input.plugins !== undefined && { plugins: input.plugins }),
    ...(input.marketplaces !== undefined && { marketplaces: input.marketplaces }),
    updatedAt: new Date().toISOString(),
  };

  data.configs[index] = updated;
  await saveConfigs(data);
  return updated;
}

export async function deleteAgentConfig(id: string): Promise<boolean> {
  const data = await loadConfigs();
  const index = data.configs.findIndex(c => c.id === id);

  if (index === -1) {
    return false;
  }

  data.configs.splice(index, 1);
  await saveConfigs(data);
  return true;
}
