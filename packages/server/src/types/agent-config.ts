export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentPermissions {
  allow?: string[];  // e.g. ["Bash(npm:*)", "Bash(git:*)"]
  deny?: string[];
}

export interface AgentConfigPreset {
  id: string;           // "ac-{timestamp}-{random}"
  name: string;
  description?: string;
  mcpServers: Record<string, MCPServerConfig>;  // matches .mcp.json format
  claudeMd: string;                              // raw markdown
  permissions: AgentPermissions;                 // matches settings.local.json format
  createdAt: string;
  updatedAt: string;
}
