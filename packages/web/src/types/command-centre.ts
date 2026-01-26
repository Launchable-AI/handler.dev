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

// Split layouts for main view
export type SplitLayout = 'grid' | 'vertical' | 'horizontal';

export interface CommandCentreState {
  sessions: TerminalSession[];
  layouts: TileLayout[];
  activeSessionId: string | null;

  // Layout
  splitLayout: SplitLayout;         // How to arrange sessions in main area
  focusedSessionIds: string[];      // Sessions in main area (unfocused go to sidebar)

  // Fullscreen/maximize
  isFullscreen: boolean;            // Hide app sidebar/header
  maximizedSessionId: string | null; // Single session takes full view

  // UI settings
  fontSize: number;                 // Terminal font size in pixels
  sidebarWidth: number;             // Preview sidebar width in pixels
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
  setSplitLayout: (layout: SplitLayout) => void;

  // Move sessions between main area and sidebar
  focusSession: (sessionId: string) => void;      // Move to main area
  unfocusSession: (sessionId: string) => void;    // Move to sidebar
  toggleFocus: (sessionId: string) => void;       // Toggle between main/sidebar
  focusAll: () => void;                           // Move all to main
  unfocusAll: () => void;                         // Move all to sidebar (keep one)

  // Font size
  setFontSize: (size: number) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;

  // Sidebar
  setSidebarWidth: (width: number) => void;

  // Fullscreen/maximize
  toggleFullscreen: () => void;
  maximizeSession: (sessionId: string | null) => void;
  toggleMaximize: (sessionId: string) => void;
}
