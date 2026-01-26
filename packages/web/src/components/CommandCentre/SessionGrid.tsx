import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { SessionTile } from './SessionTile';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { TerminalSquare, GripVertical } from 'lucide-react';
import type { TerminalSession, SplitLayout } from '../../types/command-centre';

interface SessionGridProps {
  className?: string;
}

export function SessionGrid({ className = '' }: SessionGridProps) {
  const { state, setSidebarWidth } = useCommandCentre();
  const { sessions, activeSessionId, splitLayout, focusedSessionIds, fontSize, sidebarWidth, maximizedSessionId } = state;

  // Sidebar resize state
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle sidebar resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  // Separate sessions into focused and unfocused
  const focusedSessions = useMemo(() =>
    sessions.filter(s => focusedSessionIds.includes(s.id)),
    [sessions, focusedSessionIds]
  );

  const unfocusedSessions = useMemo(() =>
    sessions.filter(s => !focusedSessionIds.includes(s.id)),
    [sessions, focusedSessionIds]
  );

  // Get maximized session if any
  const maximizedSession = useMemo(() =>
    maximizedSessionId ? sessions.find(s => s.id === maximizedSessionId) : null,
    [sessions, maximizedSessionId]
  );

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

  // Maximized mode: single session takes full view
  if (maximizedSession) {
    return (
      <div className={`flex-1 p-2 overflow-hidden ${className}`}>
        <SessionTile
          session={maximizedSession}
          isActive={true}
          fontSize={fontSize}
          className="h-full"
        />
      </div>
    );
  }

  // If no unfocused sessions, show all in main area (no sidebar)
  if (unfocusedSessions.length === 0) {
    return (
      <div className={`flex-1 p-2 overflow-hidden ${className}`}>
        <SplitView
          sessions={sessions}
          layout={splitLayout}
          activeSessionId={activeSessionId}
          fontSize={fontSize}
        />
      </div>
    );
  }

  // Has unfocused sessions: show focused in main, unfocused in sidebar
  return (
    <div ref={containerRef} className={`flex-1 flex gap-0 p-2 overflow-hidden ${className}`}>
      {/* Main area: focused sessions */}
      <div className="flex-1 min-w-0 pr-2">
        {focusedSessions.length > 0 ? (
          <SplitView
            sessions={focusedSessions}
            layout={splitLayout}
            activeSessionId={activeSessionId}
            fontSize={fontSize}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))] text-sm">
            Click a session in the sidebar to focus it
          </div>
        )}
      </div>

      {/* Resize handle */}
      {unfocusedSessions.length > 0 && (
        <div
          className="w-2 flex-shrink-0 cursor-ew-resize hover:bg-[hsl(var(--cyan)/0.3)] transition-colors flex items-center justify-center group"
          onMouseDown={handleMouseDown}
        >
          <GripVertical className="h-6 w-6 text-[hsl(var(--text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}

      {/* Sidebar: unfocused sessions as live thumbnails */}
      {unfocusedSessions.length > 0 && (
        <div
          className="flex-shrink-0 flex flex-col gap-2 overflow-y-auto"
          style={{ width: sidebarWidth }}
        >
          {unfocusedSessions.map((session) => (
            <SessionTile
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              isThumbnail={true}
              fontSize={fontSize}
              className="flex-shrink-0"
              style={{ height: Math.max(80, sidebarWidth * 0.5) }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Split view component for arranging sessions
interface SplitViewProps {
  sessions: TerminalSession[];
  layout: SplitLayout;
  activeSessionId: string | null;
  fontSize: number;
}

function SplitView({ sessions, layout, activeSessionId, fontSize }: SplitViewProps) {
  const style = useMemo(() => {
    const count = sessions.length;
    if (count === 0) return {};

    switch (layout) {
      case 'vertical':
        return {
          display: 'flex',
          flexDirection: 'column' as const,
          gap: '8px',
        };
      case 'horizontal':
        return {
          display: 'flex',
          flexDirection: 'row' as const,
          gap: '8px',
        };
      case 'grid':
      default:
        // Calculate optimal grid
        if (count === 1) return { display: 'grid', gridTemplateColumns: '1fr', gap: '8px' };
        if (count === 2) return { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' };
        if (count <= 4) return { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' };
        if (count <= 6) return { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' };
        return { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' };
    }
  }, [sessions.length, layout]);

  return (
    <div className="h-full overflow-auto" style={style}>
      {sessions.map((session) => (
        <SessionTile
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          fontSize={fontSize}
          className={layout === 'grid' ? 'min-h-[200px]' : 'flex-1 min-h-[150px]'}
        />
      ))}
    </div>
  );
}
