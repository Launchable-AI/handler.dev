import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  useViewport,
  applyNodeChanges,
  type OnNodesChange,
  type NodeDragHandler,
  type Node,
  BackgroundVariant,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCanvas } from '../../context/CanvasContext';
import { useCommandCentre } from '../../hooks/useCommandCentre';
import { useSandboxes } from '../../hooks/useSandboxes';
import { SandboxNode } from './nodes/SandboxNode';
import { WorktreeEdge } from './nodes/WorktreeEdge';
import { GitLogPanel } from './GitLogPanel';
import { MinimizedNodesSidebar, type MinimizedNodeInfo } from './MinimizedNodesSidebar';
import { Plus, GitBranch, PanelLeftClose, PanelLeftOpen, Crosshair, Trash2, AlignVerticalSpaceAround, AlignVerticalSpaceBetween, LayoutGrid, Columns3, Rows3, LayoutPanelLeft, Terminal, Loader2, Keyboard } from 'lucide-react';
import type { WorktreeNode } from '../../types/command-centre';
import { listTmuxSessions, type TmuxSessionInfo } from '../../api/client';
import { useCanvasShortcuts } from '../../hooks/useCanvasShortcuts';
import { ShortcutsHelpOverlay } from './ShortcutsHelpOverlay';

const nodeTypes = {
  sandbox: SandboxNode,
};

const edgeTypes = {
  worktree: WorktreeEdge,
};

interface CanvasViewProps {
  className?: string;
}

