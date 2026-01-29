import { useState, useEffect } from 'react';
import { X, Loader2, Rocket, Plus, Trash2, Check, AlertCircle } from 'lucide-react';
import * as api from '../../api/client';
import type { MCPDeployment, MCPDeploymentStatus } from '../../api/client';
import { ConnectionInfo } from './ConnectionInfo';

interface DeployModalProps {
  serverName: string;
  serverTitle: string;
  onClose: () => void;
  onDeployed?: () => void;
}

type DeployPhase = 'configure' | 'deploying' | 'done' | 'error';

export function DeployModal({ serverName, serverTitle, onClose, onDeployed }: DeployModalProps) {
  const [phase, setPhase] = useState<DeployPhase>('configure');
  const [backend, setBackend] = useState<string>('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [availableBackends, setAvailableBackends] = useState<Array<{ name: string; available: boolean }>>([]);
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const [deployment, setDeployment] = useState<MCPDeployment | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Load available backends
    api.fetchAPI<{ backends: Record<string, boolean> }>('/sandboxes/backends').then((result) => {
      const backends = Object.entries(result.backends)
        .map(([name, available]) => ({ name, available }))
        .filter(b => b.available);
      setAvailableBackends(backends);
      if (backends.length > 0) {
        setBackend(backends[0].name);
      }
    }).catch(() => {
      setAvailableBackends([]);
    });
  }, []);

  const handleDeploy = async () => {
    if (!backend) return;

    setPhase('deploying');
    setProgressMessages([]);

    const env: Record<string, string> = {};
    for (const { key, value } of envVars) {
      if (key.trim()) env[key.trim()] = value;
    }

    try {
      await api.deployMCPServer(
        serverName,
        backend,
        Object.keys(env).length > 0 ? env : undefined,
        (event) => {
          setProgressMessages(prev => [...prev, event.message]);
        },
        (result) => {
          setDeployment(result);
          setPhase('done');
          onDeployed?.();
        },
        (error) => {
          setErrorMessage(error);
          setPhase('error');
        }
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Deploy failed');
      setPhase('error');
    }
  };

  const addEnvVar = () => {
    setEnvVars(prev => [...prev, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(prev => prev.filter((_, i) => i !== index));
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', val: string) => {
    setEnvVars(prev => prev.map((item, i) => i === index ? { ...item, [field]: val } : item));
  };

  const statusIcon = (status: MCPDeploymentStatus) => {
    switch (status) {
      case 'running': return <Check className="h-4 w-4 text-[hsl(var(--green))]" />;
      case 'error': return <AlertCircle className="h-4 w-4 text-[hsl(var(--red))]" />;
      default: return <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--cyan))]" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-[520px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-[hsl(var(--cyan))]" />
            <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Deploy {serverTitle}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {phase === 'configure' && (
            <>
              {/* Backend Selection */}
              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                  Backend
                </label>
                {availableBackends.length === 0 ? (
                  <p className="text-xs text-[hsl(var(--text-muted))]">No backends available. Enable a backend in Settings.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {availableBackends.map(b => (
                      <button
                        key={b.name}
                        onClick={() => setBackend(b.name)}
                        className={`px-3 py-2 text-xs text-left border transition-colors ${
                          backend === b.name
                            ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] text-[hsl(var(--cyan))]'
                            : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--text-muted))]'
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Environment Variables */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                    Environment Variables
                  </label>
                  <button
                    onClick={addEnvVar}
                    className="flex items-center gap-1 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan)/0.8)]"
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </button>
                </div>
                {envVars.length === 0 && (
                  <p className="text-[10px] text-[hsl(var(--text-muted))]">No environment variables configured.</p>
                )}
                {envVars.map((env, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={env.key}
                      onChange={(e) => updateEnvVar(i, 'key', e.target.value)}
                      placeholder="KEY"
                      className="flex-1 px-2 py-1.5 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
                    />
                    <input
                      type="text"
                      value={env.value}
                      onChange={(e) => updateEnvVar(i, 'value', e.target.value)}
                      placeholder="value"
                      className="flex-1 px-2 py-1.5 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan))]"
                    />
                    <button
                      onClick={() => removeEnvVar(i)}
                      className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {phase === 'deploying' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--cyan))]" />
                <span className="text-xs text-[hsl(var(--text-primary))]">Deploying...</span>
              </div>
              <div className="space-y-1 max-h-60 overflow-auto">
                {progressMessages.map((msg, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] text-[hsl(var(--text-muted))]">
                    <span className="text-[hsl(var(--text-muted))] opacity-50 shrink-0">
                      {new Date().toLocaleTimeString()}
                    </span>
                    <span>{msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {phase === 'done' && deployment && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)]">
                {statusIcon(deployment.status)}
                <span className="text-xs text-[hsl(var(--green))]">
                  MCP server deployed successfully
                </span>
              </div>

              {deployment.connectionConfig && (
                <ConnectionInfo config={deployment.connectionConfig} transport={deployment.transport} />
              )}
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)]">
                <AlertCircle className="h-4 w-4 text-[hsl(var(--red))]" />
                <span className="text-xs text-[hsl(var(--red))]">
                  {errorMessage || 'Deployment failed'}
                </span>
              </div>
              {progressMessages.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-auto">
                  {progressMessages.map((msg, i) => (
                    <div key={i} className="text-[10px] text-[hsl(var(--text-muted))]">{msg}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          {phase === 'configure' && (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                Cancel
              </button>
              <button
                onClick={handleDeploy}
                disabled={!backend}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50"
              >
                <Rocket className="h-3 w-3" />
                Deploy
              </button>
            </>
          )}
          {(phase === 'done' || phase === 'error') && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)]"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
