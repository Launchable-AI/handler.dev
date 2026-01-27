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
  Plus,
  Minus,
  GripVertical,
  GripHorizontal
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

// Types
export type PanelPosition = 'right' | 'bottom';
export type TerminalType = 'vm' | 'container';

interface TerminalTab {
  id: string;
  name: string;
  type: TerminalType;
  // For VMs
  vmId?: string;
  vmIp?: string;
  // For containers
  containerId?: string;
  isDevNode?: boolean;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

interface TerminalPanelContextType {
  isOpen: boolean;
  position: PanelPosition;
  tabs: TerminalTab[];
  activeTabId: string | null;
  size: number;
  openTerminal: (vmId: string, vmName: string, vmIp: string) => void;
  openContainerTerminal: (containerId: string, containerName: string, isDevNode?: boolean) => void;
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

const TERMINAL_POSITION_KEY = 'caisson-terminal-position';

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
  const [size, setSize] = useState(350);

  // Persist position changes to localStorage
  const setPosition = useCallback((newPosition: PanelPosition) => {
    setPositionState(newPosition);
    localStorage.setItem(TERMINAL_POSITION_KEY, newPosition);
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

  const openContainerTerminal = useCallback((containerId: string, containerName: string, isDevNode?: boolean) => {
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
      isDevNode: isDevNode ?? true,
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
      openTerminal,
      openContainerTerminal,
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
          onSizeChange={setSize}
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
  onSizeChange: (size: number) => void;
  onTabClose: (tabId: string) => void;
  onTabSelect: (tabId: string) => void;
  onClose: () => void;
  onPositionChange: (position: PanelPosition) => void;
  onTabStateChange: (tabId: string, state: Partial<TerminalTab>) => void;
}

function TerminalPanelUI({
  tabs,
  activeTabId,
  position,
  size,
  onSizeChange,
  onTabClose,
  onTabSelect,
  onClose,
  onPositionChange,
  onTabStateChange,
}: TerminalPanelUIProps) {
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

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
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, position, onSizeChange]);

  const panelClasses = position === 'bottom'
    ? 'fixed bottom-0 left-52 right-0 border-t'
    : 'fixed top-0 right-0 bottom-0 border-l';

  return (
    <div
      ref={panelRef}
      className={`${panelClasses} z-40 bg-[hsl(var(--bg-base))] border-[hsl(var(--border))] ${
        position === 'bottom' ? 'flex flex-col' : 'flex flex-row'
      }`}
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
                  tab.connectionState === 'connecting' ? 'text-[hsl(var(--amber))]' :
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
            <button
              onClick={() => onSizeChange(Math.min(size + 100, position === 'bottom' ? 600 : 800))}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
              title="Expand"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onSizeChange(Math.max(size - 100, position === 'bottom' ? 200 : 300))}
              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
              title="Shrink"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
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
        <div className="flex-1 overflow-hidden relative">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`absolute inset-0 ${tab.id === activeTabId ? 'block' : 'hidden'}`}
            >
              <TerminalInstance
                tab={tab}
                onStateChange={(state) => onTabStateChange(tab.id, state)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Individual terminal instance
interface TerminalInstanceProps {
  tab: TerminalTab;
  onStateChange: (state: Partial<TerminalTab>) => void;
}

function TerminalInstance({ tab, onStateChange }: TerminalInstanceProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isDisposedRef = useRef(false);

  const getWsUrl = useCallback(() => {
    const apiPort = (window as unknown as { __API_PORT__?: number }).__API_PORT__ || 4001;
    // Use same hostname as current page for remote access support
    const hostname = window.location.hostname || 'localhost';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${hostname}:${apiPort}/ws/terminal`;
  }, []);

  // Stable callback ref to avoid re-running effect
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    if (!terminalRef.current) return;

    isDisposedRef.current = false;

    // Create terminal instance with theme matching the UI
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: 'hsl(220 20% 6%)',
        foreground: 'hsl(220 10% 85%)',
        cursor: 'hsl(190 90% 60%)',
        cursorAccent: 'hsl(220 20% 6%)',
        selectionBackground: 'hsl(190 90% 60% / 0.3)',
        selectionForeground: '#ffffff',
        black: 'hsl(220 20% 10%)',
        red: 'hsl(0 70% 65%)',
        green: 'hsl(140 60% 55%)',
        yellow: 'hsl(40 80% 55%)',
        blue: 'hsl(210 80% 65%)',
        magenta: 'hsl(280 60% 70%)',
        cyan: 'hsl(180 60% 55%)',
        white: 'hsl(220 10% 85%)',
        brightBlack: 'hsl(220 15% 35%)',
        brightRed: 'hsl(0 80% 70%)',
        brightGreen: 'hsl(140 70% 65%)',
        brightYellow: 'hsl(40 90% 65%)',
        brightBlue: 'hsl(210 90% 75%)',
        brightMagenta: 'hsl(280 70% 80%)',
        brightCyan: 'hsl(180 70% 65%)',
        brightWhite: 'hsl(220 5% 95%)',
      },
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

    // Initial fit - multiple attempts to handle CSS layout timing
    // The first fit may happen before flex layout is complete
    const fitAndResize = () => {
      if (isDisposedRef.current) return;
      try {
        fitAddon.fit();
        // Send resize to server so shell redraws with correct dimensions
        if (ws.readyState === WebSocket.OPEN) {
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

    // Connect WebSocket first
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    // Schedule multiple fit attempts - these will also send resize messages
    const fitTimeout1 = setTimeout(fitAndResize, 100);
    const fitTimeout2 = setTimeout(fitAndResize, 300);
    const fitTimeout3 = setTimeout(fitAndResize, 600);

    // Also fit on next animation frame for good measure
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(fitAndResize);
    });

    ws.onopen = () => {
      if (isDisposedRef.current) return;
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
          isDevNode: tab.isDevNode,
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
      if (isDisposedRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'connected':
            onStateChangeRef.current({ connectionState: 'connected' });
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
      if (isDisposedRef.current) return;
      onStateChangeRef.current({ connectionState: 'disconnected' });
    };

    ws.onerror = () => {
      if (isDisposedRef.current) return;
      onStateChangeRef.current({ connectionState: 'error', errorMessage: 'Connection failed' });
    };

    // Handle terminal input
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize with debounce
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (isDisposedRef.current) return;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (isDisposedRef.current) return;
        try {
          fitAddon.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            }));
          }
        } catch (e) {
          console.warn('[Terminal] Resize failed:', e);
        }
      }, 50);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      isDisposedRef.current = true;
      clearTimeout(fitTimeout1);
      clearTimeout(fitTimeout2);
      clearTimeout(fitTimeout3);
      cancelAnimationFrame(rafId);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [tab.vmId, tab.vmIp, tab.type, tab.containerId, tab.isDevNode, getWsUrl]);

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(var(--bg-surface))] border-b border-[hsl(var(--border))] text-[10px]">
        <span className={`flex items-center gap-1.5 ${
          tab.connectionState === 'connected' ? 'text-[hsl(var(--green))]' :
          tab.connectionState === 'connecting' ? 'text-[hsl(var(--amber))]' :
          'text-[hsl(var(--red))]'
        }`}>
          {tab.connectionState === 'connecting' && <Loader2 className="h-3 w-3 animate-spin" />}
          <span className="uppercase tracking-wider">{tab.connectionState}</span>
        </span>
        <span className="text-[hsl(var(--text-muted))]">|</span>
        <span className="text-[hsl(var(--text-secondary))]">
          {tab.type === 'container' ? `dev@${tab.name}` : `agent@${tab.vmIp}`}
        </span>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 p-1"
        style={{ backgroundColor: 'hsl(220 20% 6%)' }}
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
