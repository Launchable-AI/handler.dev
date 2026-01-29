import { useState } from 'react';
import {
  Loader2,
  Square,
  RotateCcw,
  Trash2,
  FileText,
  Copy,
  Check,
  Server,
  Monitor,
  Cloud,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useMCPDeployments } from '../../hooks/useMCPDeployments';
import { ConnectionInfo } from './ConnectionInfo';
import * as api from '../../api/client';
import type { MCPDeployment, MCPDeploymentStatus, MCPLocalServer } from '../../api/client';

type FilterStatus = 'all' | MCPDeploymentStatus;

const STATUS_COLORS: Record<MCPDeploymentStatus, string> = {
  provisioning: 'text-[hsl(var(--cyan))]',
  installing: 'text-[hsl(var(--cyan))]',
  starting: 'text-[hsl(var(--cyan))]',
  running: 'text-[hsl(var(--green))]',
  stopped: 'text-[hsl(var(--text-muted))]',
  error: 'text-[hsl(var(--red))]',
  unreachable: 'text-[hsl(var(--amber))]',
};

const STATUS_BG: Record<MCPDeploymentStatus, string> = {
  provisioning: 'bg-[hsl(var(--cyan))]',
  installing: 'bg-[hsl(var(--cyan))]',
  starting: 'bg-[hsl(var(--cyan))]',
  running: 'bg-[hsl(var(--green))]',
  stopped: 'bg-[hsl(var(--text-muted))]',
  error: 'bg-[hsl(var(--red))]',
  unreachable: 'bg-[hsl(var(--amber))]',
};

function StatusDot({ status }: { status: MCPDeploymentStatus }) {
  const isAnimated = ['provisioning', 'installing', 'starting'].includes(status);
  return (
    <div className={`w-2 h-2 rounded-full ${STATUS_BG[status]} ${isAnimated ? 'animate-pulse' : ''}`} />
  );
}

