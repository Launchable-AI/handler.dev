// Command Centre Type Definitions

export interface TerminalSession {
  id: string;
  type: 'vm' | 'container';
  targetId: string;           // VM ID or container ID
  targetName: string;         // Display name
  targetIp?: string;          // For VMs
  shell: string;
  createdAt: Date;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
  // Future: agent status
  agentStatus?: {
    type: 'claude-code' | 'cursor' | 'custom';
    state: 'idle' | 'thinking' | 'executing' | 'waiting';
    message?: string;
  };
}

export interface TileLayout {
  sessionId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

export type LayoutMode = 'grid' | 'maximized';

export interface CommandCentreState {
  sessions: TerminalSession[];
  layouts: TileLayout[];
  activeSessionId: string | null;
  maximizedSessionId: string | null;
  layoutMode: LayoutMode;
}

export interface CommandCentreContextValue {
  state: CommandCentreState;

  // Session management
  createSession: (type: 'vm' | 'container', targetId: string, targetName: string, ip?: string) => void;
  closeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: TerminalSession['status'], errorMessage?: string) => void;

  // Focus & selection
  setActiveSession: (sessionId: string | null) => void;

  // Layout
  maximizeSession: (sessionId: string) => void;
  restoreLayout: () => void;
  toggleMaximize: (sessionId: string) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  swapWithMaximized: (sessionId: string) => void;
}
