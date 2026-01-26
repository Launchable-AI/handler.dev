/**
 * SandboxLogViewer - Log viewer wrapper for unified sandbox abstraction
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, RefreshCw, Trash2, Pause, Play, Download, Copy, Check } from 'lucide-react';
import * as api from '../../api/client';

interface SandboxLogViewerProps {
  sandboxId: string;
  sandboxName: string;
  backend: api.SandboxBackend;
  onClose: () => void;
}

export function SandboxLogViewer({ sandboxId, sandboxName, backend, onClose }: SandboxLogViewerProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(backend === 'docker');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  // Load initial logs and start streaming if supported
  useEffect(() => {
    let mounted = true;

    const loadLogs = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch initial logs
        const initialLogs = await api.getSandboxLogs(sandboxId, 500);
        if (!mounted) return;

        if (initialLogs) {
          setLogs(initialLogs.split('\n').filter(Boolean));
        }

        // Start streaming if supported and enabled (Docker only for now)
        if (isStreaming && backend === 'docker') {
          cleanupRef.current = await api.streamSandboxLogs(
            sandboxId,
            {
              onLog: (line) => {
                if (mounted) {
                  setLogs((prev) => [...prev.slice(-2000), line]);
                }
              },
              onError: (err) => {
                if (mounted) {
                  setLogs((prev) => [...prev, `[Stream Error: ${err}]`]);
                }
              },
              onDone: () => {
                if (mounted) {
                  setLogs((prev) => [...prev, '[Stream ended]']);
                }
              },
            },
            0
          );
        } else if (isStreaming && backend !== 'docker') {
          // For non-Docker backends, poll for updates
          const pollLogs = async () => {
            try {
              const result = await api.getSandboxLogs(sandboxId, 500);
              if (mounted && result) {
                setLogs(result.split('\n').filter(Boolean));
              }
            } catch (err) {
              if (mounted) {
                setError(err instanceof Error ? err.message : 'Failed to load logs');
              }
            }
          };

          pollIntervalRef.current = setInterval(pollLogs, 3000);
          cleanupRef.current = () => {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
          };
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load logs');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadLogs();

    return () => {
      mounted = false;
      cleanupRef.current?.();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [sandboxId, backend, isStreaming]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const handleRefresh = async () => {
    cleanupRef.current?.();
    setLogs([]);
    setIsStreaming(true);
  };

  const handleClear = () => {
    setLogs([]);
  };

  const handleToggleStreaming = () => {
    if (isStreaming) {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
    setIsStreaming(!isStreaming);
  };

  const handleDownload = () => {
    const content = logs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sandboxName.replace(/[^a-z0-9]/gi, '_')}_logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const content = logs.join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Logs: {sandboxName}
            </h2>
            {isStreaming && (
              <span className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--green))]">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--green))] animate-pulse" />
                {backend === 'docker' ? 'Live' : 'Polling'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggleStreaming}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title={isStreaming ? 'Pause streaming' : 'Resume streaming'}
            >
              {isStreaming ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              onClick={handleRefresh}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title="Refresh logs"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={handleCopy}
              className={`p-1.5 transition-colors ${
                copied
                  ? 'text-[hsl(var(--green))]'
                  : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))]'
              }`}
              title={copied ? 'Copied!' : 'Copy all logs'}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              onClick={handleDownload}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title="Download logs"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={handleClear}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              title="Clear logs"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-4 py-2 bg-[hsl(var(--red)/0.1)] border-b border-[hsl(var(--red)/0.3)] text-xs text-[hsl(var(--red))]">
            Error: {error}
          </div>
        )}

        {/* Logs Content */}
        <div className="flex-1 overflow-auto bg-[hsl(var(--bg-base))] p-3 font-mono text-[11px] leading-relaxed">
          {isLoading && logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[hsl(var(--text-muted))]">
              Loading logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[hsl(var(--text-muted))]">
              No logs available
            </div>
          ) : (
            <>
              {logs.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-all ${
                    line.includes('error') || line.includes('Error') || line.includes('ERROR')
                      ? 'text-[hsl(var(--red))]'
                      : line.includes('warn') || line.includes('Warn') || line.includes('WARN')
                      ? 'text-[hsl(var(--amber))]'
                      : line.startsWith('[')
                      ? 'text-[hsl(var(--text-muted))]'
                      : 'text-[hsl(var(--text-secondary))]'
                  }`}
                >
                  {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <div className="flex items-center justify-between text-[10px] text-[hsl(var(--text-muted))]">
            <span>{logs.length} lines</span>
            <span>Scroll down for newest logs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
