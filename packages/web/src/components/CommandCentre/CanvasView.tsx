import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
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
import { Plus, GitBranch, PanelLeftClose, PanelLeftOpen, Crosshair, Trash2, AlignVerticalSpaceAround, AlignVerticalSpaceBetween, LayoutGrid, Columns3, Rows3, LayoutPanelLeft } from 'lucide-react';
import type { WorktreeNode } from '../../types/command-centre';

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
  const { state, nodes, edges, addNode, removeNode, updatePosition, updateSize, activeWorkspace, toggleSlimToolbar, restoreNode, setFocusedLayout, setFocusedNodeId } = useCanvas();
  const { data: sandboxData } = useSandboxes();
  const { state: ccState } = useCommandCentre();
  const { setCenter, fitView } = useReactFlow();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeGitPanel, setActiveGitPanel] = useState<{ nodeId: string; sandboxId: string; cwd?: string } | null>(null);

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

  const handleAddToCanvas = (sandbox: { id: string; name: string; backend: string; guestIp?: string }) => {
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
    };
    addNode(newNode);
    setShowAddMenu(false);
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
    if (visible.length < 2) return;

    const gap = 40;

    if (layout === 'grid') {
      const cols = Math.ceil(Math.sqrt(visible.length));
      // Sort tallest-first so the packing algorithm fills columns evenly
      const sorted = [...visible].sort((a, b) => (b.size?.height || 350) - (a.size?.height || 350));
      // Track each column: current y offset and max width seen
      const colY = Array(cols).fill(0);
      const colMaxW = Array(cols).fill(0);
      const placements: Array<{ node: typeof sorted[0]; col: number; y: number }> = [];
      // Place each node into the shortest column
      for (const node of sorted) {
        const shortestCol = colY.indexOf(Math.min(...colY));
        const h = node.size?.height || 350;
        const w = node.size?.width || 650;
        placements.push({ node, col: shortestCol, y: colY[shortestCol] });
        colY[shortestCol] += h + gap;
        colMaxW[shortestCol] = Math.max(colMaxW[shortestCol], w);
      }
      // Compute column x offsets from max widths
      const colX = Array(cols).fill(0);
      for (let c = 1; c < cols; c++) colX[c] = colX[c - 1] + colMaxW[c - 1] + gap;
      for (const { node, col, y } of placements) {
        updatePosition(node.id, { x: colX[col], y });
      }
    } else if (layout === 'vertical') {
      let y = 0;
      for (const node of visible) {
        updatePosition(node.id, { x: 0, y });
        y += (node.size?.height || 350) + gap;
      }
    } else {
      let x = 0;
      for (const node of visible) {
        updatePosition(node.id, { x, y: 0 });
        x += (node.size?.width || 650) + gap;
      }
    }

    setTimeout(() => fitView({ duration: 300 }), 50);
  }, [visibleWorktreeNodes, state.minimizedNodeIds, state.focusedLayout, updatePosition, fitView, setFocusedLayout]);

  // Auto-fit the focused node on the canvas when focused mode is active
  useEffect(() => {
    if (state.focusedLayout && effectiveFocusedId) {
      setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 50);
    }
  }, [state.focusedLayout, effectiveFocusedId, fitView]);

  const statusDotColor: Record<WorktreeNode['status'], string> = {
    creating: 'bg-[hsl(var(--amber))]',
    ready: 'bg-[hsl(var(--green))]',
    merging: 'bg-[hsl(var(--purple))]',
    merged: 'bg-[hsl(var(--cyan))]',
    error: 'bg-[hsl(var(--red))]',
  };

  return (
    <div className={`relative flex ${className}`}>
      {/* Node list panel */}
      <div
        className={`relative z-10 bg-[hsl(var(--bg-surface))] border-r border-[hsl(var(--border))] flex flex-col transition-all duration-200 ${
          panelOpen ? 'w-56' : 'w-0'
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
                    {sandboxNameMap.get(wn.sandboxId) || wn.sandboxId.slice(0, 12)}
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

      {/* Panel toggle */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="absolute top-3 left-3 z-20 p-1.5 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded shadow-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
        style={{ left: panelOpen ? 'calc(14rem + 0.75rem)' : '0.75rem' }}
        title={panelOpen ? 'Collapse panel' : 'Expand panel'}
      >
        {panelOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
      </button>

      {/* ReactFlow canvas */}
      <div className="flex-1 relative">
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
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--border))" />
          <Controls
            className="!bg-[hsl(var(--bg-surface))] !border-[hsl(var(--border))] !shadow-lg [&>button]:!bg-[hsl(var(--bg-elevated))] [&>button]:!border-[hsl(var(--border))] [&>button]:!text-[hsl(var(--text-secondary))] [&>button:hover]:!bg-[hsl(var(--bg-overlay))]"
          />
          <MiniMap
            className="!bg-[hsl(var(--bg-surface))] !border-[hsl(var(--border))]"
            nodeColor="hsl(var(--cyan))"
            maskColor="hsla(var(--bg-base), 0.7)"
          />
        </ReactFlow>

        {/* Canvas controls */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {/* Slim toolbar toggle */}
          <button
            onClick={toggleSlimToolbar}
            className={`p-1.5 bg-[hsl(var(--bg-surface))] border rounded shadow-lg transition-colors ${
              state.slimToolbar
                ? 'border-[hsl(var(--cyan)/0.5)] text-[hsl(var(--cyan))]'
                : 'border-[hsl(var(--border))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
            }`}
            title={state.slimToolbar ? 'Switch to normal toolbar' : 'Switch to slim toolbar'}
          >
            {state.slimToolbar ? (
              <AlignVerticalSpaceBetween className="h-3.5 w-3.5" />
            ) : (
              <AlignVerticalSpaceAround className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Layout arrange buttons */}
          {visibleWorktreeNodes.filter(n => !state.minimizedNodeIds.includes(n.id)).length >= 1 && (
            <div className="flex items-center bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] rounded shadow-lg overflow-hidden">
              <button
                onClick={() => arrangeNodes('grid')}
                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] transition-colors"
                title="Arrange as grid"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => arrangeNodes('vertical')}
                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] transition-colors border-l border-[hsl(var(--border))]"
                title="Arrange as column"
              >
                <Rows3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => arrangeNodes('horizontal')}
                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] transition-colors border-l border-[hsl(var(--border))]"
                title="Arrange as row"
              >
                <Columns3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setFocusedLayout(!state.focusedLayout)}
                className={`p-1.5 transition-colors border-l border-[hsl(var(--border))] ${
                  state.focusedLayout
                    ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                    : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))]'
                }`}
                title="Focused window"
              >
                <LayoutPanelLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Add sandbox to canvas button */}
          <div className="relative">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] bg-[hsl(var(--bg-surface))] border border-[hsl(var(--cyan)/0.3)] rounded shadow-lg transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add to Canvas
            </button>

            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
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
                    availableSandboxes.map(sandbox => (
                      <button
                        key={sandbox.id}
                        onClick={() => handleAddToCanvas(sandbox)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                      >
                        <GitBranch className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[hsl(var(--text-primary))] truncate">
                            {sandbox.name}
                          </div>
                          <div className="text-[10px] text-[hsl(var(--text-muted))] truncate">
                            {sandbox.image}
                            <span className="ml-1 opacity-60">{sandbox.backend}</span>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>

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
