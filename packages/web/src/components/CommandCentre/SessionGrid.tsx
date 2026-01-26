import React, { useMemo } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { SessionTile } from './SessionTile';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { TerminalSquare, GripVertical, GripHorizontal } from 'lucide-react';
import type { TerminalSession, SplitLayout } from '../../types/command-centre';

interface SessionGridProps {
  className?: string;
}

export function SessionGrid({ className = '' }: SessionGridProps) {
  const { state, reorderSessions, reorderFocusedSessions } = useCommandCentre();
  const { sessions, activeSessionId, splitLayout, focusedSessionIds, fontSize, sidebarWidth, maximizedSessionId } = state;

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

  // Calculate sidebar percentage (for panel sizing)
  const sidebarPercentage = useMemo(() => {
    // Approximate: assume container is ~1200px wide
    return Math.min(40, Math.max(15, (sidebarWidth / 1200) * 100));
  }, [sidebarWidth]);

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
        <ResizableSplitView
          sessions={sessions}
          layout={splitLayout}
          activeSessionId={activeSessionId}
          fontSize={fontSize}
          onReorder={reorderFocusedSessions}
        />
      </div>
    );
  }

  // Has unfocused sessions: show focused in main, unfocused in sidebar
  return (
    <div className={`flex-1 overflow-hidden ${className}`}>
      <PanelGroup orientation="horizontal" className="h-full">
        {/* Main area: focused sessions */}
        <Panel defaultSize={100 - sidebarPercentage} minSize={30}>
          <div className="h-full p-2 pr-0">
            {focusedSessions.length > 0 ? (
              <ResizableSplitView
                sessions={focusedSessions}
                layout={splitLayout}
                activeSessionId={activeSessionId}
                fontSize={fontSize}
                onReorder={reorderFocusedSessions}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))] text-sm">
                Click a session in the sidebar to focus it
              </div>
            )}
          </div>
        </Panel>

        {/* Resize handle */}
        <ResizeHandle direction="horizontal" />

        {/* Sidebar: unfocused sessions */}
        <Panel defaultSize={sidebarPercentage} minSize={15} maxSize={50}>
          <div className="h-full p-2 pl-0">
            <PanelGroup orientation="vertical" className="h-full">
              {unfocusedSessions.map((session, index) => (
                <SessionPanelWithHandle
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  isThumbnail={true}
                  fontSize={fontSize}
                  isLast={index === unfocusedSessions.length - 1}
                  direction="vertical"
                  index={index}
                  onReorder={reorderSessions}
                />
              ))}
            </PanelGroup>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

// Session panel with optional resize handle
interface SessionPanelWithHandleProps {
  session: TerminalSession;
  isActive: boolean;
  isThumbnail?: boolean;
  fontSize: number;
  isLast: boolean;
  direction: 'horizontal' | 'vertical';
  index?: number;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

function SessionPanelWithHandle({
  session,
  isActive,
  isThumbnail = false,
  fontSize,
  isLast,
  index,
  onReorder,
  direction,
}: SessionPanelWithHandleProps) {
  return (
    <>
      <Panel minSize={15}>
        <div className="h-full p-1">
          <SessionTile
            session={session}
            isActive={isActive}
            isThumbnail={isThumbnail}
            fontSize={fontSize}
            className="h-full"
            index={index}
            onReorder={onReorder}
          />
        </div>
      </Panel>
      {!isLast && <ResizeHandle direction={direction} />}
    </>
  );
}

// Custom resize handle with Hyprland-style visuals
interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
}

