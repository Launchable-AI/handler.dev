import { useCallback, useRef, useState, CSSProperties, useMemo } from 'react';
import { X, PanelRightClose, Server, Container, Maximize2, Minimize2, Upload, Loader2, Check, PanelLeftOpen } from 'lucide-react';
import { TerminalInstance } from '../Terminal/TerminalInstance';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import type { TerminalSession } from '../../types/command-centre';
import * as api from '../../api/client';

// Hyprland-style spring easing
const SPRING_EASING = 'cubic-bezier(0.05, 0.9, 0.1, 1.02)';
const SPRING_DURATION = '350ms';

interface SessionTileProps {
  session: TerminalSession;
  isActive?: boolean;
  isThumbnail?: boolean;
  className?: string;
  style?: CSSProperties;
  fontSize?: number;
  onClick?: () => void;
  // Drag and drop
  index?: number;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onSwap?: (focusedId: string, unfocusedId: string) => void; // Swap focused/unfocused
  onInsertAt?: (sessionId: string, index: number) => void; // Insert unfocused at specific position
  isDraggable?: boolean;
}

// Drop zone detection: edge (insert) vs center (swap/reorder)
type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | null;

export function SessionTile({
  session,
  isActive = false,
  isThumbnail = false,
  className = '',
  style,
  fontSize = 13,
  onClick,
  index,
  onReorder,
  onSwap,
  onInsertAt,
  isDraggable = true,
}: SessionTileProps) {
  const {
    state,
    closeSession,
    updateSessionStatus,
    setActiveSession,
    unfocusSession,
    focusSession,
    toggleMaximize,
  } = useCommandCentre();

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropZone, setDropZone] = useState<DropZone>(null);

  // Drag handlers - session ID is always set, index only if available (for reordering)
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!isDraggable) return;
    e.dataTransfer.setData('application/x-session-id', session.id);
    if (index !== undefined) {
      e.dataTransfer.setData('text/plain', String(index));
    }
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }, [isDraggable, index, session.id]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Detect which zone of the tile the cursor is in (for insert vs swap)
  const getDropZone = useCallback((e: React.DragEvent): DropZone => {
    if (!tileRef.current) return 'center';
    const rect = tileRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const edgeThreshold = 0.25; // 25% from edge triggers insert

    // Check horizontal position
    if (x < rect.width * edgeThreshold) return 'left';
    if (x > rect.width * (1 - edgeThreshold)) return 'right';
    // Check vertical position (for vertical layouts)
    if (y < rect.height * edgeThreshold) return 'top';
    if (y > rect.height * (1 - edgeThreshold)) return 'bottom';
    return 'center';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Allow drops for reordering, swapping, or inserting
    const hasReorder = index !== undefined && onReorder;
    const hasSwap = !isThumbnail && onSwap;
    const hasInsert = !isThumbnail && onInsertAt && index !== undefined;
    if (!hasReorder && !hasSwap && !hasInsert) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
    setDropZone(getDropZone(e));
  }, [index, onReorder, onSwap, onInsertAt, isThumbnail, getDropZone]);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
    setDropZone(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const zone = getDropZone(e);
    setIsDragOver(false);
    setDropZone(null);

    const draggedSessionId = e.dataTransfer.getData('application/x-session-id');
    const fromIndexStr = e.dataTransfer.getData('text/plain');
    const fromIndex = fromIndexStr ? parseInt(fromIndexStr, 10) : NaN;

    // Don't drop on self
    if (draggedSessionId === session.id) return;

    // Check if dragged session is focused (has valid fromIndex) or unfocused
    const draggedIsFocused = !isNaN(fromIndex) && fromIndex >= 0;

    if (draggedIsFocused && index !== undefined && onReorder) {
      // Reorder: focused session dropped on another focused session
      if (fromIndex !== index) {
        // Determine target index based on drop zone
        let targetIndex = index;
        if (zone === 'left' || zone === 'top') {
          targetIndex = fromIndex < index ? index : index;
        } else if (zone === 'right' || zone === 'bottom') {
          targetIndex = fromIndex < index ? index : index + 1;
        }
        onReorder(fromIndex, targetIndex);
      }
    } else if (!draggedIsFocused && index !== undefined && draggedSessionId) {
      // Unfocused session dropped on focused session
      if ((zone === 'left' || zone === 'top') && onInsertAt) {
        // Insert before this position
        onInsertAt(draggedSessionId, index);
      } else if ((zone === 'right' || zone === 'bottom') && onInsertAt) {
        // Insert after this position
        onInsertAt(draggedSessionId, index + 1);
      } else if (zone === 'center' && onSwap) {
        // Swap
        onSwap(session.id, draggedSessionId);
      }
    }
  }, [session.id, index, onReorder, onSwap, onInsertAt, getDropZone]);

  const handleStateChange = useCallback((state: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting', errorMessage?: string) => {
    updateSessionStatus(session.id, state, errorMessage);
  }, [session.id, updateSessionStatus]);

  const handleTmuxStateChange = useCallback((tmuxState: 'connected' | 'detached' | 'unavailable') => {
    updateSessionStatus(session.id, session.status, undefined, tmuxState);
  }, [session.id, session.status, updateSessionStatus]);

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick();
    } else if (!isThumbnail) {
      // Only set active session when not a thumbnail
      setActiveSession(session.id);
    }
    // For thumbnails, don't do anything on click - allow interaction with terminal
  }, [session.id, setActiveSession, onClick, isThumbnail]);

  // Handle upload for VMs
  const handleUploadClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadSuccess(false);

    try {
      if (session.type === 'vm') {
        await api.uploadFileToVm(session.targetId, file, '/home/agent');
      } else {
        // For containers, upload to workspace directory via sandbox API
        await api.uploadFileToSandbox(session.targetId, file, '/home/dev/workspace');
      }
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2000);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [session.targetId, session.type]);

  const statusColor = {
    connecting: 'text-[hsl(var(--amber))]',
    connected: 'text-[hsl(var(--green))]',
    disconnected: 'text-[hsl(var(--text-muted))]',
    error: 'text-[hsl(var(--red))]',
    reconnecting: 'text-[hsl(var(--amber))]',
  }[session.status];

  const statusDot = {
    connecting: 'bg-[hsl(var(--amber))]',
    connected: 'bg-[hsl(var(--green))]',
    disconnected: 'bg-[hsl(var(--text-muted))]',
    error: 'bg-[hsl(var(--red))]',
    reconnecting: 'bg-[hsl(var(--amber))]',
  }[session.status];

  // Can unfocus only if there's more than one focused session (need at least one in main area)
  const canUnfocus = state.focusedSessionIds.length > 1;
  const isMaximized = state.maximizedSessionId === session.id;
  const canMaximize = state.sessions.length > 1;

  // Merge styles with spring animation and drag feedback
  const mergedStyle = useMemo((): CSSProperties => ({
    ...style,
    transition: style?.transition || `all ${SPRING_DURATION} ${SPRING_EASING}`,
    opacity: isDragging ? 0.5 : 1,
    transform: isDragOver && dropZone === 'center' ? 'scale(1.02)' : undefined,
  }), [style, isDragging, isDragOver, dropZone]);

  // Drop zone indicator styles
  const dropZoneIndicator = useMemo(() => {
    if (!isDragOver || !dropZone || dropZone === 'center') return null;
    const isHorizontal = dropZone === 'left' || dropZone === 'right';
    const position = dropZone === 'left' || dropZone === 'top' ? 'start' : 'end';
    return { isHorizontal, position };
  }, [isDragOver, dropZone]);

  return (
    <div
      ref={tileRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]
        overflow-hidden
        ${isActive && !isThumbnail ? 'ring-2 ring-[hsl(var(--cyan)/0.5)]' : ''}
        ${isThumbnail ? 'hover:border-[hsl(var(--cyan)/0.5)]' : ''}
        ${isDragOver && dropZone === 'center' ? 'border-[hsl(var(--cyan))] ring-2 ring-[hsl(var(--cyan)/0.3)]' : ''}
        ${className}
      `}
      style={mergedStyle}
      onClick={!isThumbnail ? handleClick : undefined}
    >
      {/* Drop zone edge indicator */}
      {dropZoneIndicator && (
        <div
          className={`absolute bg-[hsl(var(--cyan))] z-50 pointer-events-none ${
            dropZoneIndicator.isHorizontal
              ? `w-1 top-0 bottom-0 ${dropZoneIndicator.position === 'start' ? 'left-0' : 'right-0'}`
              : `h-1 left-0 right-0 ${dropZoneIndicator.position === 'start' ? 'top-0' : 'bottom-0'}`
          }`}
        />
      )}
      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Tile header - draggable for reordering and focus/unfocus */}
      <div
        draggable={isDraggable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={`flex items-center justify-between bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))] ${isThumbnail ? 'px-2 py-1' : 'px-3 py-1.5'} ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
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
          {session.tmuxState && (
            <span className={`inline-flex items-center gap-1 px-1 py-0.5 rounded text-[8px] uppercase tracking-wider ${
              session.tmuxState === 'connected'
                ? 'bg-[hsl(var(--green)/0.15)] text-[hsl(var(--green))]'
                : session.tmuxState === 'detached'
                ? 'bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))]'
                : 'bg-[hsl(var(--red)/0.15)] text-[hsl(var(--red))]'
            }`}>
              <span className={`inline-block w-1 h-1 rounded-full ${
                session.tmuxState === 'connected'
                  ? 'bg-[hsl(var(--green))]'
                  : session.tmuxState === 'detached'
                  ? 'bg-[hsl(var(--amber))]'
                  : 'bg-[hsl(var(--red))]'
              }`} />
              tmux
            </span>
          )}
        </div>

        {/* Actions - show for both thumbnail and full view */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Thumbnail-specific: Focus button to bring back to main area */}
          {isThumbnail && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                focusSession(session.id);
              }}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] transition-colors"
              title="Focus (bring to main area)"
            >
              <PanelLeftOpen className="h-3 w-3" />
            </button>
          )}

          {/* Unfocus button - only in full view when there's more than one focused */}
          {!isThumbnail && canUnfocus && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                unfocusSession(session.id);
              }}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] transition-colors"
              title="Move to sidebar"
            >
              <PanelRightClose className="h-3 w-3" />
            </button>
          )}

          {/* Upload button */}
          {session.status === 'connected' && (
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className={`p-1 transition-colors ${
                uploadSuccess
                  ? 'text-[hsl(var(--green))]'
                  : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)]'
              }`}
              title="Upload file"
            >
              {isUploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : uploadSuccess ? (
                <Check className="h-3 w-3" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
            </button>
          )}

          {/* Maximize button - show for all sessions */}
          {canMaximize && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximize(session.id);
              }}
              className={`p-1 transition-colors ${
                isMaximized
                  ? 'text-[hsl(var(--purple))] hover:text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)]'
                  : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))]'
              }`}
              title={isMaximized ? 'Restore (Esc)' : 'Maximize'}
            >
              {isMaximized ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </button>
          )}

          {/* Close button */}
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
      <div className="flex-1 relative min-h-0">
        <TerminalInstance
          target={{
            type: session.type,
            id: session.targetId,
            ip: session.targetIp,
          }}
          onStateChange={handleStateChange}
          onTmuxStateChange={handleTmuxStateChange}
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
