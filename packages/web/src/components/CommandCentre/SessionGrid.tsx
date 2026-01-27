import { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect, DragEvent } from 'react';
import { SessionTile } from './SessionTile';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { TerminalSquare } from 'lucide-react';
import type { TerminalSession } from '../../types/command-centre';

// Helper to get session ID from drag event
function getSessionIdFromDrag(e: DragEvent): string | null {
  return e.dataTransfer.getData('application/x-session-id') || null;
}

interface SessionGridProps {
  className?: string;
}

interface SlotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function SessionGrid({ className = '' }: SessionGridProps) {
  const { state, reorderFocusedSessions, focusSession, unfocusSession, swapFocus } = useCommandCentre();
  const { sessions, activeSessionId, splitLayout, focusedSessionIds, fontSize, maximizedSessionId } = state;

  // Sidebar width state (in pixels) - start at max size
  const [sidebarWidth, setSidebarWidth] = useState(500);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Drag and drop state for focus/unfocus zones
  const [isDragOverSidebar, setIsDragOverSidebar] = useState(false);
  const [isDragOverMain, setIsDragOverMain] = useState(false);

  // Track slot positions for absolute positioning
  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [slotRects, setSlotRects] = useState<Record<string, SlotRect>>({});

  // Create ref callback for slots
  const createSlotRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    slotRefs.current[id] = el;
  }, []);

  // Update slot positions using ResizeObserver
  useLayoutEffect(() => {
    const updateRects = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();

      const newRects: Record<string, SlotRect> = {};
      for (const [id, el] of Object.entries(slotRefs.current)) {
        if (el) {
          const rect = el.getBoundingClientRect();
          newRects[id] = {
            top: rect.top - containerRect.top,
            left: rect.left - containerRect.left,
            width: rect.width,
            height: rect.height,
          };
        }
      }
      setSlotRects(newRects);
    };

    // Initial update
    updateRects();

    // Observe container for resize
    const resizeObserver = new ResizeObserver(updateRects);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Also observe each slot
    for (const el of Object.values(slotRefs.current)) {
      if (el) resizeObserver.observe(el);
    }

    return () => resizeObserver.disconnect();
  }, [sessions, focusedSessionIds, maximizedSessionId, sidebarWidth, splitLayout]);

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

  // Drag handlers for sidebar (drop to unfocus)
  const handleSidebarDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverSidebar(true);
  }, []);

  const handleSidebarDragLeave = useCallback(() => {
    setIsDragOverSidebar(false);
  }, []);

  const handleSidebarDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverSidebar(false);
    const sessionId = getSessionIdFromDrag(e);
    if (sessionId && focusedSessionIds.includes(sessionId)) {
      unfocusSession(sessionId);
    }
  }, [focusedSessionIds, unfocusSession]);

  // Drag handlers for main area (drop to focus)
  const handleMainDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverMain(true);
  }, []);

  const handleMainDragLeave = useCallback(() => {
    setIsDragOverMain(false);
  }, []);

  const handleMainDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverMain(false);
    const sessionId = getSessionIdFromDrag(e);
    if (sessionId && !focusedSessionIds.includes(sessionId)) {
      focusSession(sessionId);
    }
  }, [focusedSessionIds, focusSession]);

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

  return (
    <div ref={containerRef} className={`flex-1 flex overflow-hidden relative ${className}`}>
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
          {/* Main area - render slots for focused sessions, drop zone to focus */}
          <div
            className={`flex-1 min-w-0 p-2 pr-0 transition-colors ${
              isDragOverMain ? 'bg-[hsl(var(--cyan)/0.1)]' : ''
            }`}
            onDragOver={handleMainDragOver}
            onDragLeave={handleMainDragLeave}
            onDrop={handleMainDrop}
          >
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
              <div className={`h-full flex items-center justify-center text-sm ${
                isDragOverMain ? 'text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))]'
              }`}>
                {isDragOverMain ? 'Drop to focus session' : 'Click a session in the sidebar to focus it'}
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

          {/* Sidebar - render slots for unfocused sessions, drop zone to unfocus */}
          {hasUnfocused ? (
            <div
              className={`flex-shrink-0 p-2 pl-0 flex flex-col gap-2 overflow-y-auto transition-colors ${
                isDragOverSidebar ? 'bg-[hsl(var(--amber)/0.1)]' : ''
              }`}
              style={{ width: sidebarWidth }}
              onDragOver={handleSidebarDragOver}
              onDragLeave={handleSidebarDragLeave}
              onDrop={handleSidebarDrop}
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
          ) : (
            // Show drop zone when dragging even if no unfocused sessions yet
            <div
              className={`flex-shrink-0 p-2 pl-0 flex items-center justify-center transition-all ${
                isDragOverSidebar
                  ? 'w-48 bg-[hsl(var(--amber)/0.1)] border-2 border-dashed border-[hsl(var(--amber)/0.5)]'
                  : 'w-0 overflow-hidden'
              }`}
              onDragOver={handleSidebarDragOver}
              onDragLeave={handleSidebarDragLeave}
              onDrop={handleSidebarDrop}
            >
              {isDragOverSidebar && (
                <span className="text-xs text-[hsl(var(--amber))] whitespace-nowrap">
                  Drop to sidebar
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* Render all session tiles with absolute positioning - NEVER unmount */}
      {sessions.map((session) => {
        const rect = slotRects[session.id];
        const isFocused = focusedSessionIds.includes(session.id);
        const isMaximized = maximizedSessionId === session.id;
        const index = isFocused ? focusedSessionIds.indexOf(session.id) : undefined;

        return (
          <div
            key={session.id}
            className="absolute transition-all duration-200 ease-out"
            style={{
              top: rect?.top ?? 0,
              left: rect?.left ?? 0,
              width: rect?.width ?? 0,
              height: rect?.height ?? 0,
              // Hide if no rect yet (initial render)
              opacity: rect ? 1 : 0,
              pointerEvents: rect ? 'auto' : 'none',
            }}
          >
            <SessionTile
              session={session}
              isActive={isMaximized || session.id === activeSessionId}
              isThumbnail={!isFocused && !isMaximized}
              fontSize={fontSize}
              className="h-full w-full"
              index={index}
              onReorder={isFocused && !isMaximized ? reorderFocusedSessions : undefined}
              onSwap={isFocused && !isMaximized ? swapFocus : undefined}
              isDraggable={!isMaximized} // All sessions draggable (for focus/unfocus), except maximized
            />
          </div>
        );
      })}
    </div>
  );
}
