import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import {
  X,
  TerminalSquare,
  Loader2,
  PanelRight,
  PanelBottom,
  GripVertical,
  GripHorizontal,
  Rows2,
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { getTerminalTheme, getTerminalBgColor, getStoredTerminalThemeMode, type TerminalThemeMode } from '../lib/terminal-themes';
import { useTheme } from '../hooks/useTheme';

// Types
export type PanelPosition = 'right' | 'bottom';
export type TerminalType = 'vm' | 'container' | 'daytona' | 'aws';

interface TerminalTab {
  id: string;
  name: string;
  type: TerminalType;
  // For VMs
  vmId?: string;
  vmIp?: string;
  // For containers
  containerId?: string;
  // For Daytona
  sandboxId?: string;
  // For AWS
  instanceId?: string;
  publicIp?: string;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';
  errorMessage?: string;
  retryCount?: number;
  tmuxState?: 'connected' | 'detached' | 'unavailable';
}

interface TerminalPanelContextType {
  isOpen: boolean;
  position: PanelPosition;
  tabs: TerminalTab[];
  activeTabId: string | null;
  size: number;
  isResizing: boolean;
  openTerminal: (vmId: string, vmName: string, vmIp: string) => void;
  openContainerTerminal: (containerId: string, containerName: string) => void;
  openDaytonaTerminal: (sandboxId: string, sandboxName: string) => void;
  openAwsTerminal: (instanceId: string, sandboxName: string, publicIp: string) => void;
  closeTerminal: (tabId: string) => void;
  closePanel: () => void;
  setPosition: (position: PanelPosition) => void;
  setActiveTab: (tabId: string) => void;
}

const TerminalPanelContext = createContext<TerminalPanelContextType | null>(null);

export function useTerminalPanel() {
  const context = useContext(TerminalPanelContext);
  if (!context) {
    throw new Error('useTerminalPanel must be used within TerminalPanelProvider');
  }
  return context;
}

const TERMINAL_POSITION_KEY = 'handler-terminal-position';

// Determine default position based on screen size
function getDefaultPosition(): PanelPosition {
  // Check localStorage first
  const stored = localStorage.getItem(TERMINAL_POSITION_KEY);
  if (stored === 'right' || stored === 'bottom') {
    return stored;
  }
  // Default to right for screens 1920px or wider, otherwise bottom
  return window.innerWidth >= 1920 ? 'right' : 'bottom';
}

// Provider component
export function TerminalPanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPositionState] = useState<PanelPosition>(getDefaultPosition);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Default size: 700 for right panel, 350 for bottom
  const [size, setSize] = useState(() => getDefaultPosition() === 'right' ? 700 : 350);
  const [isResizing, setIsResizing] = useState(false);

  // Persist position changes to localStorage and adjust size for new position
  const setPosition = useCallback((newPosition: PanelPosition) => {
    setPositionState(newPosition);
    localStorage.setItem(TERMINAL_POSITION_KEY, newPosition);
    // Adjust size to appropriate default for new position
    setSize(newPosition === 'right' ? 700 : 350);
  }, []);

  const openTerminal = useCallback((vmId: string, vmName: string, vmIp: string) => {
    // Check if terminal for this VM already exists
    const existingTab = tabs.find(t => t.type === 'vm' && t.vmId === vmId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setIsOpen(true);
      return;
    }

    const newTab: TerminalTab = {
      id: `term-vm-${vmId}-${Date.now()}`,
      name: vmName,
      type: 'vm',
      vmId,
      vmIp,
      connectionState: 'connecting',
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setIsOpen(true);
  }, [tabs]);

  const openContainerTerminal = useCallback((containerId: string, containerName: string) => {
    // Check if terminal for this container already exists
    const existingTab = tabs.find(t => t.type === 'container' && t.containerId === containerId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setIsOpen(true);
      return;
    }

    const newTab: TerminalTab = {
      id: `term-container-${containerId}-${Date.now()}`,
      name: containerName,
      type: 'container',
      containerId,
      connectionState: 'connecting',
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setIsOpen(true);
  }, [tabs]);

  const openDaytonaTerminal = useCallback((sandboxId: string, sandboxName: string) => {
    // Check if terminal for this Daytona sandbox already exists
    const existingTab = tabs.find(t => t.type === 'daytona' && t.sandboxId === sandboxId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setIsOpen(true);
      return;
    }

    const newTab: TerminalTab = {
      id: `term-daytona-${sandboxId}-${Date.now()}`,
      name: sandboxName,
      type: 'daytona',
      sandboxId,
      connectionState: 'connecting',
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setIsOpen(true);
  }, [tabs]);

  const openAwsTerminal = useCallback((instanceId: string, sandboxName: string, publicIp: string) => {
    // Check if terminal for this AWS instance already exists
    const existingTab = tabs.find(t => t.type === 'aws' && t.instanceId === instanceId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setIsOpen(true);
      return;
    }

    const newTab: TerminalTab = {
      id: `term-aws-${instanceId}-${Date.now()}`,
      name: sandboxName,
      type: 'aws',
      instanceId,
      publicIp,
      connectionState: 'connecting',
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setIsOpen(true);
  }, [tabs]);

  const closeTerminal = useCallback((tabId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (newTabs.length === 0) {
        setIsOpen(false);
        setActiveTabId(null);
      } else if (activeTabId === tabId) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updateTabState = useCallback((tabId: string, state: Partial<TerminalTab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...state } : t));
  }, []);

  return (
    <TerminalPanelContext.Provider value={{
      isOpen,
      position,
      tabs,
      activeTabId,
      size,
      isResizing,
      openTerminal,
      openContainerTerminal,
      openDaytonaTerminal,
      openAwsTerminal,
      closeTerminal,
      closePanel,
      setPosition,
      setActiveTab: setActiveTabId,
    }}>
      {children}
      {isOpen && (
        <TerminalPanelUI
          tabs={tabs}
          activeTabId={activeTabId}
          position={position}
          size={size}
          isResizing={isResizing}
          onSizeChange={setSize}
          onResizingChange={setIsResizing}
          onTabClose={closeTerminal}
          onTabSelect={setActiveTabId}
          onClose={closePanel}
          onPositionChange={setPosition}
          onTabStateChange={updateTabState}
        />
      )}
    </TerminalPanelContext.Provider>
  );
}

// Terminal Panel UI
interface TerminalPanelUIProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  position: PanelPosition;
  size: number;
  isResizing: boolean;
  onSizeChange: (size: number) => void;
  onResizingChange: (isResizing: boolean) => void;
  onTabClose: (tabId: string) => void;
  onTabSelect: (tabId: string) => void;
  onClose: () => void;
  onPositionChange: (position: PanelPosition) => void;
  onTabStateChange: (tabId: string, state: Partial<TerminalTab>) => void;
}

interface SplitPane {
  id: string;
  tabIds: string[];
  activeTabId: string;
}

function TerminalPanelUI({
  tabs,
  activeTabId,
  position,
  size,
  isResizing,
  onSizeChange,
  onResizingChange,
  onTabClose,
  onTabSelect,
  onClose,
  onPositionChange,
  onTabStateChange,
}: TerminalPanelUIProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitPane[]>([]);
  const [dragTabId, setDragTabId] = useState<string | null>(null);

  // Initialize splits when tabs change
  useEffect(() => {
    if (!splitMode) return;
    setSplits(prev => {
      if (prev.length === 0 && tabs.length > 0) {
        return [{ id: 'split-1', tabIds: tabs.map(t => t.id), activeTabId: activeTabId || tabs[0].id }];
      }
      // Ensure new tabs are assigned to a split
      const assignedTabs = new Set(prev.flatMap(s => s.tabIds));
      const unassigned = tabs.filter(t => !assignedTabs.has(t.id));
      if (unassigned.length > 0 && prev.length > 0) {
        const lastSplit = prev[prev.length - 1];
        return prev.map(s => s.id === lastSplit.id
          ? { ...s, tabIds: [...s.tabIds, ...unassigned.map(t => t.id)] }
          : s
        );
      }
      // Remove closed tabs from splits
      const currentTabIds = new Set(tabs.map(t => t.id));
      const updated = prev.map(s => {
        const filtered = s.tabIds.filter(id => currentTabIds.has(id));
        const active = filtered.includes(s.activeTabId) ? s.activeTabId : filtered[0] || '';
        return { ...s, tabIds: filtered, activeTabId: active };
      }).filter(s => s.tabIds.length > 0);
      return updated.length > 0 ? updated : [];
    });
  }, [tabs, splitMode, activeTabId]);

  const handleToggleSplit = () => {
    if (!splitMode) {
      // Entering split mode: create one split with all tabs, then add a second if possible
      setSplitMode(true);
      if (tabs.length >= 2) {
        const firstTab = activeTabId || tabs[0].id;
        const otherTabs = tabs.filter(t => t.id !== firstTab);
        setSplits([
          { id: 'split-1', tabIds: [firstTab], activeTabId: firstTab },
          { id: 'split-2', tabIds: otherTabs.map(t => t.id), activeTabId: otherTabs[0].id },
        ]);
      } else {
        setSplits([{ id: 'split-1', tabIds: tabs.map(t => t.id), activeTabId: activeTabId || tabs[0].id }]);
      }
    } else {
      // Exiting split mode
      setSplitMode(false);
      setSplits([]);
    }
  };

  const handleSplitTabSelect = (splitId: string, tabId: string) => {
    setSplits(prev => prev.map(s => s.id === splitId ? { ...s, activeTabId: tabId } : s));
    onTabSelect(tabId);
  };

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    setDragTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetSplitId: string) => {
    e.preventDefault();
    const tabId = dragTabId;
    if (!tabId) return;

    setSplits(prev => {
      // Find current split for the tab
      const sourceSplit = prev.find(s => s.tabIds.includes(tabId));
      if (!sourceSplit || sourceSplit.id === targetSplitId) return prev;

      return prev.map(s => {
        if (s.id === sourceSplit.id) {
          const newTabIds = s.tabIds.filter(id => id !== tabId);
          const newActive = newTabIds.includes(s.activeTabId) ? s.activeTabId : newTabIds[0] || '';
          return { ...s, tabIds: newTabIds, activeTabId: newActive };
        }
        if (s.id === targetSplitId) {
          return { ...s, tabIds: [...s.tabIds, tabId], activeTabId: tabId };
        }
        return s;
      }).filter(s => s.tabIds.length > 0);
    });
    setDragTabId(null);
  };

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onResizingChange(true);
  }, [onResizingChange]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (position === 'bottom') {
        const newSize = window.innerHeight - e.clientY;
        onSizeChange(Math.max(200, Math.min(newSize, window.innerHeight - 100)));
      } else {
        const newSize = window.innerWidth - e.clientX;
        onSizeChange(Math.max(300, Math.min(newSize, window.innerWidth - 300)));
      }
    };

    const handleMouseUp = () => {
      onResizingChange(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, position, onSizeChange, onResizingChange]);

  const panelClasses = position === 'bottom'
    ? 'fixed bottom-0 left-52 right-0 border-t'
    : 'fixed top-0 right-0 bottom-0 border-l';

  return (
    <div
      ref={panelRef}
      className={`${panelClasses} z-40 bg-[hsl(var(--bg-base))] border-[hsl(var(--border))] ${
        position === 'bottom' ? 'flex flex-col' : 'flex flex-row'
      } ${!isResizing ? 'transition-[width,height] duration-200 ease-out' : ''}`}
      style={position === 'bottom' ? { height: size } : { width: size }}
    >
      {/* Resize handle - full edge with visual separation */}
      {position === 'right' && (
        <div
          className="w-2 h-full flex-shrink-0 cursor-ew-resize hover:bg-[hsl(var(--cyan)/0.3)] bg-[hsl(var(--bg-elevated))] border-l border-[hsl(var(--border))] transition-colors group flex items-center justify-center"
          onMouseDown={handleMouseDown}
        >
          <GripVertical className="h-6 w-3 text-[hsl(var(--text-muted))] opacity-30 group-hover:opacity-100 transition-opacity" />
        </div>
      )}

      {/* Main content wrapper */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Resize handle for bottom position */}
        {position === 'bottom' && (
          <div
            className="h-1.5 w-full flex-shrink-0 cursor-ns-resize hover:bg-[hsl(var(--cyan)/0.5)] bg-[hsl(var(--border))] transition-colors group flex items-center justify-center"
            onMouseDown={handleMouseDown}
          >
            <GripHorizontal className="h-3 w-6 text-[hsl(var(--text-muted))] opacity-30 group-hover:opacity-100 transition-opacity" />
          </div>
        )}

        {/* Header with tabs */}
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          {/* Tabs */}
          <div className="flex items-center overflow-x-auto flex-1 min-w-0">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`group flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-[hsl(var(--border))] whitespace-nowrap ${
                  tab.id === activeTabId
                    ? 'bg-[hsl(var(--bg-base))] text-[hsl(var(--text-primary))]'
                    : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
                }`}
                onClick={() => onTabSelect(tab.id)}
              >
                <TerminalSquare className={`h-3.5 w-3.5 ${
                  tab.connectionState === 'connected' ? 'text-[hsl(var(--green))]' :
                  tab.connectionState === 'connecting' || tab.connectionState === 'reconnecting' ? 'text-[hsl(var(--amber))]' :
                  'text-[hsl(var(--red))]'
                }`} />
                <span className="max-w-[120px] truncate">{tab.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                  className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[hsl(var(--bg-overlay))] rounded"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 px-2">
            <button
              onClick={() => onPositionChange(position === 'bottom' ? 'right' : 'bottom')}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
              title={position === 'bottom' ? 'Move to right' : 'Move to bottom'}
            >
              {position === 'bottom' ? (
                <PanelRight className="h-3.5 w-3.5" />
              ) : (
                <PanelBottom className="h-3.5 w-3.5" />
              )}
            </button>
            {tabs.length >= 2 && (
              <button
                onClick={handleToggleSplit}
                className={`p-1.5 hover:bg-[hsl(var(--bg-elevated))] ${
                  splitMode ? 'text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
                }`}
                title={splitMode ? 'Exit split view' : 'Split view'}
              >
                <Rows2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
              title="Close panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal content */}
        {splitMode && splits.length > 1 ? (
          /* Split view: vertical stack of split panes */
          <div className="flex-1 flex flex-col overflow-hidden">
            {splits.map((split, idx) => (
              <div
                key={split.id}
                className={`flex-1 flex flex-col min-h-0 ${idx > 0 ? 'border-t border-[hsl(var(--border))]' : ''}`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, split.id)}
              >
                {/* Mini tab bar for this split */}
                <div className="flex items-center bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))] overflow-x-auto flex-shrink-0">
                  {split.tabIds.map(tabId => {
                    const tab = tabs.find(t => t.id === tabId);
                    if (!tab) return null;
                    return (
                      <div
                        key={tabId}
                        draggable
                        onDragStart={(e) => handleDragStart(e, tabId)}
                        className={`flex items-center gap-1.5 px-2 py-1 text-[10px] cursor-pointer border-r border-[hsl(var(--border))] whitespace-nowrap ${
                          tabId === split.activeTabId
                            ? 'bg-[hsl(var(--bg-base))] text-[hsl(var(--text-primary))]'
                            : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-base))]'
                        }`}
                        onClick={() => handleSplitTabSelect(split.id, tabId)}
                      >
                        <TerminalSquare className={`h-3 w-3 ${
                          tab.connectionState === 'connected' ? 'text-[hsl(var(--green))]' :
                          tab.connectionState === 'connecting' || tab.connectionState === 'reconnecting' ? 'text-[hsl(var(--amber))]' :
                          'text-[hsl(var(--red))]'
                        }`} />
                        <span className="max-w-[80px] truncate">{tab.name}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Terminal for this split's active tab */}
                <div className="flex-1 overflow-hidden relative" style={{ contain: 'strict' }}>
                  {tabs.map(tab => (
                    <div
                      key={tab.id}
                      className={`absolute inset-0 ${tab.id === split.activeTabId ? 'block' : 'hidden'}`}
                      style={{ contain: 'layout paint' }}
                    >
                      <TerminalInstance
                        tab={tab}
                        onStateChange={(state) => onTabStateChange(tab.id, state)}
                        onClose={() => onTabClose(tab.id)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Normal single-pane view */
          <div className="flex-1 overflow-hidden relative" style={{ contain: 'strict' }}>
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`absolute inset-0 ${tab.id === activeTabId ? 'block' : 'hidden'}`}
                style={{ contain: 'layout paint' }}
              >
                <TerminalInstance
                  tab={tab}
                  onStateChange={(state) => onTabStateChange(tab.id, state)}
                  onClose={() => onTabClose(tab.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Individual terminal instance
interface TerminalInstanceProps {
  tab: TerminalTab;
  onStateChange: (state: Partial<TerminalTab>) => void;
  onClose?: () => void;
}

// Retry configuration
const MAX_RETRY_COUNT = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds

function TerminalInstance({ tab, onStateChange, onClose }: TerminalInstanceProps) {
  const { isDark: systemIsDark } = useTheme();
  const [terminalThemeMode, setTerminalThemeMode] = useState<TerminalThemeMode>(getStoredTerminalThemeMode);
  const terminalIsDark = terminalThemeMode === 'system' ? systemIsDark : terminalThemeMode === 'dark';
  const terminalIsDarkRef = useRef(terminalIsDark);
  terminalIsDarkRef.current = terminalIsDark;

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasConnectedRef = useRef(false); // Track if we ever successfully connected

  const getWsUrl = useCallback(() => {
    const apiPort = (window as unknown as { __API_PORT__?: number }).__API_PORT__ || 4001;
    // Use same hostname as current page for remote access support
    const hostname = window.location.hostname || 'localhost';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${hostname}:${apiPort}/ws/terminal`;
  }, []);

  // Stable callback refs to avoid re-running effect
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!terminalRef.current) return;

    // Local closure variable — each effect invocation gets its own `disposed`.
    // This prevents React Strict Mode double-mount from triggering stale
    // onclose handlers that set state to 'disconnected'.
    let disposed = false;
    retryCountRef.current = 0;
    wasConnectedRef.current = false;

    // Create terminal instance with theme matching the terminal theme mode
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: getTerminalTheme(terminalIsDarkRef.current),
      allowProposedApi: true,
    });

    // Add fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Add web links addon
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    // Open terminal
    term.open(terminalRef.current);
    xtermRef.current = term;

    // Fit helper that uses current wsRef
    const fitAndResize = () => {
      if (disposed) return;
      try {
        fitAddon.fit();
        // Send resize to server so shell redraws with correct dimensions
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: term.cols,
            rows: term.rows,
          }));
        }
      } catch (e) {
        console.warn('[Terminal] Fit failed:', e);
      }
    };

    // Calculate retry delay with exponential backoff
    const getRetryDelay = (retryCount: number): number => {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      return Math.min(delay, MAX_RETRY_DELAY);
    };

    // Function to create and connect WebSocket
    const connectWebSocket = () => {
      if (disposed) return;

      // Close existing connection if any
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore close errors
        }
      }

      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        // Reset retry count on successful connection
        retryCountRef.current = 0;

        // Do an initial fit before sending start message
        try {
          fitAddon.fit();
        } catch (e) {
          // Ignore fit errors on startup
        }

        // Send appropriate start message based on terminal type
        if (tab.type === 'container') {
          // Container terminal - uses docker exec
          ws.send(JSON.stringify({
            type: 'start',
            containerId: tab.containerId,
            shell: '/bin/bash',
            cols: term.cols,
            rows: term.rows,
          }));
        } else if (tab.type === 'daytona') {
          // Daytona terminal - uses Daytona SSH access API
          ws.send(JSON.stringify({
            type: 'start-daytona',
            sandboxId: tab.sandboxId,
            cols: term.cols,
            rows: term.rows,
          }));
        } else if (tab.type === 'aws') {
          // AWS terminal - uses SSH with stored private key
          ws.send(JSON.stringify({
            type: 'start-aws',
            instanceId: tab.instanceId,
            publicIp: tab.publicIp,
            cols: term.cols,
            rows: term.rows,
          }));
        } else {
          // VM terminal - uses SSH
          ws.send(JSON.stringify({
            type: 'start-vm',
            vmId: tab.vmId,
            vmIp: tab.vmIp,
            shell: '/bin/bash',
            cols: term.cols,
            rows: term.rows,
          }));
        }
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'connected':
              wasConnectedRef.current = true;
              onStateChangeRef.current({ connectionState: 'connected', retryCount: 0, tmuxState: msg.tmuxSession ? 'connected' : undefined });
              term.focus();
              // Fit again after connection and send resize to ensure shell has correct size
              setTimeout(fitAndResize, 50);
              setTimeout(fitAndResize, 200);
              break;
            case 'output':
              term.write(msg.data);
              break;
            case 'exit':
              onStateChangeRef.current({ connectionState: 'disconnected' });
              term.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
              if (onCloseRef.current) {
                setTimeout(() => onCloseRef.current?.(), 800);
              }
              break;
            case 'session-update':
              // Server detected tmux state change via stdout marker
              if (msg.tmuxState) {
                onStateChangeRef.current({ tmuxState: msg.tmuxState });
              }
              break;
            case 'error':
              onStateChangeRef.current({ connectionState: 'error', errorMessage: msg.message });
              term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
              break;
          }
        } catch {
          // Handle non-JSON messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;

        // Only retry if we had a successful connection before (server restart scenario)
        if (wasConnectedRef.current && retryCountRef.current < MAX_RETRY_COUNT) {
          retryCountRef.current++;
          const delay = getRetryDelay(retryCountRef.current - 1);
          onStateChangeRef.current({
            connectionState: 'reconnecting',
            retryCount: retryCountRef.current,
          });
          term.write(`\r\n\x1b[33m[Connection lost. Reconnecting in ${delay / 1000}s... (attempt ${retryCountRef.current}/${MAX_RETRY_COUNT})]\x1b[0m\r\n`);

          retryTimeoutRef.current = setTimeout(() => {
            if (!disposed) {
              connectWebSocket();
            }
          }, delay);
        } else if (wasConnectedRef.current) {
          onStateChangeRef.current({ connectionState: 'disconnected' });
          term.write('\r\n\x1b[31m[Connection lost. Max retries exceeded.]\x1b[0m\r\n');
        } else {
          onStateChangeRef.current({ connectionState: 'disconnected' });
        }
      };

      ws.onerror = () => {
        if (disposed) return;
        // Error will be followed by close, so we handle retry in onclose
        // Only show error state if we haven't connected yet
        if (!wasConnectedRef.current && retryCountRef.current === 0) {
          onStateChangeRef.current({ connectionState: 'error', errorMessage: 'Connection failed' });
        }
      };
    };

    // Initial connection
    connectWebSocket();

    // Schedule multiple fit attempts - these will also send resize messages
    const fitTimeout1 = setTimeout(fitAndResize, 100);
    const fitTimeout2 = setTimeout(fitAndResize, 300);
    const fitTimeout3 = setTimeout(fitAndResize, 600);

    // Also fit on next animation frame for good measure
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(fitAndResize);
    });

    // Handle terminal input
    const dataDisposable = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize with debounce
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (disposed) return;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            }));
          }
        } catch (e) {
          console.warn('[Terminal] Resize failed:', e);
        }
      }, 100);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      disposed = true;
      clearTimeout(fitTimeout1);
      clearTimeout(fitTimeout2);
      clearTimeout(fitTimeout3);
      cancelAnimationFrame(rafId);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [tab.vmId, tab.vmIp, tab.type, tab.containerId, tab.sandboxId, tab.instanceId, tab.publicIp, getWsUrl]);

  // React to terminal theme changes
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getTerminalTheme(terminalIsDark);
    }
  }, [terminalIsDark]);

  // Listen for terminal theme mode changes from settings
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<{ mode: TerminalThemeMode }>).detail.mode;
      setTerminalThemeMode(mode);
    };
    window.addEventListener('handler-terminal-theme-mode', handler);
    return () => window.removeEventListener('handler-terminal-theme-mode', handler);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(var(--bg-surface))] border-b border-[hsl(var(--border))] text-[10px]">
        <span className={`flex items-center gap-1.5 ${
          tab.connectionState === 'connected' ? 'text-[hsl(var(--green))]' :
          tab.connectionState === 'connecting' || tab.connectionState === 'reconnecting' ? 'text-[hsl(var(--amber))]' :
          'text-[hsl(var(--red))]'
        }`}>
          {(tab.connectionState === 'connecting' || tab.connectionState === 'reconnecting') && <Loader2 className="h-3 w-3 animate-spin" />}
          <span className="uppercase tracking-wider">
            {tab.connectionState}
            {tab.connectionState === 'reconnecting' && tab.retryCount && ` (${tab.retryCount}/${MAX_RETRY_COUNT})`}
          </span>
        </span>
        <span className="text-[hsl(var(--text-muted))]">|</span>
        <span className="text-[hsl(var(--text-secondary))]">
          {tab.type === 'container' ? `dev@${tab.name}` : tab.type === 'daytona' ? `daytona@${tab.name}` : tab.type === 'aws' ? `ubuntu@${tab.publicIp}` : `agent@${tab.vmIp}`}
        </span>
        {tab.tmuxState && (
          <>
            <span className="text-[hsl(var(--text-muted))]">|</span>
            <span className="relative group/tmux">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider cursor-default transition-colors ${
                tab.tmuxState === 'connected'
                  ? 'bg-[hsl(var(--green)/0.15)] text-[hsl(var(--green))]'
                  : tab.tmuxState === 'detached'
                  ? 'bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))]'
                  : 'bg-[hsl(var(--red)/0.15)] text-[hsl(var(--red))]'
              }`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  tab.tmuxState === 'connected'
                    ? 'bg-[hsl(var(--green))]'
                    : tab.tmuxState === 'detached'
                    ? 'bg-[hsl(var(--amber))]'
                    : 'bg-[hsl(var(--red))]'
                }`} />
                tmux
              </span>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-[hsl(var(--bg-overlay))] border border-[hsl(var(--border))] rounded shadow-lg text-[10px] text-[hsl(var(--text-secondary))] whitespace-nowrap opacity-0 group-hover/tmux:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
                {tab.tmuxState === 'connected' && 'Session persistence active'}
                {tab.tmuxState === 'detached' && 'Detached from tmux session'}
                {tab.tmuxState === 'unavailable' && 'tmux not installed — no persistence'}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[hsl(var(--border))]" />
              </div>
            </span>
          </>
        )}
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 p-1"
        style={{ backgroundColor: getTerminalBgColor(terminalIsDark) }}
      />

      {/* Error overlay */}
      {tab.connectionState === 'error' && tab.errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--red)/0.3)] max-w-sm text-center">
            <p className="text-xs text-[hsl(var(--red))] mb-2">{tab.errorMessage}</p>
            <p className="text-[10px] text-[hsl(var(--text-muted))]">
              Make sure the VM is running and SSH is available
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
