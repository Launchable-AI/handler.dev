import { Server, Container } from 'lucide-react';
import type { TerminalSession } from '../../types/command-centre';

interface SessionThumbnailProps {
  session: TerminalSession;
  onClick: () => void;
  isActive?: boolean;
}

export function SessionThumbnail({ session, onClick, isActive }: SessionThumbnailProps) {
  const statusColor = {
    connecting: 'bg-[hsl(var(--amber))]',
    connected: 'bg-[hsl(var(--green))]',
    disconnected: 'bg-[hsl(var(--text-muted))]',
    error: 'bg-[hsl(var(--red))]',
  }[session.status];

  return (
    <button
      onClick={onClick}
      className={`
        group w-full p-2 text-left transition-all duration-200
        border border-[hsl(var(--border))] hover:border-[hsl(var(--cyan)/0.5)]
        bg-[hsl(var(--bg-elevated))] hover:bg-[hsl(var(--bg-overlay))]
        thumbnail-enter
        ${isActive ? 'ring-2 ring-[hsl(var(--cyan)/0.5)]' : ''}
      `}
    >
      {/* Preview area (placeholder for actual terminal preview) */}
      <div className="aspect-video bg-[hsl(220,20%,6%)] mb-2 relative overflow-hidden">
        {/* Fake terminal lines for preview */}
        <div className="absolute inset-0 p-1.5 text-[6px] font-mono text-[hsl(var(--green)/0.7)] leading-tight overflow-hidden">
          <div className="opacity-60">$ _</div>
        </div>

        {/* Status dot */}
        <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${statusColor}`} />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-[hsl(var(--cyan)/0)] group-hover:bg-[hsl(var(--cyan)/0.1)] transition-colors flex items-center justify-center">
          {session.type === 'vm' ? (
            <Server className="h-4 w-4 text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity" />
          ) : (
            <Container className="h-4 w-4 text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>

      {/* Session info */}
      <div className="flex items-center gap-2">
        {session.type === 'vm' ? (
          <Server className="h-3 w-3 text-[hsl(var(--text-muted))] flex-shrink-0" />
        ) : (
          <Container className="h-3 w-3 text-[hsl(var(--text-muted))] flex-shrink-0" />
        )}
        <div className={`w-1.5 h-1.5 rounded-full ${statusColor} flex-shrink-0`} />
        <span className="text-[10px] font-medium text-[hsl(var(--text-primary))] truncate">
          {session.targetName}
        </span>
      </div>
    </button>
  );
}
