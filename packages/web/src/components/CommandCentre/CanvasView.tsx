import { useCallback, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type OnNodesChange,
  type NodeDragHandler,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCanvas } from '../../context/CanvasContext';
import { useContainers } from '../../hooks/useContainers';
import { SandboxNode } from './nodes/SandboxNode';
import { WorktreeEdge } from './nodes/WorktreeEdge';
import { Plus, GitBranch } from 'lucide-react';
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

export function CanvasView({ className = '' }: CanvasViewProps) {
  const { state, nodes, edges, addNode, updatePosition, updateSize } = useCanvas();
  const { data: containers } = useContainers();
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Track previous positions for child-node movement
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const runningContainers = useMemo(
    () => containers?.filter(c => c.state === 'running') || [],
    [containers]
  );

  const availableContainers = useMemo(() => {
    const onCanvas = new Set(state.worktreeNodes.map(n => n.sandboxId));
    return runningContainers.filter(c => !onCanvas.has(c.id));
  }, [runningContainers, state.worktreeNodes]);

  // Get all descendant node IDs for a given parent
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
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updatePosition(change.id, change.position);
        }
        if (change.type === 'dimensions' && change.dimensions) {
          updateSize(change.id, {
            width: change.dimensions.width,
            height: change.dimensions.height,
          });
        }
      }
    },
    [updatePosition, updateSize]
  );

  // Move children when parent is dragged
  const onNodeDragStart: NodeDragHandler = useCallback((_event, node) => {
    prevPositions.current.set(node.id, { ...node.position });
  }, []);

  const onNodeDrag: NodeDragHandler = useCallback((_event, node) => {
    const prev = prevPositions.current.get(node.id);
    if (!prev) return;

    const dx = node.position.x - prev.x;
    const dy = node.position.y - prev.y;

    if (dx === 0 && dy === 0) return;

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

    prevPositions.current.set(node.id, { ...node.position });
  }, [getDescendantIds, state.worktreeNodes, updatePosition]);

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

  return (
    <div className={`relative ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
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

      {/* Add sandbox to canvas button */}
      <div className="absolute top-3 right-3 z-10">
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
                    No available containers. Start a container first.
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

      {/* Empty state */}
      {nodes.length === 0 && (
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
  );
}
