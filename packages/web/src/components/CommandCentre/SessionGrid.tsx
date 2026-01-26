import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SessionTile } from './SessionTile';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { TerminalSquare } from 'lucide-react';
import type { TerminalSession } from '../../types/command-centre';

interface SessionGridProps {
  className?: string;
}

export function SessionGrid({ className = '' }: SessionGridProps) {
  const { state, reorderFocusedSessions } = useCommandCentre();
  const { sessions, activeSessionId, splitLayout, focusedSessionIds, fontSize, maximizedSessionId } = state;

  // Sidebar width state (in pixels) - start at max size
  const [sidebarWidth, setSidebarWidth] = useState(500);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Portal targets for each session - keeps terminals mounted when moving between layouts
  const [portalTargets, setPortalTargets] = useState<Record<string, HTMLDivElement | null>>({});
  const pendingUpdates = useRef<Record<string, HTMLDivElement | null>>({});
  const updateScheduled = useRef(false);

  // Ref callback that batches updates to avoid infinite loops
  // CRITICAL: Only process non-null values to prevent race conditions when moving sessions
  // When a session moves, old slot fires null, new slot fires element - if null fires last,
  // the portal target becomes null and the terminal unmounts. By ignoring null callbacks,
  // we let the new slot's element take over smoothly.
  const createSlotRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    // Ignore unmount callbacks - only register new mount targets
    if (el === null) return;

    pendingUpdates.current[id] = el;
    if (!updateScheduled.current) {
      updateScheduled.current = true;
      requestAnimationFrame(() => {
        updateScheduled.current = false;
        const updates = { ...pendingUpdates.current };
        pendingUpdates.current = {};
        setPortalTargets(prev => {
          // Only update if something actually changed
          let hasChanges = false;
          for (const [key, value] of Object.entries(updates)) {
            if (prev[key] !== value) {
              hasChanges = true;
              break;
            }
          }
          if (!hasChanges) return prev;
          return { ...prev, ...updates };
        });
      });
    }
  }, []);

  // Clean up portal targets when sessions are removed (not moved)
  useEffect(() => {
    const validIds = new Set(sessions.map(s => s.id));
    setPortalTargets(prev => {
      const cleaned: Record<string, HTMLDivElement | null> = {};
      let changed = false;
      for (const [id, target] of Object.entries(prev)) {
        if (validIds.has(id)) {
          cleaned[id] = target;
        } else {
          changed = true; // This id was removed
        }
      }
      return changed ? cleaned : prev;
    });
  }, [sessions]);

  // Separate sessions into focused and unfocused
  const focusedSessions = useMemo(() =>
    focusedSessionIds
      .map(id => sessions.find(s => s.id === id))
      .filter((s): s is TerminalSession => s !== undefined),
    [sessions, focusedSessionIds]
  );

  const unfocusedSessions = useMemo(() =>
    sessions.filter(s => !focusedSessionIds.includes(s.id)),
    [sessions, focusedSessionIds]
  );

  const maximizedSession = useMemo(() =>
    maximizedSessionId ? sessions.find(s => s.id === maximizedSessionId) : null,
    [sessions, maximizedSessionId]
  );

  const hasUnfocused = unfocusedSessions.length > 0;

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      setSidebarWidth(Math.max(150, Math.min(500, newWidth)));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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

  // Calculate thumbnail height based on sidebar width (proportional)
  const thumbnailHeight = Math.max(100, sidebarWidth * 0.6);

  // Determine grid layout for focused sessions
  const count = focusedSessions.length;
  let gridClass = 'grid-cols-1';

  if (count === 1) {
    gridClass = 'grid-cols-1';
  } else if (splitLayout === 'vertical') {
    gridClass = 'grid-cols-1';
  } else if (splitLayout === 'horizontal') {
    gridClass = `grid-cols-${Math.min(count, 4)}`;
  } else {
    if (count === 2) gridClass = 'grid-cols-2';
    else if (count <= 4) gridClass = 'grid-cols-2 grid-rows-2';
    else if (count <= 6) gridClass = 'grid-cols-3 grid-rows-2';
    else if (count <= 9) gridClass = 'grid-cols-3 grid-rows-3';
    else gridClass = 'grid-cols-4';
  }

  // Single return with conditional layout - keeps portals in same tree position
  return (
    <div ref={containerRef} className={`flex-1 flex overflow-hidden ${className}`}>
      {maximizedSession ? (
        // Maximized mode: single session takes full view
        <div className="flex-1 p-2 overflow-hidden">
          <div
            ref={createSlotRef(maximizedSession.id)}
            className="h-full"
          />
        </div>
      ) : (
        // Normal mode: grid + sidebar layout
        <>
          {/* Main area - render slots for focused sessions */}
          <div className="flex-1 min-w-0 p-2 pr-0">
            {focusedSessions.length > 0 ? (
              <div className={`h-full grid ${gridClass} gap-1`}>
                {focusedSessions.map((session) => (
                  <div
                    key={session.id}
                    ref={createSlotRef(session.id)}
                    className="h-full min-h-0"
                  />
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))] text-sm">
                Click a session in the sidebar to focus it
              </div>
            )}
          </div>

          {/* Resize handle */}
          {hasUnfocused && (
            <div
              onMouseDown={handleMouseDown}
              className="w-2 flex-shrink-0 bg-[hsl(var(--bg-elevated))] hover:bg-[hsl(var(--cyan)/0.3)] active:bg-[hsl(var(--cyan)/0.5)] transition-colors cursor-col-resize flex items-center justify-center"
            >
              <div className="w-0.5 h-12 bg-[hsl(var(--border))] rounded-full" />
            </div>
          )}

          {/* Sidebar - render slots for unfocused sessions */}
          {hasUnfocused && (
            <div
              className="flex-shrink-0 p-2 pl-0 flex flex-col gap-2 overflow-y-auto"
              style={{ width: sidebarWidth }}
            >
              {unfocusedSessions.map((session) => (
                <div
                  key={session.id}
                  ref={createSlotRef(session.id)}
                  className="flex-shrink-0"
                  style={{ height: thumbnailHeight }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Render all session tiles via portals - ALWAYS at same position in React tree */}
      {sessions.map((session) => {
        const target = portalTargets[session.id];
        if (!target) return null;

        const isFocused = focusedSessionIds.includes(session.id);
        const isMaximized = maximizedSessionId === session.id;
        const index = isFocused ? focusedSessionIds.indexOf(session.id) : undefined;

        return createPortal(
          <SessionTile
            key={session.id}
            session={session}
            isActive={isMaximized || session.id === activeSessionId}
            isThumbnail={!isFocused && !isMaximized}
            fontSize={fontSize}
            className="h-full"
            index={index}
            onReorder={isFocused && !isMaximized ? reorderFocusedSessions : undefined}
            isDraggable={isFocused && !isMaximized}
          />,
          target
        );
      })}
    </div>
  );
}