// Inner component that has access to useReactFlow
function CanvasViewInner({ className = '' }: CanvasViewProps) {
  const { state, nodes, edges, addNode, removeNode, updatePosition, updateSize, activeWorkspace, toggleSlimToolbar, restoreNode, setFocusedLayout, setFocusedNodeId, setSelectedNodeId } = useCanvas();
  const { data: sandboxData } = useSandboxes();
  const { state: ccState } = useCommandCentre();
  const { setCenter, fitView } = useReactFlow();
  const viewport = useViewport();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  // Save original node sizes so we can restore them when exiting focused mode
  const preFocusSizesRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  const [activeGitPanel, setActiveGitPanel] = useState<{ nodeId: string; sandboxId: string; cwd?: string } | null>(null);
  // Session picker state for "Add to Canvas"
  const [expandedSandboxId, setExpandedSandboxId] = useState<string | null>(null);
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Auto-close node list panel when Command Centre enters fullscreen
  useEffect(() => {
    if (ccState.isFullscreen) {
      setPanelOpen(false);
    }
  }, [ccState.isFullscreen]);

  // Listen for git panel open events from SandboxNode
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setActiveGitPanel((prev) =>
        prev?.nodeId === detail.nodeId ? null : detail
      );
    };
    window.addEventListener('open-git-panel', handler);
    return () => window.removeEventListener('open-git-panel', handler);
  }, []);

  // Local node state for ReactFlow — synced from context when not dragging.
  // During drag, we apply position changes locally to avoid context churn
  // that rebuilds node objects and remounts terminals.
  const [localNodes, setLocalNodes] = useState<Node[]>(nodes);
  const isDraggingRef = useRef(false);
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const sandboxes = sandboxData?.sandboxes;

  const runningSandboxes = useMemo(
    () => sandboxes?.filter(s => s.status === 'running') || [],
    [sandboxes]
  );

  // All running sandboxes are available — multiple nodes per sandbox are allowed
  const availableSandboxes = runningSandboxes;

  // Visible worktree nodes for the panel list
  const visibleWorktreeNodes = useMemo(() => {
    const activeNodeIds = new Set(activeWorkspace?.nodeIds || []);
    return state.worktreeNodes.filter(n => activeNodeIds.has(n.id));
  }, [state.worktreeNodes, activeWorkspace]);

  // Sandbox name lookup
  const sandboxNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sandboxes || []) map.set(s.id, s.name);
    return map;
  }, [sandboxes]);

  // Focused layout: resolve the effective focused node ID
  const effectiveFocusedId = useMemo(() => {
    if (!state.focusedLayout) return null;
    if (state.focusedNodeId && visibleWorktreeNodes.some(n => n.id === state.focusedNodeId)) {
      return state.focusedNodeId;
    }
    return visibleWorktreeNodes[0]?.id || null;
  }, [state.focusedLayout, state.focusedNodeId, visibleWorktreeNodes]);

  // Sync context nodes into local state when not dragging
  // In focused mode, only show the focused node on the canvas
  useEffect(() => {
    if (!isDraggingRef.current) {
      if (state.focusedLayout && effectiveFocusedId) {
        setLocalNodes(nodes.filter(n => n.id === effectiveFocusedId));
      } else {
        setLocalNodes(nodes);
      }
    }
  }, [nodes, state.focusedLayout, effectiveFocusedId]);

  // Minimized nodes info for the sidebar
  // In focused mode: show all non-focused nodes (regardless of minimize state)
  // In normal mode: show only explicitly minimized nodes
  const minimizedNodesInfo = useMemo((): MinimizedNodeInfo[] => {
    const minimizedSet = new Set(state.minimizedNodeIds);
    const activeNodeIds = new Set(activeWorkspace?.nodeIds || []);
    return state.worktreeNodes
      .filter(n => {
        if (!activeNodeIds.has(n.id)) return false;
        if (state.focusedLayout) return n.id !== effectiveFocusedId;
        return minimizedSet.has(n.id);
      })
      .map(n => ({
        id: n.id,
        sandboxId: n.sandboxId,
        branch: n.branch,
        sandboxName: n.sandboxName || sandboxNameMap.get(n.sandboxId),
        label: n.label,
        backendType: n.backendType,
        ip: n.ip,
        status: n.status,
        claudeStatus: 'off' as const, // Will be updated by monitors
      }));
  }, [state.worktreeNodes, state.minimizedNodeIds, activeWorkspace, sandboxNameMap, state.focusedLayout, effectiveFocusedId]);

  const getDescendantIds = useCallback((parentId: string): string[] => {
    const descendants: string[] = [];
    const queue = [parentId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const node of state.worktreeNodes) {
        if (node.parentNodeId === current && !descendants.includes(node.id)) {
          descendants.push(node.id);
          queue.push(node.id);
        }
      }
    }
    return descendants;
  }, [state.worktreeNodes]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (isDraggingRef.current) {
        // During drag, apply position/dimension changes to local state only.
        // This keeps ReactFlow's visual state in sync without triggering
        // context updates that would rebuild node objects and remount terminals.
        setLocalNodes(prev => applyNodeChanges(changes, prev));
      } else {
        // Not dragging — apply non-position changes normally
        for (const change of changes) {
          if (change.type === 'position' && change.position) {
            updatePosition(change.id, change.position);
          }
          if (change.type === 'dimensions' && change.dimensions && change.resizing) {
            updateSize(change.id, {
              width: change.dimensions.width,
              height: change.dimensions.height,
            });
          }
        }
        // Also apply to local state for immediate visual feedback
        setLocalNodes(prev => applyNodeChanges(changes, prev));
      }
    },
    [updatePosition, updateSize]
  );

  const onNodeDragStart: NodeDragHandler = useCallback((_event, node) => {
    isDraggingRef.current = true;
    prevPositions.current.set(node.id, { ...node.position });
  }, []);

  // Track accumulated deltas for descendants during drag
  const dragDeltaRef = useRef({ dx: 0, dy: 0 });

  const onNodeDrag: NodeDragHandler = useCallback((_event, node) => {
    const prev = prevPositions.current.get(node.id);
    if (!prev) return;

    const dx = node.position.x - prev.x;
    const dy = node.position.y - prev.y;

    if (dx === 0 && dy === 0) return;

    // Accumulate delta for descendants — we'll apply on dragStop
    dragDeltaRef.current.dx += dx;
    dragDeltaRef.current.dy += dy;

    prevPositions.current.set(node.id, { ...node.position });
  }, []);

  const onNodeDragStop: NodeDragHandler = useCallback((_event, node) => {
    isDraggingRef.current = false;

    // Persist final position for the dragged node
    updatePosition(node.id, node.position);

    // Apply accumulated delta to all descendants
    const { dx, dy } = dragDeltaRef.current;
    if (dx !== 0 || dy !== 0) {
      const descendantIds = getDescendantIds(node.id);
      for (const childId of descendantIds) {
        const child = state.worktreeNodes.find(n => n.id === childId);
        if (child) {
          updatePosition(childId, {
            x: child.position.x + dx,
            y: child.position.y + dy,
          });
        }
      }
    }

    dragDeltaRef.current = { dx: 0, dy: 0 };
  }, [updatePosition, getDescendantIds, state.worktreeNodes]);

  const addSandboxToCanvas = (sandbox: { id: string; name: string; backend: string; guestIp?: string }, attachTmuxSession?: string, closeMenu = true) => {
    const nodeId = `wt-${sandbox.id}-${Date.now()}`;
    const newNode: WorktreeNode = {
      id: nodeId,
      sandboxId: sandbox.id,
      branch: 'main',
      worktreePath: '/workspace',
      parentNodeId: null,
      status: 'ready',
      ports: [],
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      size: { width: 650, height: 350 },
      backendType: sandbox.backend as WorktreeNode['backendType'],
      ip: sandbox.guestIp,
      sandboxName: sandbox.name,
      ...(attachTmuxSession ? { attachTmuxSession } : {}),
    };
    addNode(newNode);
    if (closeMenu) {
      setShowAddMenu(false);
      setExpandedSandboxId(null);
      setTmuxSessions([]);
    }
  };

  const [addingAll, setAddingAll] = useState(false);

  // Sandboxes not yet on the canvas (for "Add all")
  const sandboxIdsOnCanvas = useMemo(() => {
    const activeNodeIds = new Set(activeWorkspace?.nodeIds || []);
    return new Set(state.worktreeNodes.filter(n => activeNodeIds.has(n.id)).map(n => n.sandboxId));
  }, [state.worktreeNodes, activeWorkspace]);

  const sandboxesNotOnCanvas = useMemo(
    () => availableSandboxes.filter(s => !sandboxIdsOnCanvas.has(s.id)),
    [availableSandboxes, sandboxIdsOnCanvas]
  );

  const handleAddAll = async () => {
    if (sandboxesNotOnCanvas.length === 0) return;
    setAddingAll(true);
    // For each sandbox not already on canvas, try to find an existing tmux session to attach to
    for (const sandbox of sandboxesNotOnCanvas) {
      try {
        const sessions = await listTmuxSessions(sandbox.id);
        // Attach to the first (most recent) tmux session, or create new
        const firstSession = sessions.length > 0 ? sessions[0].name : undefined;
        addSandboxToCanvas(sandbox, firstSession, false);
      } catch {
        addSandboxToCanvas(sandbox, undefined, false);
      }
    }
    setShowAddMenu(false);
    setExpandedSandboxId(null);
    setTmuxSessions([]);
    setAddingAll(false);
  };

  const handleSandboxClick = async (sandbox: { id: string; name: string; backend: string; guestIp?: string }) => {
    // If already expanded, collapse
    if (expandedSandboxId === sandbox.id) {
      setExpandedSandboxId(null);
      setTmuxSessions([]);
      return;
    }

    // Fetch tmux sessions for this sandbox
    setExpandedSandboxId(sandbox.id);
    setLoadingSessions(true);
    setTmuxSessions([]);
    try {
      const sessions = await listTmuxSessions(sandbox.id);
      if (sessions.length > 0) {
        setTmuxSessions(sessions);
        setLoadingSessions(false);
      } else {
        // No existing sessions — add directly with a new session
        addSandboxToCanvas(sandbox);
      }
    } catch {
      // Error fetching — add directly
      addSandboxToCanvas(sandbox);
    }
  };

  const handleFocusNode = (node: WorktreeNode) => {
    const w = node.size?.width || 650;
    const h = node.size?.height || 350;
    setCenter(
      node.position.x + w / 2,
      node.position.y + h / 2,
      { zoom: 1, duration: 300 }
    );
  };

  const arrangeNodes = useCallback((layout: 'grid' | 'vertical' | 'horizontal') => {
    if (state.focusedLayout) setFocusedLayout(false);
    const minimizedSet = new Set(state.minimizedNodeIds);
    const visible = visibleWorktreeNodes.filter(n => !minimizedSet.has(n.id));
    if (visible.length === 0) return;

    const gap = 16;
    const MIN_W = 300;
    const MIN_H = 200;

    // Get the ReactFlow viewport pixel dimensions. fitView with padding 0.03
    // reserves ~3% on each side, so the usable area for nodes is ~94% of the
    // viewport. We size nodes to fill that usable area so fitView lands at
    // zoom=1 and nothing is clipped.
    const container = canvasContainerRef.current;
    const rect = container?.getBoundingClientRect();
    const FIT_PADDING = 0.03;
    const usableW = rect ? Math.floor(rect.width * (1 - FIT_PADDING * 2)) : 1200;
    const usableH = rect ? Math.floor(rect.height * (1 - FIT_PADDING * 2)) : 800;

    if (layout === 'grid') {
      const n = visible.length;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const cellW = Math.max(MIN_W, Math.floor((usableW - gap * (cols - 1)) / cols));
      const cellH = Math.max(MIN_H, Math.floor((usableH - gap * (rows - 1)) / rows));

      visible.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        updateSize(node.id, { width: cellW, height: cellH });
        updatePosition(node.id, { x: col * (cellW + gap), y: row * (cellH + gap) });
      });
    } else if (layout === 'vertical') {
      // Column: full width, split height
      const nodeH = Math.max(MIN_H, Math.floor((usableH - gap * (visible.length - 1)) / visible.length));
      const nodeW = Math.max(MIN_W, usableW);
      let y = 0;
      for (const node of visible) {
        updateSize(node.id, { width: nodeW, height: nodeH });
        updatePosition(node.id, { x: 0, y });
        y += nodeH + gap;
      }
    } else {
      // Row: full height, split width
      const nodeW = Math.max(MIN_W, Math.floor((usableW - gap * (visible.length - 1)) / visible.length));
      const nodeH = Math.max(MIN_H, usableH);
      let x = 0;
      for (const node of visible) {
        updateSize(node.id, { width: nodeW, height: nodeH });
        updatePosition(node.id, { x, y: 0 });
        x += nodeW + gap;
      }
    }

    setTimeout(() => fitView({ padding: FIT_PADDING, maxZoom: 1, duration: 300 }), 50);
  }, [visibleWorktreeNodes, state.minimizedNodeIds, state.focusedLayout, updatePosition, updateSize, fitView, setFocusedLayout]);

  // Resize the focused node to fill the canvas.
  // Only reset zoom/pan when ENTERING focused mode, not when swapping nodes within it.
  const wasFocusedRef = useRef(false);
  useEffect(() => {
    const enteringFocusMode = state.focusedLayout && !wasFocusedRef.current;
    wasFocusedRef.current = state.focusedLayout;

    if (state.focusedLayout && effectiveFocusedId) {
      const container = canvasContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        // Save original size before resizing (only if not already saved)
        const node = state.worktreeNodes.find(n => n.id === effectiveFocusedId);
        if (node && !preFocusSizesRef.current.has(effectiveFocusedId)) {
          preFocusSizesRef.current.set(effectiveFocusedId, { ...node.size });
        }
        // Size to 72% of canvas
        const w = Math.round(rect.width * 0.72);
        const h = Math.round(rect.height * 0.72);
        updateSize(effectiveFocusedId, { width: w, height: h });
        updatePosition(effectiveFocusedId, { x: 0, y: 0 });
        // Only center/zoom when first entering focused mode
        if (enteringFocusMode) {
          setTimeout(() => {
            setCenter(w / 2, h / 2, { zoom: 1, duration: 300 });
          }, 100);
        }
      }
    } else if (!state.focusedLayout) {
      // Restore original sizes when exiting focused mode
      for (const [id, size] of preFocusSizesRef.current) {
        updateSize(id, size);
      }
      preFocusSizesRef.current.clear();
      setTimeout(() => fitView({ duration: 300 }), 100);
    }
  }, [state.focusedLayout, effectiveFocusedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Canvas keyboard shortcuts — only pan camera if node is outside the viewport
  const focusCameraOnNode = useCallback((node: WorktreeNode) => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const w = node.size?.width || 650;
    const h = node.size?.height || 350;
    // Convert node position to screen coords
    const screenX = node.position.x * viewport.zoom + viewport.x;
    const screenY = node.position.y * viewport.zoom + viewport.y;
    const screenW = w * viewport.zoom;
    const screenH = h * viewport.zoom;
    // Check if node is fully within the viewport (with some margin)
    const margin = 20;
    const fullyVisible =
      screenX >= margin &&
      screenY >= margin &&
      screenX + screenW <= rect.width - margin &&
      screenY + screenH <= rect.height - margin;
    if (!fullyVisible) {
      setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: viewport.zoom, duration: 200 });
    }
  }, [setCenter, viewport]);

  const { showHelp, setShowHelp } = useCanvasShortcuts({
    arrangeNodes,
    focusCamera: focusCameraOnNode,
  });

  const statusDotColor: Record<WorktreeNode['status'], string> = {
    creating: 'bg-[hsl(var(--amber))]',
    ready: 'bg-[hsl(var(--green))]',
    merging: 'bg-[hsl(var(--purple))]',
    merged: 'bg-[hsl(var(--cyan))]',
    error: 'bg-[hsl(var(--red))]',
  };

  return (
    <div className={`relative flex ${className}`}>
      {/* Node list panel (hidden in focused mode — right sidebar serves this role) */}
      <div
        className={`relative z-10 bg-[hsl(var(--bg-surface))] border-r border-[hsl(var(--border))] flex flex-col transition-all duration-200 ${
          state.focusedLayout ? 'w-0' : panelOpen ? 'w-56' : 'w-0'
        } overflow-hidden shrink-0`}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] shrink-0">
          <span className="text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
            Nodes
          </span>
          <span className="text-[10px] text-[hsl(var(--text-muted))]">
            {visibleWorktreeNodes.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {visibleWorktreeNodes.length === 0 ? (
            <div className="px-3 py-4 text-[10px] text-[hsl(var(--text-muted))] text-center">
              No nodes in workspace
            </div>
          ) : (
            visibleWorktreeNodes.map(wn => (
              <div
                key={wn.id}
                className={`group flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--bg-elevated))] transition-colors cursor-pointer border-b border-[hsl(var(--border)/0.5)] ${
                  state.focusedLayout && wn.id === effectiveFocusedId ? 'bg-[hsl(var(--cyan)/0.08)] border-l-2 border-l-[hsl(var(--cyan))]' : ''
                }`}
                onClick={() => {
                  if (state.focusedLayout) {
                    setFocusedNodeId(wn.id);
                  } else {
                    handleFocusNode(wn);
                  }
                }}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 self-start mt-1.5 ${statusDotColor[wn.status]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-[hsl(var(--text-primary))] truncate">
                    {wn.label || sandboxNameMap.get(wn.sandboxId) || wn.sandboxId.slice(0, 12)}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <div className="text-[9px] text-[hsl(var(--text-muted))] truncate">
                      <GitBranch className="h-2.5 w-2.5 inline mr-0.5 -mt-px" />
                      {wn.branch}
                    </div>
                    <div className="text-[8px] text-[hsl(var(--text-muted))] opacity-60 font-mono shrink-0">
                      {wn.sandboxId.slice(0, 8)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleFocusNode(wn); }}
                    className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] rounded"
                    title="Focus"
                  >
                    <Crosshair className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeNode(wn.id); }}
                    className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] rounded"
                    title="Remove from canvas"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Panel toggle (hidden in focused mode) */}
      {!state.focusedLayout && (
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          className="absolute top-3 left-3 z-20 p-1.5 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded shadow-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          style={{ left: panelOpen ? 'calc(14rem + 0.75rem)' : '0.75rem' }}
          title={panelOpen ? 'Collapse panel' : 'Expand panel'}
        >
          {panelOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* ReactFlow canvas */}
      <div ref={canvasContainerRef} className="flex-1 relative">
        <ReactFlow
          nodes={localNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{ type: 'worktree' }}
          proOptions={{ hideAttribution: true }}
          selectNodesOnDrag={false}
          onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--border))" />
          <Controls
            className="!bg-[hsl(var(--bg-surface))] !border-[hsl(var(--border))] !shadow-lg [&>button]:!bg-[hsl(var(--bg-elevated))] [&>button]:!border-[hsl(var(--border))] [&>button]:!text-[hsl(var(--text-secondary))] [&>button:hover]:!bg-[hsl(var(--bg-overlay))]"
          />
          {!state.focusedLayout && (
            <MiniMap
              className="!bg-[hsl(var(--bg-surface))] !border-[hsl(var(--border))]"
              nodeColor="hsl(var(--cyan))"
              maskColor="hsla(var(--bg-base), 0.7)"
            />
          )}
        </ReactFlow>

        {/* Canvas controls — portaled into toolbar slots */}
        {(() => {
          const centerSlot = document.getElementById('canvas-toolbar-slot');
          const rightSlot = document.getElementById('canvas-toolbar-right-slot');
          return (<>
            {/* Center slot: slim toolbar toggle + layout buttons */}
            {centerSlot && createPortal(
              <>
                {/* Slim toolbar toggle */}
                <button
                  onClick={toggleSlimToolbar}
                  className={`p-1.5 rounded transition-colors ${
                    state.slimToolbar
                      ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
                  }`}
                  title={state.slimToolbar ? 'Normal toolbar' : 'Slim toolbar'}
                >
                  {state.slimToolbar ? <AlignVerticalSpaceBetween className="h-3.5 w-3.5" /> : <AlignVerticalSpaceAround className="h-3.5 w-3.5" />}
                </button>

                {/* Separator */}
                <div className="w-px h-5 bg-[hsl(var(--border))]" />

                {/* Layout arrange buttons */}
                <div className="flex items-center gap-0.5 bg-[hsl(var(--bg-elevated))] p-0.5 rounded">
                  <button onClick={() => arrangeNodes('grid')} className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors" title="Grid (Alt+1)">
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => arrangeNodes('vertical')} className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors" title="Column (Alt+2)">
                    <Rows3 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => arrangeNodes('horizontal')} className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] rounded transition-colors" title="Row (Alt+3)">
                    <Columns3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setFocusedLayout(!state.focusedLayout)}
                    className={`p-1 rounded transition-colors ${
                      state.focusedLayout ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]' : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))]'
                    }`}
                    title="Focused (Alt+4)"
                  >
                    <LayoutPanelLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>,
              centerSlot
            )}

            {/* Right slot: shortcuts icon + Add to Canvas */}
            {rightSlot && createPortal(
              <>
                {/* Keyboard shortcuts icon */}
                <button
                  onClick={() => setShowHelp(true)}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] rounded transition-colors"
                  title="Keyboard shortcuts (?)"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                </button>

                {/* Add to Canvas button */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] rounded transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add to Canvas
                  </button>

                  {showAddMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => { setShowAddMenu(false); setExpandedSandboxId(null); setTmuxSessions([]); }} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg rounded max-h-[300px] overflow-y-auto">
                        {availableSandboxes.length === 0 ? (
                          <div className="px-4 py-3 text-xs text-[hsl(var(--text-muted))]">
                            {!sandboxes
                              ? 'Loading sandboxes...'
                              : sandboxes.length === 0
                              ? 'No sandboxes found.'
                              : runningSandboxes.length === 0
                              ? `${sandboxes.length} sandbox(es) found but none running.`
                              : `${runningSandboxes.length} running but all already on canvas.`}
                          </div>
                        ) : (
                          <>
                          {sandboxesNotOnCanvas.length > 1 && (
                            <button
                              onClick={handleAddAll}
                              disabled={addingAll}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.08)] transition-colors border-b border-[hsl(var(--border)/0.5)] font-medium disabled:opacity-50"
                            >
                              {addingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                              Add all ({sandboxesNotOnCanvas.length})
                            </button>
                          )}
                          {availableSandboxes.map(sandbox => (
                            <div key={sandbox.id}>
                              <button
                                onClick={() => handleSandboxClick(sandbox)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--bg-elevated))] transition-colors ${
                                  expandedSandboxId === sandbox.id ? 'bg-[hsl(var(--bg-elevated))]' : ''
                                }`}
                              >
                                <GitBranch className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-[hsl(var(--text-primary))] truncate">{sandbox.name}</div>
                                  <div className="text-[10px] text-[hsl(var(--text-muted))] truncate">
                                    {sandbox.image}
                                    <span className="ml-1 opacity-60">{sandbox.backend}</span>
                                  </div>
                                </div>
                                {expandedSandboxId === sandbox.id && loadingSessions && (
                                  <Loader2 className="h-3 w-3 text-[hsl(var(--text-muted))] animate-spin" />
                                )}
                              </button>
                              {expandedSandboxId === sandbox.id && !loadingSessions && tmuxSessions.length > 0 && (
                                <div className="border-t border-[hsl(var(--border)/0.5)] bg-[hsl(var(--bg-elevated)/0.5)]">
                                  <button onClick={() => addSandboxToCanvas(sandbox)} className="w-full flex items-center gap-2 px-3 py-1.5 pl-8 text-xs text-left hover:bg-[hsl(var(--bg-overlay))] transition-colors text-[hsl(var(--green))]">
                                    <Plus className="h-3 w-3" /> New session
                                  </button>
                                  {tmuxSessions.map(session => (
                                    <button key={session.name} onClick={() => addSandboxToCanvas(sandbox, session.name)} className="w-full flex items-center gap-2 px-3 py-1.5 pl-8 text-xs text-left hover:bg-[hsl(var(--bg-overlay))] transition-colors text-[hsl(var(--text-secondary))]">
                                      <Terminal className="h-3 w-3 text-[hsl(var(--cyan))]" />
                                      <span className="truncate">{session.name}</span>
                                      <span className="text-[10px] text-[hsl(var(--text-muted))] ml-auto">{session.windows}w</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>,
              rightSlot
            )}
          </>);
        })()}

        {/* Git history panel */}
        {activeGitPanel && (
          <GitLogPanel
            sandboxId={activeGitPanel.sandboxId}
            cwd={activeGitPanel.cwd}
            onClose={() => setActiveGitPanel(null)}
          />
        )}

        {/* Empty state */}
        {localNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-3">
              <GitBranch className="h-12 w-12 text-[hsl(var(--text-muted))] mx-auto opacity-30" />
              <div className="text-sm text-[hsl(var(--text-muted))]">
                No sandboxes on canvas
              </div>
              <div className="text-xs text-[hsl(var(--text-muted))] opacity-60">
                Add a running sandbox to get started, then fork worktrees from it
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Minimized nodes sidebar — in focused mode, clicking swaps the focused node */}
      <MinimizedNodesSidebar
        nodes={minimizedNodesInfo}
        onRestore={state.focusedLayout ? setFocusedNodeId : restoreNode}
      />

      {/* Keyboard shortcuts help overlay */}
      {showHelp && <ShortcutsHelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// Outer wrapper provides ReactFlowProvider so useReactFlow works
export function CanvasView({ className = '' }: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasViewInner className={className} />
    </ReactFlowProvider>
  );
}