function formatUptime(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

export function MyMCPServers() {
  const { deployments, localServers, isLoading, error, stop, restart, remove } = useMCPDeployments();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logsId, setLogsId] = useState<string | null>(null);
  const [logs, setLogs] = useState<api.MCPDeploymentLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const filteredDeployments = filterStatus === 'all'
    ? deployments
    : deployments.filter(d => d.status === filterStatus);

  const handleAction = async (id: string, action: 'stop' | 'restart' | 'delete') => {
    setActionInProgress(id);
    try {
      if (action === 'stop') await stop(id);
      else if (action === 'restart') await restart(id);
      else if (action === 'delete') await remove(id);
    } catch (err) {
      console.error(`Failed to ${action} deployment:`, err);
    }
    setActionInProgress(null);
  };

  const handleViewLogs = async (id: string) => {
    if (logsId === id) {
      setLogsId(null);
      return;
    }
    setLogsId(id);
    setIsLoadingLogs(true);
    try {
      const result = await api.getMCPDeploymentLogs(id);
      setLogs(result.logs);
    } catch {
      setLogs([]);
    }
    setIsLoadingLogs(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  const hasContent = deployments.length > 0 || localServers.length > 0;

  if (!hasContent) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Server className="h-10 w-10 mx-auto mb-3 text-[hsl(var(--text-muted))] opacity-30" />
          <p className="text-xs text-[hsl(var(--text-muted))]">
            No MCP servers deployed yet.
          </p>
          <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
            Go to the Registry tab and deploy a server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Filter:</span>
        {(['all', 'running', 'stopped', 'error', 'unreachable'] as FilterStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-2 py-1 text-[10px] transition-colors ${
              filterStatus === s
                ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]'
                : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
            }`}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-[hsl(var(--text-muted))]">
          {filteredDeployments.length} deployed, {localServers.length} local
        </span>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-[hsl(var(--red))] bg-[hsl(var(--red)/0.1)] border-b border-[hsl(var(--red)/0.3)]">
          {error}
        </div>
      )}

      {/* Server List */}
      <div className="flex-1 overflow-auto">
        {/* Deployed Servers */}
        {filteredDeployments.length > 0 && (
          <div>
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-base))] border-b border-[hsl(var(--border))] flex items-center gap-1.5">
              <Cloud className="h-3 w-3" />
              Deployed Servers
            </div>
            <div className="divide-y divide-[hsl(var(--border))]">
              {filteredDeployments.map(deployment => (
                <DeploymentCard
                  key={deployment.id}
                  deployment={deployment}
                  isExpanded={expandedId === deployment.id}
                  onToggleExpand={() => setExpandedId(expandedId === deployment.id ? null : deployment.id)}
                  onAction={handleAction}
                  onViewLogs={handleViewLogs}
                  actionInProgress={actionInProgress === deployment.id}
                  showLogs={logsId === deployment.id}
                  logs={logs}
                  isLoadingLogs={isLoadingLogs}
                />
              ))}
            </div>
          </div>
        )}

        {/* Local Servers */}
        {localServers.length > 0 && (
          <div>
            <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-base))] border-b border-[hsl(var(--border))] flex items-center gap-1.5">
              <Monitor className="h-3 w-3" />
              Local Servers
            </div>
            <div className="divide-y divide-[hsl(var(--border))]">
              {localServers.map(server => (
                <LocalServerCard key={server.name} server={server} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeploymentCard({
  deployment,
  isExpanded,
  onToggleExpand,
  onAction,
  onViewLogs,
  actionInProgress,
  showLogs,
  logs,
  isLoadingLogs,
}: {
  deployment: MCPDeployment;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAction: (id: string, action: 'stop' | 'restart' | 'delete') => void;
  onViewLogs: (id: string) => void;
  actionInProgress: boolean;
  showLogs: boolean;
  logs: api.MCPDeploymentLogEntry[];
  isLoadingLogs: boolean;
}) {
  return (
    <div className="bg-[hsl(var(--bg-surface))]">
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--bg-elevated))] cursor-pointer transition-colors"
        onClick={onToggleExpand}
      >
        <StatusDot status={deployment.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
              {deployment.serverTitle}
            </span>
            <span className={`text-[9px] uppercase ${STATUS_COLORS[deployment.status]}`}>
              {deployment.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-[hsl(var(--text-muted))] font-mono truncate">
              {deployment.serverName}
            </span>
            <span className="px-1.5 py-0.5 text-[8px] uppercase bg-[hsl(var(--bg-base))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]">
              {deployment.backend}
            </span>
            <span className="px-1.5 py-0.5 text-[8px] uppercase bg-[hsl(var(--bg-base))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]">
              {deployment.transport}
            </span>
            {deployment.startedAt && deployment.status === 'running' && (
              <span className="text-[10px] text-[hsl(var(--text-muted))]">
                up {formatUptime(deployment.startedAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {actionInProgress ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--text-muted))]" />
          ) : (
            <>
              {deployment.status === 'running' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onAction(deployment.id, 'stop'); }}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))]"
                  title="Stop"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              )}
              {(deployment.status === 'stopped' || deployment.status === 'unreachable') && (
                <button
                  onClick={(e) => { e.stopPropagation(); onAction(deployment.id, 'restart'); }}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
                  title="Restart"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onViewLogs(deployment.id); }}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                title="View Logs"
              >
                <FileText className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onAction(deployment.id, 'delete'); }}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-[hsl(var(--text-muted))]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[hsl(var(--text-muted))]" />
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-[hsl(var(--border))]">
          <div className="pt-3 grid grid-cols-2 gap-3 text-[10px]">
            <div>
              <span className="text-[hsl(var(--text-muted))] uppercase tracking-wider">Install Method</span>
              <p className="text-[hsl(var(--text-primary))] mt-0.5">{deployment.installMethod}</p>
            </div>
            <div>
              <span className="text-[hsl(var(--text-muted))] uppercase tracking-wider">Sandbox ID</span>
              <p className="text-[hsl(var(--text-primary))] font-mono mt-0.5 truncate">{deployment.sandboxId}</p>
            </div>
            {deployment.port && (
              <div>
                <span className="text-[hsl(var(--text-muted))] uppercase tracking-wider">Port</span>
                <p className="text-[hsl(var(--text-primary))] mt-0.5">{deployment.port}</p>
              </div>
            )}
            <div>
              <span className="text-[hsl(var(--text-muted))] uppercase tracking-wider">Created</span>
              <p className="text-[hsl(var(--text-primary))] mt-0.5">{new Date(deployment.createdAt).toLocaleString()}</p>
            </div>
          </div>

          {deployment.connectionConfig && (
            <ConnectionInfo config={deployment.connectionConfig} transport={deployment.transport} />
          )}
        </div>
      )}

      {/* Logs Panel */}
      {showLogs && (
        <div className="px-4 pb-3 border-t border-[hsl(var(--border))]">
          <div className="pt-2 flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Deploy Logs</span>
          </div>
          {isLoadingLogs ? (
            <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--text-muted))]" />
          ) : logs.length === 0 ? (
            <p className="text-[10px] text-[hsl(var(--text-muted))]">No logs available</p>
          ) : (
            <div className="max-h-40 overflow-auto space-y-0.5 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2 text-[10px] font-mono">
                  <span className="text-[hsl(var(--text-muted))] shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={
                    log.level === 'error' ? 'text-[hsl(var(--red))]' :
                    log.level === 'warn' ? 'text-[hsl(var(--amber))]' :
                    'text-[hsl(var(--text-secondary))]'
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LocalServerCard({ server }: { server: MCPLocalServer }) {
  const [copied, setCopied] = useState(false);

  const config = {
    command: server.command,
    args: server.args,
    ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--bg-elevated))] transition-colors">
      <div className={`w-2 h-2 rounded-full ${
        server.status === 'running' ? 'bg-[hsl(var(--green))]' :
        server.status === 'stopped' ? 'bg-[hsl(var(--text-muted))]' :
        'bg-[hsl(var(--amber))]'
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[hsl(var(--text-primary))]">{server.name}</span>
          <span className={`text-[9px] uppercase ${
            server.status === 'running' ? 'text-[hsl(var(--green))]' :
            server.status === 'stopped' ? 'text-[hsl(var(--text-muted))]' :
            'text-[hsl(var(--amber))]'
          }`}>
            {server.status}
          </span>
        </div>
        <p className="text-[10px] text-[hsl(var(--text-muted))] font-mono truncate mt-0.5">
          {server.command} {server.args.join(' ')}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <span className="px-1.5 py-0.5 text-[8px] uppercase bg-[hsl(var(--bg-base))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]">
          local
        </span>
        <button
          onClick={handleCopy}
          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
          title="Copy connection config"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--green))]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
