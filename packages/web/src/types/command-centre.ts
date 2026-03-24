// Command Centre Type Definitions

export interface TerminalSession {
  id: string;
  type: 'vm' | 'container';
  targetId: string;           // VM ID or container ID
  targetName: string;         // Display name
  targetIp?: string;          // For VMs
  shell: string;
  createdAt: Date;
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';
  errorMessage?: string;
  tmuxState?: 'connected' | 'detached' | 'unavailable';
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

// View modes for CommandCentre
export type ViewMode = 'grid' | 'canvas';

// Worktree node for canvas view
export interface WorktreeNode {
  id: string;
  sandboxId: string;          // underlying sandbox/container
  sessionId?: string;         // linked terminal session (if opened)
  branch: string;             // git branch name
  worktreePath: string;       // path inside container
  parentNodeId: string | null; // null = root/main node
  status: 'creating' | 'ready' | 'merging' | 'merged' | 'error';
  ports: Array<{ container: number; host: number }>;
  position: { x: number; y: number }; // canvas position
  size: { width: number; height: number }; // canvas node size
  /** Backend type — determines terminal connection method (SSH for VMs, docker exec for Docker) */
  backendType?: 'docker' | 'firecracker' | 'daytona' | 'aws' | 'azure' | 'gcp' | 'digitalocean' | 'linode';
  /** Guest IP for VM/cloud backends (required for SSH terminal connections) */
  ip?: string;
  /** Display name of the sandbox (e.g., "my-dev-vm") */
  sandboxName?: string;
  /** Current working directory reported by the shell (persisted across remounts) */
  cwd?: string;
  /** Whether a git repo with commits was detected (persisted across remounts) */
  inGitRepo?: boolean;
  /** Terminal font size (persisted across focused-mode swaps) */
  nodeFontSize?: number;
  /** User-defined label (overrides sandbox name in display) */
  label?: string;
  /** If set, attach to this existing tmux session instead of creating a new one */
  attachTmuxSession?: string;
}

// Workspace for organizing canvas nodes
export interface Workspace {
  id: string;
  name: string;
  nodeIds: string[];
}

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

  // View mode
  viewMode: ViewMode;               // grid or canvas view

  // UI settings
  fontSize: number;                 // Terminal font size in pixels
  sidebarWidth: number;             // Preview sidebar width in pixels
}

export interface CommandCentreContextValue {
  state: CommandCentreState;

  // Session management
  createSession: (type: 'vm' | 'container', targetId: string, targetName: string, ip?: string) => void;
  closeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: TerminalSession['status'], errorMessage?: string, tmuxState?: TerminalSession['tmuxState']) => void;

  // Focus & selection
  setActiveSession: (sessionId: string | null) => void;

  // Layout
  setSplitLayout: (layout: SplitLayout) => void;

  // Move sessions between main area and sidebar
  focusSession: (sessionId: string) => void;      // Move to main area (append)
  focusSessionAtIndex: (sessionId: string, index: number) => void; // Move to main at specific position
  unfocusSession: (sessionId: string) => void;    // Move to sidebar
  swapFocus: (focusedId: string, unfocusedId: string) => void; // Swap focused/unfocused sessions
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

  // Reorder sessions (drag and drop)
  reorderSessions: (fromIndex: number, toIndex: number) => void;
  reorderFocusedSessions: (fromIndex: number, toIndex: number) => void;

  // View mode
  setViewMode: (mode: ViewMode) => void;
}
