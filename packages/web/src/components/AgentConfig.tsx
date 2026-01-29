import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Loader2, X, Play, ChevronDown, Settings2, Server, FileText, Sparkles, Users, BookOpen, Zap, Shield } from 'lucide-react';
import { useAgentConfigs, useCreateAgentConfig, useUpdateAgentConfig, useDeleteAgentConfig, useInjectAgentConfig } from '../hooks/useAgentConfigs';
import { useSandboxes } from '../hooks/useSandboxes';
import type { MCPServerConfig, MCPServerStdioConfig, MCPServerHttpConfig, MCPServerSseConfig, AgentPermissions, SkillConfig, SkillFrontmatter, SubagentConfig, SubagentPermissionMode, RuleConfig, HookMatcher, HookEvent } from '../api/client';

type TabId = 'general' | 'mcp' | 'instructions' | 'skills' | 'subagents' | 'rules' | 'hooks' | 'permissions';

const ALL_HOOK_EVENTS: HookEvent[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit',
  'Stop', 'Notification', 'SessionStart', 'SessionEnd',
  'SubagentStart', 'SubagentStop', 'PermissionRequest', 'PreCompact', 'Setup',
];

const PERMISSION_MODES: { value: SubagentPermissionMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'dontAsk', label: "Don't Ask" },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
  { value: 'plan', label: 'Plan' },
];

// Shared styles
const inputClass = "w-full px-2.5 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)]";
const monoInputClass = `${inputClass} font-mono`;
const labelClass = "block text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1 font-medium";
const cardClass = "border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] p-3 space-y-2";
const emptyClass = "p-4 text-xs text-[hsl(var(--text-muted))] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] text-center";
const addBtnClass = "flex items-center gap-1 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))] font-medium";
const removeBtnClass = "p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] transition-colors";
const selectClass = "text-xs px-2 py-1.5 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan-dim))]";

function getTransportType(config: MCPServerConfig): 'stdio' | 'http' | 'sse' {
  if ('type' in config && config.type === 'http') return 'http';
  if ('type' in config && config.type === 'sse') return 'sse';
  return 'stdio';
}

