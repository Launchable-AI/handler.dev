import { useCallback, CSSProperties } from 'react';
import { X, ArrowDownToLine, Server, Container } from 'lucide-react';
import { TerminalInstance } from '../Terminal/TerminalInstance';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import type { TerminalSession } from '../../types/command-centre';

interface SessionTileProps {
  session: TerminalSession;
  isActive?: boolean;
  isThumbnail?: boolean;
  className?: string;
  style?: CSSProperties;
  fontSize?: number;
  onClick?: () => void;
}

export function SessionTile({
  session,
  isActive = false,
  isThumbnail = false,
  className = '',
  style,
  fontSize = 13,
  onClick,
}: SessionTileProps) {
  const {
    state,
    closeSession,
    updateSessionStatus,
    setActiveSession,
    unfocusSession,
  } = useCommandCentre();

  const handleStateChange = useCallback((state: 'connecting' | 'connected' | 'disconnected' | 'error', errorMessage?: string) => {
    updateSessionStatus(session.id, state, errorMessage);
  }, [session.id, updateSessionStatus]);

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick();
    } else {
      setActiveSession(session.id);
    }
  }, [session.id, setActiveSession, onClick]);

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

  // Can unfocus only in focus mode and if there's more than one focused session
  const canUnfocus = state.layoutMode === 'focus' && state.focusedSessionIds.length > 1;

  return (
    <div
      className={`
        flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]
        transition-all duration-200 overflow-hidden
        ${isActive && !isThumbnail ? 'ring-2 ring-[hsl(var(--cyan)/0.5)]' : ''}
        ${isThumbnail ? 'cursor-pointer hover:border-[hsl(var(--cyan)/0.5)] hover:ring-1 hover:ring-[hsl(var(--cyan)/0.3)]' : ''}
        ${className}
      `}
      style={style}
      onClick={handleClick}
    >
      {/* Tile header */}
      <div className={`flex items-center justify-between bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))] ${isThumbnail ? 'px-2 py-1' : 'px-3 py-1.5'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {session.type === 'vm' ? (
            <Server className={`${isThumbnail ? 'h-3 w-3' : 'h-3.5 w-3.5'} flex-shrink-0 ${statusColor}`} />
          ) : (
            <Container className={`${isThumbnail ? 'h-3 w-3' : 'h-3.5 w-3.5'} flex-shrink-0 ${statusColor}`} />
          )}
          <div className={`${isThumbnail ? 'w-1 h-1' : 'w-1.5 h-1.5'} rounded-full flex-shrink-0 ${statusDot}`} />
          <span className={`${isThumbnail ? 'text-[10px]' : 'text-xs'} font-medium text-[hsl(var(--text-primary))] truncate`}>
            {session.targetName}
          </span>
          {!isThumbnail && session.targetIp && (
            <span className="text-[10px] text-[hsl(var(--text-muted))] truncate">
              {session.targetIp}
            </span>
          )}
        </div>

        {!isThumbnail && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {canUnfocus && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  unfocusSession(session.id);
                }}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] transition-colors"
                title="Move to sidebar"
              >
                <ArrowDownToLine className="h-3 w-3" />
              </button>
            )}
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
        )}
      </div>

      {/* Terminal */}
      <div className="flex-1 relative min-h-0">
        <TerminalInstance
          target={{
            type: session.type,
            id: session.targetId,
            ip: session.targetIp,
          }}
          onStateChange={handleStateChange}
          showStatusBar={false}
          fontSize={isThumbnail ? Math.max(6, Math.floor(fontSize * 0.6)) : fontSize}
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
