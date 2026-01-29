import { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from 'react';
import type { Node, Edge } from 'reactflow';
import type { WorktreeNode } from '../types/command-centre';

interface CanvasState {
  worktreeNodes: WorktreeNode[];
}

interface CanvasContextValue {
  state: CanvasState;
  nodes: Node[];
  edges: Edge[];
  addNode: (node: WorktreeNode) => void;
  removeNode: (id: string) => void;
  updateNode: (id: string, updates: Partial<WorktreeNode>) => void;
  updatePosition: (id: string, position: { x: number; y: number }) => void;
}

type Action =
  | { type: 'ADD_NODE'; payload: WorktreeNode }
  | { type: 'REMOVE_NODE'; payload: string }
  | { type: 'UPDATE_NODE'; payload: { id: string; updates: Partial<WorktreeNode> } }
  | { type: 'UPDATE_POSITION'; payload: { id: string; position: { x: number; y: number } } }
  | { type: 'LOAD_NODES'; payload: WorktreeNode[] };

const STORAGE_KEY = 'caisson-canvas-nodes';

function loadPersistedNodes(): WorktreeNode[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function persistNodes(nodes: WorktreeNode[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
}

function canvasReducer(state: CanvasState, action: Action): CanvasState {
  let newState: CanvasState;

  switch (action.type) {
    case 'ADD_NODE':
      newState = { ...state, worktreeNodes: [...state.worktreeNodes, action.payload] };
      break;
    case 'REMOVE_NODE':
      newState = { ...state, worktreeNodes: state.worktreeNodes.filter(n => n.id !== action.payload) };
      break;
    case 'UPDATE_NODE':
      newState = {
        ...state,
        worktreeNodes: state.worktreeNodes.map(n =>
          n.id === action.payload.id ? { ...n, ...action.payload.updates } : n
        ),
      };
      break;
    case 'UPDATE_POSITION':
      newState = {
        ...state,
        worktreeNodes: state.worktreeNodes.map(n =>
          n.id === action.payload.id ? { ...n, position: action.payload.position } : n
        ),
      };
      break;
    case 'LOAD_NODES':
      newState = { ...state, worktreeNodes: action.payload };
      break;
    default:
      return state;
  }

  persistNodes(newState.worktreeNodes);
  return newState;
}

function buildReactFlowNodes(worktreeNodes: WorktreeNode[]): Node[] {
  return worktreeNodes.map(wn => ({
    id: wn.id,
    type: 'sandbox',
    position: wn.position,
    data: wn,
  }));
}

function buildReactFlowEdges(worktreeNodes: WorktreeNode[]): Edge[] {
  return worktreeNodes
    .filter(wn => wn.parentNodeId)
    .map(wn => ({
      id: `edge-${wn.parentNodeId}-${wn.id}`,
      source: wn.parentNodeId!,
      target: wn.id,
      type: 'worktree',
      data: { branch: wn.branch, status: wn.status },
      animated: wn.status === 'creating' || wn.status === 'merging',
    }));
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(canvasReducer, { worktreeNodes: [] });

  // Load persisted nodes on mount
  useEffect(() => {
    const saved = loadPersistedNodes();
    if (saved.length > 0) {
      dispatch({ type: 'LOAD_NODES', payload: saved });
    }
  }, []);

  const addNode = useCallback((node: WorktreeNode) => {
    dispatch({ type: 'ADD_NODE', payload: node });
  }, []);

  const removeNode = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_NODE', payload: id });
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<WorktreeNode>) => {
    dispatch({ type: 'UPDATE_NODE', payload: { id, updates } });
  }, []);

  const updatePosition = useCallback((id: string, position: { x: number; y: number }) => {
    dispatch({ type: 'UPDATE_POSITION', payload: { id, position } });
  }, []);

  const nodes = buildReactFlowNodes(state.worktreeNodes);
  const edges = buildReactFlowEdges(state.worktreeNodes);

  const value: CanvasContextValue = {
    state,
    nodes,
    edges,
    addNode,
    removeNode,
    updateNode,
    updatePosition,
  };

  return (
    <CanvasContext.Provider value={value}>
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas(): CanvasContextValue {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error('useCanvas must be used within CanvasProvider');
  }
  return context;
}
