export interface MCPServerStdioConfig {
  type?: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPServerHttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface MCPServerSseConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type MCPServerConfig = MCPServerStdioConfig | MCPServerHttpConfig | MCPServerSseConfig;

export interface AgentPermissions {
  allow?: string[];  // e.g. ["Bash(npm:*)", "Bash(git:*)"]
  deny?: string[];
}

export interface SkillFrontmatter {
  description?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  'allowed-tools'?: string;
  model?: string;
  context?: string;
  agent?: string;
  'argument-hint'?: string;
}

export interface SkillConfig {
  name: string;
  content: string;                 // body markdown only
  frontmatter?: SkillFrontmatter;
}

export interface RuleConfig {
  filename: string;       // e.g. "api-conventions.md"
  content: string;        // markdown content (may include paths: frontmatter)
}

export type SubagentPermissionMode = 'default' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions' | 'plan';

export interface SubagentConfig {
  name: string;
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: SubagentPermissionMode;
  skills?: string[];
  systemPrompt: string;
}

export interface HookEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

export interface HookMatcher {
  matcher?: string;       // e.g. "Write|Edit", "Bash"
  hooks: HookEntry[];
}

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'UserPromptSubmit' | 'Stop' | 'Notification' | 'SessionStart' | 'SessionEnd' | 'SubagentStart' | 'SubagentStop' | 'PermissionRequest' | 'PreCompact' | 'Setup';

export interface AgentConfigPreset {
  id: string;           // "ac-{timestamp}-{random}"
  name: string;
  description?: string;
  mcpServers: Record<string, MCPServerConfig>;  // matches .mcp.json format
  claudeMd: string;                              // raw markdown
  permissions: AgentPermissions;                 // matches settings.local.json format
  skills: SkillConfig[];                          // custom slash commands
  rules: RuleConfig[];                            // modular rules files
  hooks: Partial<Record<HookEvent, HookMatcher[]>>;  // hook configuration
  env: Record<string, string>;                    // environment variables
  model: string;                                  // model override
  subagents: SubagentConfig[];
  createdAt: string;
  updatedAt: string;
}
