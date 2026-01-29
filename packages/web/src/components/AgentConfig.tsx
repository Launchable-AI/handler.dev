import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Loader2, X, Play, ChevronDown } from 'lucide-react';
import { useAgentConfigs, useCreateAgentConfig, useUpdateAgentConfig, useDeleteAgentConfig, useInjectAgentConfig } from '../hooks/useAgentConfigs';
import { useSandboxes } from '../hooks/useSandboxes';
import type { MCPServerConfig, AgentPermissions } from '../api/client';

export function AgentConfig() {
  const { data, isLoading } = useAgentConfigs();
  const { data: sandboxData } = useSandboxes();
  const createMutation = useCreateAgentConfig();
  const updateMutation = useUpdateAgentConfig();
  const deleteMutation = useDeleteAgentConfig();
  const injectMutation = useInjectAgentConfig();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInjectDropdown, setShowInjectDropdown] = useState(false);

  // Editor state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMcpServers, setEditMcpServers] = useState<Record<string, MCPServerConfig>>({});
  const [editClaudeMd, setEditClaudeMd] = useState('');
  const [editPermissions, setEditPermissions] = useState<AgentPermissions>({});
  const [isDirty, setIsDirty] = useState(false);

  const configs = data?.configs || [];
  const selected = configs.find(c => c.id === selectedId) || null;
  const runningSandboxes = sandboxData?.sandboxes.filter(s => s.status === 'running') || [];

  // Load selected preset into editor
  useEffect(() => {
    if (selected) {
      setEditName(selected.name);
      setEditDescription(selected.description || '');
      setEditMcpServers(JSON.parse(JSON.stringify(selected.mcpServers)));
      setEditClaudeMd(selected.claudeMd);
      setEditPermissions(JSON.parse(JSON.stringify(selected.permissions)));
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
      });
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to save preset:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      if (selectedId === id) {
        setSelectedId(null);
      }
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

  // MCP Server helpers
  const addMcpServer = () => {
    const name = `server-${Date.now()}`;
    setEditMcpServers({ ...editMcpServers, [name]: { command: '', args: [] } });
    markDirty();
  };

  const removeMcpServer = (name: string) => {
    const copy = { ...editMcpServers };
    delete copy[name];
    setEditMcpServers(copy);
    markDirty();
  };

  const updateMcpServer = (oldName: string, newName: string, config: MCPServerConfig) => {
    const copy = { ...editMcpServers };
    if (oldName !== newName) {
      delete copy[oldName];
    }
    copy[newName] = config;
    setEditMcpServers(copy);
    markDirty();
  };

  // Permission helpers
  const addPermission = (type: 'allow' | 'deny') => {
    const current = editPermissions[type] || [];
    setEditPermissions({ ...editPermissions, [type]: [...current, ''] });
    markDirty();
  };

  const updatePermission = (type: 'allow' | 'deny', index: number, value: string) => {
    const current = [...(editPermissions[type] || [])];
    current[index] = value;
    setEditPermissions({ ...editPermissions, [type]: current });
    markDirty();
  };

  const removePermission = (type: 'allow' | 'deny', index: number) => {
    const current = [...(editPermissions[type] || [])];
    current.splice(index, 1);
    setEditPermissions({ ...editPermissions, [type]: current });
    markDirty();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel: list */}
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
                {/* Inject dropdown */}
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

            {/* Editor content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Inject result message */}
              {injectMutation.isSuccess && (
                <div className="p-2 text-xs bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] text-[hsl(var(--green))]">
                  Config injected successfully ({(injectMutation.data as { filesInjected: number }).filesInjected} files)
                </div>
              )}
              {injectMutation.isError && (
                <div className="p-2 text-xs bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] text-[hsl(var(--red))]">
                  {injectMutation.error.message}
                </div>
              )}

              {/* Name & Description */}
              <section>
                <h3 className="text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-2">Details</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => { setEditName(e.target.value); markDirty(); }}
                      className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Description</label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => { setEditDescription(e.target.value); markDirty(); }}
                      placeholder="Optional description"
                      className="w-full px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)]"
                    />
                  </div>
                </div>
              </section>

              {/* MCP Servers */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider">MCP Servers</h3>
                  <button onClick={addMcpServer} className="flex items-center gap-1 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]">
                    <Plus className="h-3 w-3" /> Add Server
                  </button>
                </div>
                {Object.keys(editMcpServers).length === 0 ? (
                  <div className="p-3 text-xs text-[hsl(var(--text-muted))] border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
                    No MCP servers configured.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(editMcpServers).map(([name, config]) => (
                      <MCPServerEditor
                        key={name}
                        name={name}
                        config={config}
                        onChange={(newName, newConfig) => updateMcpServer(name, newName, newConfig)}
                        onRemove={() => removeMcpServer(name)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* CLAUDE.md */}
              <section>
                <h3 className="text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-2">CLAUDE.md</h3>
                <textarea
                  value={editClaudeMd}
                  onChange={(e) => { setEditClaudeMd(e.target.value); markDirty(); }}
                  placeholder="# Agent Instructions&#10;&#10;Write markdown instructions for the Claude agent..."
                  rows={10}
                  className="w-full px-3 py-2 text-sm font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cyan-dim)/0.3)] resize-y"
                />
              </section>

              {/* Permissions */}
              <section>
                <h3 className="text-xs font-medium text-[hsl(var(--text-secondary))] uppercase tracking-wider mb-2">Permissions</h3>
                <div className="space-y-4">
                  {/* Allow */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-[hsl(var(--green))] uppercase tracking-wider font-medium">Allow</label>
                      <button onClick={() => addPermission('allow')} className="flex items-center gap-1 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]">
                        <Plus className="h-3 w-3" /> Add
                      </button>
                    </div>
                    {(editPermissions.allow || []).length === 0 ? (
                      <div className="text-[10px] text-[hsl(var(--text-muted))]">No allow rules.</div>
                    ) : (
                      <div className="space-y-1">
                        {(editPermissions.allow || []).map((rule, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={rule}
                              onChange={(e) => updatePermission('allow', i, e.target.value)}
                              placeholder='e.g. Bash(npm:*)'
                              className="flex-1 px-2 py-1 text-xs font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                            />
                            <button onClick={() => removePermission('allow', i)} className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Deny */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-[hsl(var(--red))] uppercase tracking-wider font-medium">Deny</label>
                      <button onClick={() => addPermission('deny')} className="flex items-center gap-1 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]">
                        <Plus className="h-3 w-3" /> Add
                      </button>
                    </div>
                    {(editPermissions.deny || []).length === 0 ? (
                      <div className="text-[10px] text-[hsl(var(--text-muted))]">No deny rules.</div>
                    ) : (
                      <div className="space-y-1">
                        {(editPermissions.deny || []).map((rule, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={rule}
                              onChange={(e) => updatePermission('deny', i, e.target.value)}
                              placeholder='e.g. Bash(rm:*)'
                              className="flex-1 px-2 py-1 text-xs font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
                            />
                            <button onClick={() => removePermission('deny', i)} className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Sub-component for editing a single MCP server
function MCPServerEditor({
  name,
  config,
  onChange,
  onRemove,
}: {
  name: string;
  config: MCPServerConfig;
  onChange: (newName: string, config: MCPServerConfig) => void;
  onRemove: () => void;
}) {
  const [serverName, setServerName] = useState(name);
  const [command, setCommand] = useState(config.command);
  const [args, setArgs] = useState(config.args.join(' '));
  const [envPairs, setEnvPairs] = useState<Array<[string, string]>>(
    Object.entries(config.env || {})
  );

  const commit = () => {
    onChange(serverName, {
      command,
      args: args.trim() ? args.split(/\s+/) : [],
      env: envPairs.length > 0 ? Object.fromEntries(envPairs.filter(([k]) => k)) : undefined,
    });
  };

  return (
    <div className="border border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <input
          type="text"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          onBlur={commit}
          placeholder="server-name"
          className="text-xs font-medium px-2 py-1 bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
        />
        <button onClick={onRemove} className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-[hsl(var(--text-muted))] mb-0.5">Command</label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onBlur={commit}
            placeholder="npx"
            className="w-full px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] text-[hsl(var(--text-muted))] mb-0.5">Args (space-separated)</label>
          <input
            type="text"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            onBlur={commit}
            placeholder="-y @modelcontextprotocol/server-filesystem /home"
            className="w-full px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
          />
        </div>
      </div>
      {/* Env vars */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-[hsl(var(--text-muted))]">Environment</label>
          <button
            onClick={() => { setEnvPairs([...envPairs, ['', '']]); }}
            className="text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan-dim))]"
          >
            + Add
          </button>
        </div>
        {envPairs.map(([key, value], i) => (
          <div key={i} className="flex items-center gap-1 mb-1">
            <input
              type="text"
              value={key}
              onChange={(e) => {
                const copy = [...envPairs] as Array<[string, string]>;
                copy[i] = [e.target.value, value];
                setEnvPairs(copy);
              }}
              onBlur={commit}
              placeholder="KEY"
              className="w-1/3 px-1.5 py-0.5 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none"
            />
            <span className="text-[10px] text-[hsl(var(--text-muted))]">=</span>
            <input
              type="text"
              value={value}
              onChange={(e) => {
                const copy = [...envPairs] as Array<[string, string]>;
                copy[i] = [key, e.target.value];
                setEnvPairs(copy);
              }}
              onBlur={commit}
              placeholder="value"
              className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none"
            />
            <button
              onClick={() => {
                setEnvPairs(envPairs.filter((_, j) => j !== i));
                setTimeout(commit, 0);
              }}
              className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