function ResizeHandle({ direction }: ResizeHandleProps) {
  const isHorizontal = direction === 'horizontal';

  return (
    <PanelResizeHandle
      className={`
        group relative flex items-center justify-center
        ${isHorizontal ? 'w-3' : 'h-3'}
        hover:bg-[hsl(var(--cyan)/0.2)] active:bg-[hsl(var(--cyan)/0.3)]
        transition-colors duration-150
      `}
    >
      {/* Visual handle bar */}
      <div
        className={`
          absolute bg-[hsl(var(--border))] group-hover:bg-[hsl(var(--cyan)/0.6)] group-active:bg-[hsl(var(--cyan))]
          transition-all duration-150 rounded-full
          ${isHorizontal ? 'w-1 h-12' : 'h-1 w-12'}
        `}
      />
      {/* Grip icon on hover */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10">
        {isHorizontal ? (
          <GripVertical className="h-4 w-4 text-[hsl(var(--cyan))]" />
        ) : (
          <GripHorizontal className="h-4 w-4 text-[hsl(var(--cyan))]" />
        )}
      </div>
    </PanelResizeHandle>
  );
}

// Resizable split view for main area
interface ResizableSplitViewProps {
  sessions: TerminalSession[];
  layout: SplitLayout;
  activeSessionId: string | null;
  fontSize: number;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

function ResizableSplitView({ sessions, layout, activeSessionId, fontSize, onReorder }: ResizableSplitViewProps) {
  const count = sessions.length;

  if (count === 0) return null;

  // Single session - no resize needed
  if (count === 1) {
    return (
      <div className="h-full">
        <SessionTile
          session={sessions[0]}
          isActive={sessions[0].id === activeSessionId}
          fontSize={fontSize}
          className="h-full"
          index={0}
          onReorder={onReorder}
        />
      </div>
    );
  }

  // Vertical layout - stack vertically with horizontal resize handles
  if (layout === 'vertical') {
    return (
      <PanelGroup orientation="vertical" className="h-full">
        {sessions.map((session, index) => (
          <SessionPanelWithHandle
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            fontSize={fontSize}
            isLast={index === sessions.length - 1}
            direction="vertical"
            index={index}
            onReorder={onReorder}
          />
        ))}
      </PanelGroup>
    );
  }

  // Horizontal layout - stack horizontally with vertical resize handles
  if (layout === 'horizontal') {
    return (
      <PanelGroup orientation="horizontal" className="h-full">
        {sessions.map((session, index) => (
          <SessionPanelWithHandle
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            fontSize={fontSize}
            isLast={index === sessions.length - 1}
            direction="horizontal"
            index={index}
            onReorder={onReorder}
          />
        ))}
      </PanelGroup>
    );
  }

  // Grid layout - use nested panels for 2D resizing
  // For 2 sessions: side by side
  if (count === 2) {
    return (
      <PanelGroup orientation="horizontal" className="h-full">
        <Panel minSize={20}>
          <div className="h-full p-1">
            <SessionTile
              session={sessions[0]}
              isActive={sessions[0].id === activeSessionId}
              fontSize={fontSize}
              className="h-full"
              index={0}
              onReorder={onReorder}
            />
          </div>
        </Panel>
        <ResizeHandle direction="horizontal" />
        <Panel minSize={20}>
          <div className="h-full p-1">
            <SessionTile
              session={sessions[1]}
              isActive={sessions[1].id === activeSessionId}
              fontSize={fontSize}
              className="h-full"
              index={1}
              onReorder={onReorder}
            />
          </div>
        </Panel>
      </PanelGroup>
    );
  }

  // For 3-4 sessions: 2x2 grid
  if (count <= 4) {
    const topRow = sessions.slice(0, 2);
    const bottomRow = sessions.slice(2);

    return (
      <PanelGroup orientation="vertical" className="h-full">
        <Panel minSize={20}>
          <PanelGroup orientation="horizontal" className="h-full">
            {topRow.map((session, index) => (
              <SessionPanelWithHandle
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                fontSize={fontSize}
                isLast={index === topRow.length - 1}
                direction="horizontal"
                index={index}
                onReorder={onReorder}
              />
            ))}
          </PanelGroup>
        </Panel>
        {bottomRow.length > 0 && (
          <>
            <ResizeHandle direction="vertical" />
            <Panel minSize={20}>
              <PanelGroup orientation="horizontal" className="h-full">
                {bottomRow.map((session, index) => (
                  <SessionPanelWithHandle
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    fontSize={fontSize}
                    isLast={index === bottomRow.length - 1}
                    direction="horizontal"
                    index={index + 2}
                    onReorder={onReorder}
                  />
                ))}
              </PanelGroup>
            </Panel>
          </>
        )}
      </PanelGroup>
    );
  }

  // For 5-6 sessions: 3x2 grid
  if (count <= 6) {
    const topRow = sessions.slice(0, 3);
    const bottomRow = sessions.slice(3);

    return (
      <PanelGroup orientation="vertical" className="h-full">
        <Panel minSize={20}>
          <PanelGroup orientation="horizontal" className="h-full">
            {topRow.map((session, index) => (
              <SessionPanelWithHandle
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                fontSize={fontSize}
                isLast={index === topRow.length - 1}
                direction="horizontal"
                index={index}
                onReorder={onReorder}
              />
            ))}
          </PanelGroup>
        </Panel>
        {bottomRow.length > 0 && (
          <>
            <ResizeHandle direction="vertical" />
            <Panel minSize={20}>
              <PanelGroup orientation="horizontal" className="h-full">
                {bottomRow.map((session, index) => (
                  <SessionPanelWithHandle
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    fontSize={fontSize}
                    isLast={index === bottomRow.length - 1}
                    direction="horizontal"
                    index={index + 3}
                    onReorder={onReorder}
                  />
                ))}
              </PanelGroup>
            </Panel>
          </>
        )}
      </PanelGroup>
    );
  }

  // For more than 6: 3-column grid with multiple rows
  const rows: TerminalSession[][] = [];
  for (let i = 0; i < sessions.length; i += 3) {
    rows.push(sessions.slice(i, i + 3));
  }

  return (
    <PanelGroup orientation="vertical" className="h-full">
      {rows.map((row, rowIndex) => (
        <React.Fragment key={rowIndex}>
          <Panel minSize={15}>
            <PanelGroup orientation="horizontal" className="h-full">
              {row.map((session, colIndex) => (
                <SessionPanelWithHandle
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  fontSize={fontSize}
                  isLast={colIndex === row.length - 1}
                  direction="horizontal"
                  index={rowIndex * 3 + colIndex}
                  onReorder={onReorder}
                />
              ))}
            </PanelGroup>
          </Panel>
          {rowIndex < rows.length - 1 && <ResizeHandle direction="vertical" />}
        </React.Fragment>
      ))}
    </PanelGroup>
  );
}
