import { useMemo } from 'react';
import { SessionTile } from './SessionTile';
import { SessionThumbnail } from './SessionThumbnail';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { TerminalSquare } from 'lucide-react';

interface SessionGridProps {
  className?: string;
}

export function SessionGrid({ className = '' }: SessionGridProps) {
  const { state, swapWithMaximized, maximizeSession } = useCommandCentre();
  const { sessions, activeSessionId, maximizedSessionId, layoutMode } = state;

  // Calculate grid columns based on session count
  const gridStyle = useMemo(() => {
    const count = sessions.length;
    if (count === 0) return {};
    if (count === 1) return { gridTemplateColumns: '1fr' };
    if (count === 2) return { gridTemplateColumns: 'repeat(2, 1fr)' };
    if (count <= 4) return { gridTemplateColumns: 'repeat(2, 1fr)' };
    if (count <= 6) return { gridTemplateColumns: 'repeat(3, 1fr)' };
    return { gridTemplateColumns: 'repeat(3, 1fr)' };
  }, [sessions.length]);

  // Empty state
  if (sessions.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center ${className}`}>
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[hsl(var(--bg-elevated))] flex items-center justify-center">
            <TerminalSquare className="h-8 w-8 text-[hsl(var(--text-muted))]" />
          </div>
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] mb-2">
            No active sessions
          </h3>
          <p className="text-xs text-[hsl(var(--text-muted))]">
            Click "Add Session" to connect to a running VM or container
          </p>
        </div>
      </div>
    );
  }

  // Maximized layout
  if (layoutMode === 'maximized' && maximizedSessionId) {
    const maximizedSession = sessions.find(s => s.id === maximizedSessionId);
    const thumbnailSessions = sessions.filter(s => s.id !== maximizedSessionId);

    if (!maximizedSession) {
      // Fallback to grid if maximized session not found
      return <GridLayout sessions={sessions} activeSessionId={activeSessionId} gridStyle={gridStyle} className={className} />;
    }

    return (
      <div className={`flex-1 flex gap-2 p-2 overflow-hidden ${className}`}>
        {/* Maximized session */}
        <div className="flex-1 min-w-0">
          <SessionTile
            session={maximizedSession}
            isActive={maximizedSession.id === activeSessionId}
            isMaximized={true}
            className="h-full"
          />
        </div>

        {/* Thumbnails sidebar */}
        {thumbnailSessions.length > 0 && (
          <div className="w-44 flex-shrink-0 flex flex-col gap-2 overflow-y-auto thumbnail-sidebar">
            {thumbnailSessions.map((session, index) => (
              <div
                key={session.id}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <SessionThumbnail
                  session={session}
                  onClick={() => swapWithMaximized(session.id)}
                  isActive={session.id === activeSessionId}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Grid layout
  return <GridLayout sessions={sessions} activeSessionId={activeSessionId} gridStyle={gridStyle} className={className} onMaximize={maximizeSession} />;
}

interface GridLayoutProps {
  sessions: typeof useCommandCentre extends () => { state: { sessions: infer S } } ? S : never;
  activeSessionId: string | null;
  gridStyle: React.CSSProperties;
  className?: string;
  onMaximize?: (sessionId: string) => void;
}

function GridLayout({ sessions, activeSessionId, gridStyle, className = '' }: GridLayoutProps) {
  return (
    <div
      className={`flex-1 grid gap-2 p-2 auto-rows-fr overflow-auto ${className}`}
      style={gridStyle}
    >
      {sessions.map((session) => (
        <SessionTile
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          isMaximized={false}
          className="min-h-[250px]"
        />
      ))}
    </div>
  );
}
