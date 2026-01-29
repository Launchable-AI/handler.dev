export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentPermissions {
  allow?: string[];  // e.g. ["Bash(npm:*)", "Bash(git:*)"]
  deny?: string[];
}

export interface SkillConfig {
  name: string;           // directory name under ~/.claude/skills/
  content: string;        // SKILL.md content (including YAML frontmatter)
}

export interface RuleConfig {
  filename: string;       // e.g. "api-conventions.md"
  content: string;        // markdown content (may include paths: frontmatter)
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

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'UserPromptSubmit' | 'Stop' | 'Notification' | 'SessionStart' | 'SessionEnd' | 'SubagentStart' | 'SubagentStop';

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
  createdAt: string;
  updatedAt: string;
}
