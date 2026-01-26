import { useCallback } from 'react';
import { X, Maximize2, Minimize2, Server, Container } from 'lucide-react';
import { TerminalInstance } from '../Terminal/TerminalInstance';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import type { TerminalSession } from '../../types/command-centre';

interface SessionTileProps {
  session: TerminalSession;
  isActive?: boolean;
  isMaximized?: boolean;
  className?: string;
}

export function SessionTile({
  session,
  isActive = false,
  isMaximized = false,
  className = '',
}: SessionTileProps) {
  const {
    closeSession,
    updateSessionStatus,
    setActiveSession,
    toggleMaximize,
  } = useCommandCentre();

  const handleStateChange = useCallback((state: 'connecting' | 'connected' | 'disconnected' | 'error', errorMessage?: string) => {
    updateSessionStatus(session.id, state, errorMessage);
  }, [session.id, updateSessionStatus]);

  const handleFocus = useCallback(() => {
    setActiveSession(session.id);
  }, [session.id, setActiveSession]);

  const statusColor = {
    connecting: 'text-[hsl(var(--amber))]',
    connected: 'text-[hsl(var(--green))]',
    disconnected: 'text-[hsl(var(--text-muted))]',
    error: 'text-[hsl(var(--red))]',
  }[session.status];

  const statusDot = {
    connecting: 'bg-[hsl(var(--amber))]',
    connected: 'bg-[hsl(var(--green))]',
    disconnected: 'bg-[hsl(var(--text-muted))]',
    error: 'bg-[hsl(var(--red))]',
  }[session.status];

  return (
    <div
      className={`
        flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]
        transition-all duration-200 overflow-hidden
        ${isActive ? 'ring-2 ring-[hsl(var(--cyan)/0.5)] tile-focus' : ''}
        ${isMaximized ? 'tile-maximize' : ''}
        ${className}
      `}
      onClick={handleFocus}
    >
      {/* Tile header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2 min-w-0">
          {session.type === 'vm' ? (
            <Server className={`h-3.5 w-3.5 flex-shrink-0 ${statusColor}`} />
          ) : (
            <Container className={`h-3.5 w-3.5 flex-shrink-0 ${statusColor}`} />
          )}
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
          <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
            {session.targetName}
          </span>
          {session.targetIp && (
            <span className="text-[10px] text-[hsl(var(--text-muted))] truncate">
              {session.targetIp}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMaximize(session.id);
            }}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeSession(session.id);
            }}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] transition-colors"
            title="Close session"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 relative">
        <TerminalInstance
          target={{
            type: session.type,
            id: session.targetId,
            ip: session.targetIp,
          }}
          onStateChange={handleStateChange}
          showStatusBar={false}
        />
      </div>

      {/* Future: Agent status overlay */}
      {session.agentStatus && (
        <div className="absolute top-12 right-3 px-2 py-1 bg-[hsl(var(--bg-overlay)/0.9)] border border-[hsl(var(--border))]">
          <div className="flex items-center gap-2 text-[10px]">
            <div className={`w-2 h-2 rounded-full ${
              session.agentStatus.state === 'idle' ? 'bg-[hsl(var(--green))]' :
              session.agentStatus.state === 'thinking' ? 'bg-[hsl(var(--amber))] animate-pulse' :
              session.agentStatus.state === 'executing' ? 'bg-[hsl(var(--cyan))] animate-pulse' :
              'bg-[hsl(var(--purple))]'
            }`} />
            <span className="text-[hsl(var(--text-secondary))] uppercase tracking-wider">
              {session.agentStatus.state}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