export function AgentConfig() {
  const { data, isLoading } = useAgentConfigs();
  const { data: sandboxData } = useSandboxes();
  const createMutation = useCreateAgentConfig();
  const updateMutation = useUpdateAgentConfig();
  const deleteMutation = useDeleteAgentConfig();
  const injectMutation = useInjectAgentConfig();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInjectDropdown, setShowInjectDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('general');

  // Editor state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMcpServers, setEditMcpServers] = useState<Record<string, MCPServerConfig>>({});
  const [editClaudeMd, setEditClaudeMd] = useState('');
  const [editPermissions, setEditPermissions] = useState<AgentPermissions>({});
  const [editSkills, setEditSkills] = useState<SkillConfig[]>([]);
  const [editRules, setEditRules] = useState<RuleConfig[]>([]);
  const [editHooks, setEditHooks] = useState<Partial<Record<HookEvent, HookMatcher[]>>>({});
  const [editEnv, setEditEnv] = useState<Record<string, string>>({});
  const [editModel, setEditModel] = useState('');
  const [editSubagents, setEditSubagents] = useState<SubagentConfig[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  const configs = data?.configs || [];
  const selected = configs.find(c => c.id === selectedId) || null;
  const runningSandboxes = sandboxData?.sandboxes.filter(s => s.status === 'running') || [];

  useEffect(() => {
    if (selected) {
      setEditName(selected.name);
      setEditDescription(selected.description || '');
      setEditMcpServers(JSON.parse(JSON.stringify(selected.mcpServers)));
      setEditClaudeMd(selected.claudeMd);
      setEditPermissions(JSON.parse(JSON.stringify(selected.permissions)));
      setEditSkills(JSON.parse(JSON.stringify(selected.skills || [])));
      setEditRules(JSON.parse(JSON.stringify(selected.rules || [])));
      setEditHooks(JSON.parse(JSON.stringify(selected.hooks || {})));
      setEditEnv(JSON.parse(JSON.stringify(selected.env || {})));
      setEditModel(selected.model || '');
      setEditSubagents(JSON.parse(JSON.stringify(selected.subagents || [])));
      setIsDirty(false);
    }
  }, [selected?.id, selected?.updatedAt]);

  const markDirty = () => setIsDirty(true);

  const handleCreate = async () => {
    try {
      const preset = await createMutation.mutateAsync({ name: 'New Preset' });
      setSelectedId(preset.id);
    } catch (err) {
      console.error('Failed to create preset:', err);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    try {
      await updateMutation.mutateAsync({
        id: selectedId,
        name: editName,
        description: editDescription || undefined,
        mcpServers: editMcpServers,
        claudeMd: editClaudeMd,
        permissions: editPermissions,
        skills: editSkills,
        rules: editRules,
        hooks: editHooks,
        env: editEnv,
        model: editModel,
        subagents: editSubagents,
      });
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to save preset:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      console.error('Failed to delete preset:', err);
    }
  };

  const handleInject = async (sandboxId: string) => {
    if (!selectedId) return;
    setShowInjectDropdown(false);
    try {
      await injectMutation.mutateAsync({ configId: selectedId, sandboxId });
    } catch (err) {
      console.error('Failed to inject config:', err);
    }
  };

  // Badge counts
  const mcpCount = Object.keys(editMcpServers).length;
  const skillCount = editSkills.length;
  const subagentCount = editSubagents.length;
  const ruleCount = editRules.length;
  const hookCount = Object.values(editHooks).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  const permCount = (editPermissions.allow?.length || 0) + (editPermissions.deny?.length || 0);
  const envCount = Object.keys(editEnv).length;

  const tabs: { id: TabId; label: string; icon: typeof Settings2; count?: number }[] = [
    { id: 'general', label: 'General', icon: Settings2, count: envCount || undefined },
    { id: 'mcp', label: 'MCP Servers', icon: Server, count: mcpCount || undefined },
    { id: 'instructions', label: 'Instructions', icon: FileText },
    { id: 'skills', label: 'Skills', icon: Sparkles, count: skillCount || undefined },
    { id: 'subagents', label: 'Subagents', icon: Users, count: subagentCount || undefined },
    { id: 'rules', label: 'Rules', icon: BookOpen, count: ruleCount || undefined },
    { id: 'hooks', label: 'Hooks', icon: Zap, count: hookCount || undefined },
    { id: 'permissions', label: 'Permissions', icon: Shield, count: permCount || undefined },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel: preset list */}
      <div className="w-64 border-r border-[hsl(var(--border))] flex flex-col">
        <div className="p-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
          <span className="text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider">Presets</span>
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="p-1 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] transition-colors"
            title="New preset"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {configs.length === 0 ? (
            <div className="p-4 text-xs text-[hsl(var(--text-muted))] text-center">
              No presets yet. Click + to create one.
            </div>
          ) : (
            configs.map(config => (
              <button
                key={config.id}
                onClick={() => setSelectedId(config.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-[hsl(var(--border))] transition-colors group ${
                  selectedId === config.id
                    ? 'bg-[hsl(var(--cyan)/0.1)] border-l-2 border-l-[hsl(var(--cyan))]'
                    : 'hover:bg-[hsl(var(--bg-elevated))] border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">{config.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(config.id); }}
                    className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {config.description && (
                  <span className="text-[10px] text-[hsl(var(--text-muted))] truncate block mt-0.5">{config.description}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel: editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-xs text-[hsl(var(--text-muted))]">
            Select a preset to edit, or create a new one.
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
              <div className="text-xs text-[hsl(var(--text-muted))]">
                {isDirty ? 'Unsaved changes' : 'Saved'}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShowInjectDropdown(!showInjectDropdown)}
                    disabled={runningSandboxes.length === 0 || injectMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50 transition-colors"
                    title={runningSandboxes.length === 0 ? 'No running sandboxes' : 'Inject into sandbox'}
                  >
                    {injectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Inject
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showInjectDropdown && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg">
                      {runningSandboxes.map(sandbox => (
                        <button
                          key={sandbox.id}
                          onClick={() => handleInject(sandbox.id)}
                          className="w-full text-left px-3 py-2 text-xs text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] hover:text-[hsl(var(--text-primary))] transition-colors"
                        >
                          {sandbox.name}
                          <span className="text-[10px] text-[hsl(var(--text-muted))] ml-1">({sandbox.backend})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || updateMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[hsl(var(--cyan))] text-white hover:bg-[hsl(var(--cyan-dim))] disabled:opacity-50 transition-colors"
                >
                  {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </button>
              </div>
            </div>

            {/* Inject result messages */}
            {injectMutation.isSuccess && (
              <div className="mx-4 mt-2 p-2 text-xs bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] text-[hsl(var(--green))]">
                Config injected successfully ({(injectMutation.data as { filesInjected: number }).filesInjected} files)
              </div>
            )}
            {injectMutation.isError && (
              <div className="mx-4 mt-2 p-2 text-xs bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-[hsl(var(--red))]">
                {injectMutation.error.message}
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-[hsl(var(--border))] overflow-x-auto">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-[hsl(var(--cyan))] text-[hsl(var(--cyan))]'
                        : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    {tab.count !== undefined && (
                      <span className={`ml-0.5 px-1.5 py-0.5 text-[9px] rounded-full font-medium ${
                        activeTab === tab.id
                          ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]'
                          : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))]'
                      }`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'general' && (
                <GeneralTab
                  name={editName} setName={v => { setEditName(v); markDirty(); }}
                  description={editDescription} setDescription={v => { setEditDescription(v); markDirty(); }}
                  model={editModel} setModel={v => { setEditModel(v); markDirty(); }}
                  env={editEnv} setEnv={v => { setEditEnv(v); markDirty(); }}
                />
              )}
              {activeTab === 'mcp' && (
                <MCPTab
                  servers={editMcpServers}
                  setServers={v => { setEditMcpServers(v); markDirty(); }}
                />
              )}
              {activeTab === 'instructions' && (
                <InstructionsTab
                  claudeMd={editClaudeMd}
                  setClaudeMd={v => { setEditClaudeMd(v); markDirty(); }}
                />
              )}
              {activeTab === 'skills' && (
                <SkillsTab
                  skills={editSkills}
                  setSkills={v => { setEditSkills(v); markDirty(); }}
                />
              )}
              {activeTab === 'subagents' && (
                <SubagentsTab
                  subagents={editSubagents}
                  setSubagents={v => { setEditSubagents(v); markDirty(); }}
                />
              )}
              {activeTab === 'rules' && (
                <RulesTab
                  rules={editRules}
                  setRules={v => { setEditRules(v); markDirty(); }}
                />
              )}
              {activeTab === 'hooks' && (
                <HooksTab
                  hooks={editHooks}
                  setHooks={v => { setEditHooks(v); markDirty(); }}
                />
              )}
              {activeTab === 'permissions' && (
                <PermissionsTab
                  permissions={editPermissions}
                  setPermissions={v => { setEditPermissions(v); markDirty(); }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── General Tab ────────────────────────────────────────────────

function GeneralTab({ name, setName, description, setDescription, model, setModel, env, setEnv }: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  model: string; setModel: (v: string) => void;
  env: Record<string, string>; setEnv: (v: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-[hsl(var(--text-muted))]">Basic preset configuration — name, description, model override, and environment variables.</p>

      <div className="space-y-3">
        <div>
          <label className={labelClass}>Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Model</label>
          <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder='e.g. "opus", "sonnet", or leave empty for default' className={inputClass} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={labelClass + " mb-0"}>Environment Variables</label>
          <button onClick={() => setEnv({ ...env, '': '' })} className={addBtnClass}>
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {Object.keys(env).length === 0 ? (
          <div className={emptyClass}>No environment variables configured.</div>
        ) : (
          <div className="space-y-1">
            {Object.entries(env).map(([key, value], i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="text" value={key}
                  onChange={e => {
                    const entries = Object.entries(env);
                    entries[i] = [e.target.value, value];
                    setEnv(Object.fromEntries(entries));
                  }}
                  placeholder="KEY"
                  className="w-1/3 px-1.5 py-1 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none"
                />
                <span className="text-[10px] text-[hsl(var(--text-muted))]">=</span>
                <input
                  type="text" value={value}
                  onChange={e => {
                    const entries = Object.entries(env);
                    entries[i] = [key, e.target.value];
                    setEnv(Object.fromEntries(entries));
                  }}
                  placeholder="value"
                  className="flex-1 px-1.5 py-1 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none"
                />
                <button onClick={() => {
                  const entries = Object.entries(env);
                  entries.splice(i, 1);
                  setEnv(Object.fromEntries(entries));
                }} className={removeBtnClass}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MCP Servers Tab ────────────────────────────────────────────

function MCPTab({ servers, setServers }: {
  servers: Record<string, MCPServerConfig>;
  setServers: (v: Record<string, MCPServerConfig>) => void;
}) {
  const addServer = () => {
    const name = `server-${Date.now()}`;
    setServers({ ...servers, [name]: { command: '', args: [] } as MCPServerStdioConfig });
  };

  const removeServer = (name: string) => {
    const copy = { ...servers };
    delete copy[name];
    setServers(copy);
  };

  const updateServer = (oldName: string, newName: string, config: MCPServerConfig) => {
    const copy = { ...servers };
    if (oldName !== newName) delete copy[oldName];
    copy[newName] = config;
    setServers(copy);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[hsl(var(--text-muted))]">Configure MCP servers — supports stdio, HTTP, and SSE transports.</p>
        <button onClick={addServer} className={addBtnClass}>
          <Plus className="h-3 w-3" /> Add Server
        </button>
      </div>
      {Object.keys(servers).length === 0 ? (
        <div className={emptyClass}>No MCP servers configured. Add a server to connect external tools.</div>
      ) : (
        <div className="space-y-3">
          {Object.entries(servers).map(([name, config]) => (
            <MCPServerEditor
              key={name}
              name={name}
              config={config}
              onChange={(newName, newConfig) => updateServer(name, newName, newConfig)}
              onRemove={() => removeServer(name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MCPServerEditor({ name, config, onChange, onRemove }: {
  name: string;
  config: MCPServerConfig;
  onChange: (newName: string, config: MCPServerConfig) => void;
  onRemove: () => void;
}) {
  const transport = getTransportType(config);
  const [serverName, setServerName] = useState(name);

  // stdio fields
  const stdioConfig = transport === 'stdio' ? config as MCPServerStdioConfig : null;
  const [command, setCommand] = useState(stdioConfig?.command || '');
  const [args, setArgs] = useState(stdioConfig?.args.join(' ') || '');
  const [envPairs, setEnvPairs] = useState<Array<[string, string]>>(
    stdioConfig?.env ? Object.entries(stdioConfig.env) : []
  );

  // http/sse fields
  const urlConfig = (transport === 'http' || transport === 'sse') ? config as MCPServerHttpConfig | MCPServerSseConfig : null;
  const [url, setUrl] = useState(urlConfig?.url || '');
  const [headerPairs, setHeaderPairs] = useState<Array<[string, string]>>(
    urlConfig?.headers ? Object.entries(urlConfig.headers) : []
  );

  const commitStdio = () => {
    const c: MCPServerStdioConfig = {
      command,
      args: args.trim() ? args.split(/\s+/) : [],
      env: envPairs.length > 0 ? Object.fromEntries(envPairs.filter(([k]) => k)) : undefined,
    };
    onChange(serverName, c);
  };

  const commitUrl = (t: 'http' | 'sse') => {
    const c = {
      type: t,
      url,
      headers: headerPairs.length > 0 ? Object.fromEntries(headerPairs.filter(([k]) => k)) : undefined,
    } as MCPServerHttpConfig | MCPServerSseConfig;
    onChange(serverName, c);
  };

  const switchTransport = (newTransport: 'stdio' | 'http' | 'sse') => {
    if (newTransport === 'stdio') {
      onChange(serverName, { command: '', args: [] } as MCPServerStdioConfig);
      setCommand(''); setArgs(''); setEnvPairs([]);
    } else {
      const c = { type: newTransport, url: '' } as MCPServerConfig;
      onChange(serverName, c);
      setUrl(''); setHeaderPairs([]);
    }
  };

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-2">
        <input
          type="text" value={serverName}
          onChange={e => setServerName(e.target.value)}
          onBlur={() => { if (transport === 'stdio') commitStdio(); else commitUrl(transport as 'http' | 'sse'); }}
          placeholder="server-name"
          className="text-xs font-medium px-2 py-1 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none flex-1"
        />
        <select
          value={transport}
          onChange={e => switchTransport(e.target.value as 'stdio' | 'http' | 'sse')}
          className={selectClass}
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
        <button onClick={onRemove} className={removeBtnClass}>
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {transport === 'stdio' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Command</label>
              <input type="text" value={command} onChange={e => setCommand(e.target.value)} onBlur={commitStdio} placeholder="npx" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Args (space-separated)</label>
              <input type="text" value={args} onChange={e => setArgs(e.target.value)} onBlur={commitStdio} placeholder="-y @modelcontextprotocol/server-filesystem /home" className={inputClass} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-[hsl(var(--text-muted))]">Environment</label>
              <button onClick={() => setEnvPairs([...envPairs, ['', '']])} className="text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]">+ Add</button>
            </div>
            {envPairs.map(([key, value], i) => (
              <div key={i} className="flex items-center gap-1 mb-1">
                <input type="text" value={key} onChange={e => { const c = [...envPairs] as [string, string][]; c[i] = [e.target.value, value]; setEnvPairs(c); }} onBlur={commitStdio} placeholder="KEY" className="w-1/3 px-1.5 py-0.5 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none" />
                <span className="text-[10px] text-[hsl(var(--text-muted))]">=</span>
                <input type="text" value={value} onChange={e => { const c = [...envPairs] as [string, string][]; c[i] = [key, e.target.value]; setEnvPairs(c); }} onBlur={commitStdio} placeholder="value" className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none" />
                <button onClick={() => { setEnvPairs(envPairs.filter((_, j) => j !== i)); setTimeout(commitStdio, 0); }} className={removeBtnClass}><X className="h-2.5 w-2.5" /></button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={labelClass}>URL</label>
            <input type="text" value={url} onChange={e => setUrl(e.target.value)} onBlur={() => commitUrl(transport as 'http' | 'sse')} placeholder="https://example.com/mcp" className={inputClass} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-[hsl(var(--text-muted))]">Headers</label>
              <button onClick={() => setHeaderPairs([...headerPairs, ['', '']])} className="text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]">+ Add</button>
            </div>
            {headerPairs.map(([key, value], i) => (
              <div key={i} className="flex items-center gap-1 mb-1">
                <input type="text" value={key} onChange={e => { const c = [...headerPairs] as [string, string][]; c[i] = [e.target.value, value]; setHeaderPairs(c); }} onBlur={() => commitUrl(transport as 'http' | 'sse')} placeholder="Header-Name" className="w-1/3 px-1.5 py-0.5 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none" />
                <span className="text-[10px] text-[hsl(var(--text-muted))]">:</span>
                <input type="text" value={value} onChange={e => { const c = [...headerPairs] as [string, string][]; c[i] = [key, e.target.value]; setHeaderPairs(c); }} onBlur={() => commitUrl(transport as 'http' | 'sse')} placeholder="value" className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none" />
                <button onClick={() => { const c = headerPairs.filter((_, j) => j !== i); setHeaderPairs(c); setTimeout(() => commitUrl(transport as 'http' | 'sse'), 0); }} className={removeBtnClass}><X className="h-2.5 w-2.5" /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Instructions Tab ───────────────────────────────────────────

function InstructionsTab({ claudeMd, setClaudeMd }: { claudeMd: string; setClaudeMd: (v: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-[hsl(var(--text-muted))]">CLAUDE.md content — markdown instructions injected into ~/.claude/CLAUDE.md.</p>
      <textarea
        value={claudeMd}
        onChange={e => setClaudeMd(e.target.value)}
        placeholder={"# Agent Instructions\n\nWrite markdown instructions for the Claude agent..."}
        rows={20}
        className={`${monoInputClass} resize-y`}
      />
    </div>
  );
}

// ─── Skills Tab ─────────────────────────────────────────────────

function SkillsTab({ skills, setSkills }: { skills: SkillConfig[]; setSkills: (v: SkillConfig[]) => void }) {
  const addSkill = () => setSkills([...skills, { name: '', content: '', frontmatter: {} }]);
  const removeSkill = (i: number) => setSkills(skills.filter((_, j) => j !== i));

  const updateSkill = (i: number, updates: Partial<SkillConfig>) => {
    const copy = [...skills];
    copy[i] = { ...copy[i], ...updates };
    setSkills(copy);
  };

  const updateFrontmatter = (i: number, key: keyof SkillFrontmatter, value: unknown) => {
    const copy = [...skills];
    const fm = { ...(copy[i].frontmatter || {}) };
    if (value === '' || value === undefined || value === false) {
      delete (fm as Record<string, unknown>)[key];
    } else {
      (fm as Record<string, unknown>)[key] = value;
    }
    copy[i] = { ...copy[i], frontmatter: Object.keys(fm).length > 0 ? fm : undefined };
    setSkills(copy);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[hsl(var(--text-muted))]">Custom slash commands. Each skill creates a /skill-name command in Claude Code.</p>
        <button onClick={addSkill} className={addBtnClass}><Plus className="h-3 w-3" /> Add Skill</button>
      </div>
      {skills.length === 0 ? (
        <div className={emptyClass}>No skills configured. Skills become custom slash commands.</div>
      ) : (
        <div className="space-y-4">
          {skills.map((skill, i) => (
            <div key={i} className={cardClass}>
              <div className="flex items-center justify-between">
                <input
                  type="text" value={skill.name}
                  onChange={e => updateSkill(i, { name: e.target.value })}
                  placeholder="skill-name (becomes /skill-name)"
                  className="text-xs font-medium px-2 py-1 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none flex-1 mr-2"
                />
                <button onClick={() => removeSkill(i)} className={removeBtnClass}><Trash2 className="h-3 w-3" /></button>
              </div>

              {/* Frontmatter fields */}
              <div className="border-t border-[hsl(var(--border))] pt-2 mt-2 space-y-2">
                <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider font-medium">Frontmatter</span>

                <div>
                  <label className={labelClass}>Description</label>
                  <input type="text" value={skill.frontmatter?.description || ''} onChange={e => updateFrontmatter(i, 'description', e.target.value)} placeholder="What this skill does" className={inputClass} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-[10px] text-[hsl(var(--text-secondary))] cursor-pointer">
                    <input type="checkbox" checked={skill.frontmatter?.['user-invocable'] || false} onChange={e => updateFrontmatter(i, 'user-invocable', e.target.checked)} className="accent-[hsl(var(--cyan))]" />
                    User invocable
                  </label>
                  <label className="flex items-center gap-2 text-[10px] text-[hsl(var(--text-secondary))] cursor-pointer">
                    <input type="checkbox" checked={skill.frontmatter?.['disable-model-invocation'] || false} onChange={e => updateFrontmatter(i, 'disable-model-invocation', e.target.checked)} className="accent-[hsl(var(--cyan))]" />
                    Disable model invocation
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Allowed Tools</label>
                    <input type="text" value={skill.frontmatter?.['allowed-tools'] || ''} onChange={e => updateFrontmatter(i, 'allowed-tools', e.target.value)} placeholder="Bash,Read,Write" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Model</label>
                    <input type="text" value={skill.frontmatter?.model || ''} onChange={e => updateFrontmatter(i, 'model', e.target.value)} placeholder="sonnet" className={inputClass} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelClass}>Context</label>
                    <input type="text" value={skill.frontmatter?.context || ''} onChange={e => updateFrontmatter(i, 'context', e.target.value)} placeholder="fork" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Agent</label>
                    <input type="text" value={skill.frontmatter?.agent || ''} onChange={e => updateFrontmatter(i, 'agent', e.target.value)} placeholder="agent name" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Argument Hint</label>
                    <input type="text" value={skill.frontmatter?.['argument-hint'] || ''} onChange={e => updateFrontmatter(i, 'argument-hint', e.target.value)} placeholder="<file>" className={inputClass} />
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="border-t border-[hsl(var(--border))] pt-2 mt-2">
                <label className={labelClass}>Instructions</label>
                <textarea
                  value={skill.content}
                  onChange={e => updateSkill(i, { content: e.target.value })}
                  placeholder="Markdown instructions for the skill..."
                  rows={6}
                  className={`${monoInputClass} resize-y`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Subagents Tab ──────────────────────────────────────────────

function SubagentsTab({ subagents, setSubagents }: { subagents: SubagentConfig[]; setSubagents: (v: SubagentConfig[]) => void }) {
  const addSubagent = () => setSubagents([...subagents, { name: '', description: '', systemPrompt: '' }]);
  const removeSubagent = (i: number) => setSubagents(subagents.filter((_, j) => j !== i));

  const update = (i: number, updates: Partial<SubagentConfig>) => {
    const copy = [...subagents];
    copy[i] = { ...copy[i], ...updates };
    setSubagents(copy);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[hsl(var(--text-muted))]">Define subagents — autonomous agents with their own tools, permissions, and system prompts.</p>
        <button onClick={addSubagent} className={addBtnClass}><Plus className="h-3 w-3" /> Add Subagent</button>
      </div>
      {subagents.length === 0 ? (
        <div className={emptyClass}>No subagents configured. Subagents are injected as ~/.claude/agents/&lt;name&gt;.md files.</div>
      ) : (
        <div className="space-y-4">
          {subagents.map((agent, i) => (
            <div key={i} className={cardClass}>
              <div className="flex items-center justify-between">
                <input type="text" value={agent.name} onChange={e => update(i, { name: e.target.value })} placeholder="agent-name" className="text-xs font-medium px-2 py-1 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none flex-1 mr-2" />
                <button onClick={() => removeSubagent(i)} className={removeBtnClass}><Trash2 className="h-3 w-3" /></button>
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <input type="text" value={agent.description} onChange={e => update(i, { description: e.target.value })} placeholder="What this agent does" className={inputClass} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Model</label>
                  <select value={agent.model || ''} onChange={e => update(i, { model: e.target.value || undefined })} className={`w-full ${selectClass}`}>
                    <option value="">Inherit</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="opus">Opus</option>
                    <option value="haiku">Haiku</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Permission Mode</label>
                  <select value={agent.permissionMode || 'default'} onChange={e => update(i, { permissionMode: e.target.value as SubagentPermissionMode })} className={`w-full ${selectClass}`}>
                    {PERMISSION_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelClass}>Tools (comma-separated)</label>
                  <input type="text" value={(agent.tools || []).join(', ')} onChange={e => update(i, { tools: e.target.value ? e.target.value.split(/,\s*/) : undefined })} placeholder="Bash, Read, Write" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Disallowed Tools</label>
                  <input type="text" value={(agent.disallowedTools || []).join(', ')} onChange={e => update(i, { disallowedTools: e.target.value ? e.target.value.split(/,\s*/) : undefined })} placeholder="Bash" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Skills (comma-separated)</label>
                  <input type="text" value={(agent.skills || []).join(', ')} onChange={e => update(i, { skills: e.target.value ? e.target.value.split(/,\s*/) : undefined })} placeholder="skill-1, skill-2" className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>System Prompt</label>
                <textarea value={agent.systemPrompt} onChange={e => update(i, { systemPrompt: e.target.value })} placeholder="System prompt for the subagent..." rows={6} className={`${monoInputClass} resize-y`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rules Tab ──────────────────────────────────────────────────

function RulesTab({ rules, setRules }: { rules: RuleConfig[]; setRules: (v: RuleConfig[]) => void }) {
  const addRule = () => setRules([...rules, { filename: '', content: '' }]);
  const removeRule = (i: number) => setRules(rules.filter((_, j) => j !== i));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[hsl(var(--text-muted))]">Modular rules files injected into ~/.claude/rules/.</p>
        <button onClick={addRule} className={addBtnClass}><Plus className="h-3 w-3" /> Add Rule</button>
      </div>
      {rules.length === 0 ? (
        <div className={emptyClass}>No rules configured. Rules are modular instruction files.</div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, i) => (
            <div key={i} className={cardClass}>
              <div className="flex items-center justify-between">
                <input type="text" value={rule.filename} onChange={e => { const c = [...rules]; c[i] = { ...c[i], filename: e.target.value }; setRules(c); }} placeholder="api-conventions.md" className="text-xs font-medium px-2 py-1 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none flex-1 mr-2" />
                <button onClick={() => removeRule(i)} className={removeBtnClass}><Trash2 className="h-3 w-3" /></button>
              </div>
              <textarea value={rule.content} onChange={e => { const c = [...rules]; c[i] = { ...c[i], content: e.target.value }; setRules(c); }} placeholder="# Rule content in markdown..." rows={6} className={`${monoInputClass} resize-y`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Hooks Tab ──────────────────────────────────────────────────

function HooksTab({ hooks, setHooks }: { hooks: Partial<Record<HookEvent, HookMatcher[]>>; setHooks: (v: Partial<Record<HookEvent, HookMatcher[]>>) => void }) {
  const addHook = () => {
    const event: HookEvent = 'PreToolUse';
    const current = hooks[event] || [];
    setHooks({ ...hooks, [event]: [...current, { hooks: [{ type: 'command' as const, command: '' }] }] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[hsl(var(--text-muted))]">Hook shell commands into Claude Code lifecycle events.</p>
        <button onClick={addHook} className={addBtnClass}><Plus className="h-3 w-3" /> Add Hook</button>
      </div>
      {Object.keys(hooks).length === 0 ? (
        <div className={emptyClass}>No hooks configured. Hooks run shell commands on events.</div>
      ) : (
        <div className="space-y-3">
          {(Object.entries(hooks) as [HookEvent, HookMatcher[]][]).map(([event, matchers]) =>
            matchers.map((matcher, mi) => (
              <div key={`${event}-${mi}`} className={cardClass}>
                <div className="flex items-center justify-between gap-2">
                  <select
                    value={event}
                    onChange={e => {
                      const newEvent = e.target.value as HookEvent;
                      const copy = { ...hooks };
                      const arr = [...(copy[event] || [])];
                      arr.splice(mi, 1);
                      if (arr.length === 0) delete copy[event]; else copy[event] = arr;
                      copy[newEvent] = [...(copy[newEvent] || []), matcher];
                      setHooks(copy);
                    }}
                    className={selectClass}
                  >
                    {ALL_HOOK_EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                  </select>
                  <button onClick={() => {
                    const copy = { ...hooks };
                    const arr = [...(copy[event] || [])];
                    arr.splice(mi, 1);
                    if (arr.length === 0) delete copy[event]; else copy[event] = arr;
                    setHooks(copy);
                  }} className={removeBtnClass}><Trash2 className="h-3 w-3" /></button>
                </div>
                <div>
                  <label className={labelClass}>Matcher (optional regex)</label>
                  <input type="text" value={matcher.matcher || ''} onChange={e => {
                    const copy = { ...hooks };
                    const arr = [...(copy[event] || [])];
                    arr[mi] = { ...arr[mi], matcher: e.target.value || undefined };
                    copy[event] = arr;
                    setHooks(copy);
                  }} placeholder="e.g. Write|Edit" className={monoInputClass} />
                </div>
                {matcher.hooks.map((hook, hi) => (
                  <div key={hi} className="flex items-center gap-2">
                    <input type="text" value={hook.command} onChange={e => {
                      const copy = { ...hooks };
                      const arr = [...(copy[event] || [])];
                      const hks = [...arr[mi].hooks];
                      hks[hi] = { ...hks[hi], command: e.target.value };
                      arr[mi] = { ...arr[mi], hooks: hks };
                      copy[event] = arr;
                      setHooks(copy);
                    }} placeholder="shell command" className={`flex-1 ${monoInputClass}`} />
                    <input type="number" value={hook.timeout || ''} onChange={e => {
                      const copy = { ...hooks };
                      const arr = [...(copy[event] || [])];
                      const hks = [...arr[mi].hooks];
                      hks[hi] = { ...hks[hi], timeout: e.target.value ? parseInt(e.target.value) : undefined };
                      arr[mi] = { ...arr[mi], hooks: hks };
                      copy[event] = arr;
                      setHooks(copy);
                    }} placeholder="timeout" className="w-20 px-2 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none" />
                    {matcher.hooks.length > 1 && (
                      <button onClick={() => {
                        const copy = { ...hooks };
                        const arr = [...(copy[event] || [])];
                        const hks = [...arr[mi].hooks];
                        hks.splice(hi, 1);
                        arr[mi] = { ...arr[mi], hooks: hks };
                        copy[event] = arr;
                        setHooks(copy);
                      }} className={removeBtnClass}><X className="h-2.5 w-2.5" /></button>
                    )}
                  </div>
                ))}
                <button onClick={() => {
                  const copy = { ...hooks };
                  const arr = [...(copy[event] || [])];
                  arr[mi] = { ...arr[mi], hooks: [...arr[mi].hooks, { type: 'command' as const, command: '' }] };
                  copy[event] = arr;
                  setHooks(copy);
                }} className="text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]">+ Add command</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Permissions Tab ────────────────────────────────────────────

function PermissionsTab({ permissions, setPermissions }: { permissions: AgentPermissions; setPermissions: (v: AgentPermissions) => void }) {
  const addPermission = (type: 'allow' | 'deny') => {
    const current = permissions[type] || [];
    setPermissions({ ...permissions, [type]: [...current, ''] });
  };
  const updatePermission = (type: 'allow' | 'deny', index: number, value: string) => {
    const current = [...(permissions[type] || [])];
    current[index] = value;
    setPermissions({ ...permissions, [type]: current });
  };
  const removePermission = (type: 'allow' | 'deny', index: number) => {
    const current = [...(permissions[type] || [])];
    current.splice(index, 1);
    setPermissions({ ...permissions, [type]: current });
  };

  return (
    <div className="space-y-5">
      <p className="text-[10px] text-[hsl(var(--text-muted))]">Tool permission rules — controls which tools Claude can use without asking.</p>

      {/* Allow */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-[hsl(var(--green))] uppercase tracking-wider font-medium">Allow</label>
          <button onClick={() => addPermission('allow')} className={addBtnClass}><Plus className="h-3 w-3" /> Add</button>
        </div>
        {(permissions.allow || []).length === 0 ? (
          <div className="text-[10px] text-[hsl(var(--text-muted))]">No allow rules.</div>
        ) : (
          <div className="space-y-1">
            {(permissions.allow || []).map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="text" value={rule} onChange={e => updatePermission('allow', i, e.target.value)} placeholder='e.g. Bash(npm:*)' className={`flex-1 ${monoInputClass}`} />
                <button onClick={() => removePermission('allow', i)} className={removeBtnClass}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deny */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-[hsl(var(--red))] uppercase tracking-wider font-medium">Deny</label>
          <button onClick={() => addPermission('deny')} className={addBtnClass}><Plus className="h-3 w-3" /> Add</button>
        </div>
        {(permissions.deny || []).length === 0 ? (
          <div className="text-[10px] text-[hsl(var(--text-muted))]">No deny rules.</div>
        ) : (
          <div className="space-y-1">
            {(permissions.deny || []).map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="text" value={rule} onChange={e => updatePermission('deny', i, e.target.value)} placeholder='e.g. Bash(rm:*)' className={`flex-1 ${monoInputClass}`} />
                <button onClick={() => removePermission('deny', i)} className={removeBtnClass}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
