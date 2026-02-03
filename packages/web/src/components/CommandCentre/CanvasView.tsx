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
import { useContainers } from '../../hooks/useContainers';
import { SandboxNode } from './nodes/SandboxNode';
import { WorktreeEdge } from './nodes/WorktreeEdge';
import { GitLogPanel } from './GitLogPanel';
import { Plus, GitBranch, PanelLeftClose, PanelLeftOpen, Crosshair, Trash2, AlignVerticalSpaceAround, AlignVerticalSpaceBetween } from 'lucide-react';
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
  const { state, nodes, edges, addNode, removeNode, updatePosition, updateSize, activeWorkspace, toggleSlimToolbar } = useCanvas();
  const { data: containers } = useContainers();
  const { setCenter } = useReactFlow();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeGitPanel, setActiveGitPanel] = useState<{ nodeId: string; sandboxId: string; cwd?: string } | null>(null);

  // Listen for git panel open events from SandboxNode
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setActiveGitPanel((prev) =>
        prev?.sandboxId === detail.sandboxId ? null : detail
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

  // Sync context nodes into local state when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalNodes(nodes);
    }
  }, [nodes]);

  const runningContainers = useMemo(
    () => containers?.filter(c => c.state === 'running') || [],
    [containers]
  );

  const availableContainers = useMemo(() => {
    const activeNodeIds = new Set(activeWorkspace?.nodeIds || []);
    const onCanvas = new Set(
      state.worktreeNodes
        .filter(n => activeNodeIds.has(n.id))
        .map(n => n.sandboxId)
    );
    return runningContainers.filter(c => !onCanvas.has(c.id));
  }, [runningContainers, state.worktreeNodes, activeWorkspace]);

  // Visible worktree nodes for the panel list
  const visibleWorktreeNodes = useMemo(() => {
    const activeNodeIds = new Set(activeWorkspace?.nodeIds || []);
    return state.worktreeNodes.filter(n => activeNodeIds.has(n.id));
  }, [state.worktreeNodes, activeWorkspace]);

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

  const handleAddToCanvas = (container: { id: string; name: string }) => {
    const nodeId = `wt-${container.id}-${Date.now()}`;
    const newNode: WorktreeNode = {
      id: nodeId,
      sandboxId: container.id,
      branch: 'main',
      worktreePath: '/workspace',
      parentNodeId: null,
      status: 'ready',
      ports: [],
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      size: { width: 500, height: 350 },
    };
    addNode(newNode);
    setShowAddMenu(false);
  };

  const handleFocusNode = (node: WorktreeNode) => {
    const w = node.size?.width || 500;
    const h = node.size?.height || 350;
    setCenter(
      node.position.x + w / 2,
      node.position.y + h / 2,
      { zoom: 1, duration: 300 }
    );
  };

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
                className="group flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--bg-elevated))] transition-colors cursor-pointer border-b border-[hsl(var(--border)/0.5)]"
                onClick={() => handleFocusNode(wn)}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor[wn.status]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-[hsl(var(--text-primary))] truncate">
                    {wn.branch}
                  </div>
                  <div className="text-[9px] text-[hsl(var(--text-muted))] truncate">
                    {wn.sandboxId.slice(0, 12)}
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
                  {availableContainers.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-[hsl(var(--text-muted))]">
                      {!containers
                        ? 'Loading containers...'
                        : containers.length === 0
                        ? 'No containers found from API.'
                        : runningContainers.length === 0
                        ? `${containers.length} container(s) found but none running (states: ${containers.map(c => c.state).join(', ')})`
                        : `${runningContainers.length} running but all already on canvas.`}
                    </div>
                  ) : (
                    availableContainers.map(container => (
                      <button
                        key={container.id}
                        onClick={() => handleAddToCanvas(container)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                      >
                        <GitBranch className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[hsl(var(--text-primary))] truncate">
                            {container.name}
                          </div>
                          <div className="text-[10px] text-[hsl(var(--text-muted))] truncate">
                            {container.image}
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
                Add a running container to get started, then fork worktrees from it
              </div>
            </div>
          </div>
        )}
      </div>
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
