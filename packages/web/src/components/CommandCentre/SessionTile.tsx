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
  isDraggable?: boolean;
}

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

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!isDraggable || index === undefined) return;
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }, [isDraggable, index]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isDraggable || index === undefined) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }, [isDraggable, index]);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!isDraggable || index === undefined || !onReorder) return;
    e.preventDefault();
    setIsDragOver(false);
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex) && fromIndex !== index) {
      onReorder(fromIndex, index);
    }
  }, [isDraggable, index, onReorder]);

  const handleStateChange = useCallback((state: 'connecting' | 'connected' | 'disconnected' | 'error', errorMessage?: string) => {
    updateSessionStatus(session.id, state, errorMessage);
  }, [session.id, updateSessionStatus]);

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
  }[session.status];

  const statusDot = {
    connecting: 'bg-[hsl(var(--amber))]',
    connected: 'bg-[hsl(var(--green))]',
    disconnected: 'bg-[hsl(var(--text-muted))]',
    error: 'bg-[hsl(var(--red))]',
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
    transform: isDragOver ? 'scale(1.02)' : undefined,
  }), [style, isDragging, isDragOver]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]
        overflow-hidden
        ${isActive && !isThumbnail ? 'ring-2 ring-[hsl(var(--cyan)/0.5)]' : ''}
        ${isThumbnail ? 'hover:border-[hsl(var(--cyan)/0.5)]' : ''}
        ${isDragOver ? 'border-[hsl(var(--cyan))] ring-2 ring-[hsl(var(--cyan)/0.3)]' : ''}
        ${className}
      `}
      style={mergedStyle}
      onClick={!isThumbnail ? handleClick : undefined}
    >
      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Tile header - draggable for reordering */}
      <div
        draggable={isDraggable && index !== undefined}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={`flex items-center justify-between bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))] ${isThumbnail ? 'px-2 py-1' : 'px-3 py-1.5'} ${isDraggable && index !== undefined ? 'cursor-grab active:cursor-grabbing' : ''}`}
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
