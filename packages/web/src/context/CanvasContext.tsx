import { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from 'react';
import type { Node, Edge } from 'reactflow';
import type { WorktreeNode, Workspace } from '../types/command-centre';

interface CanvasState {
  worktreeNodes: WorktreeNode[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  slimToolbar: boolean;
  minimizedNodeIds: string[];
  focusedLayout: boolean;
  focusedNodeId: string | null;
  selectedNodeId: string | null; // Keyboard navigation target (transient, not persisted)
}

interface CanvasContextValue {
  state: CanvasState;
  nodes: Node[];
  edges: Edge[];
  addNode: (node: WorktreeNode) => void;
  removeNode: (id: string) => void;
  updateNode: (id: string, updates: Partial<WorktreeNode>) => void;
  updatePosition: (id: string, position: { x: number; y: number }) => void;
  updateSize: (id: string, size: { width: number; height: number }) => void;
  // Workspace management
  activeWorkspace: Workspace | undefined;
  createWorkspace: (name: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  // Toolbar density
  toggleSlimToolbar: () => void;
  // Minimize to sidebar
  minimizeNode: (id: string) => void;
  restoreNode: (id: string) => void;
  isNodeMinimized: (id: string) => boolean;
  setFocusedLayout: (active: boolean) => void;
  setFocusedNodeId: (id: string | null) => void;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
}

const DEFAULT_WORKSPACE_ID = 'default';

type Action =
  | { type: 'ADD_NODE'; payload: WorktreeNode }
  | { type: 'REMOVE_NODE'; payload: string }
  | { type: 'UPDATE_NODE'; payload: { id: string; updates: Partial<WorktreeNode> } }
  | { type: 'UPDATE_POSITION'; payload: { id: string; position: { x: number; y: number } } }
  | { type: 'UPDATE_SIZE'; payload: { id: string; size: { width: number; height: number } } }
  | { type: 'LOAD_STATE'; payload: { nodes: WorktreeNode[]; workspaces: Workspace[]; activeWorkspaceId: string; slimToolbar: boolean; minimizedNodeIds: string[]; focusedLayout: boolean; focusedNodeId: string | null } }
  | { type: 'CREATE_WORKSPACE'; payload: Workspace }
  | { type: 'RENAME_WORKSPACE'; payload: { id: string; name: string } }
  | { type: 'DELETE_WORKSPACE'; payload: string }
  | { type: 'SET_ACTIVE_WORKSPACE'; payload: string }
  | { type: 'TOGGLE_SLIM_TOOLBAR' }
  | { type: 'MINIMIZE_NODE'; payload: string }
  | { type: 'RESTORE_NODE'; payload: string }
  | { type: 'SET_FOCUSED_LAYOUT'; payload: boolean }
  | { type: 'SET_FOCUSED_NODE'; payload: string | null }
  | { type: 'SET_SELECTED_NODE'; payload: string | null };

const STORAGE_KEY = 'handler-canvas-nodes';
const WORKSPACES_KEY = 'handler-canvas-workspaces';
const ACTIVE_WS_KEY = 'handler-canvas-active-workspace';
const SLIM_TOOLBAR_KEY = 'handler-canvas-slim-toolbar';
const MINIMIZED_KEY = 'handler-canvas-minimized';
const FOCUSED_LAYOUT_KEY = 'handler-canvas-focused-layout';
const FOCUSED_NODE_KEY = 'handler-canvas-focused-node';

function loadPersistedNodes(): WorktreeNode[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const nodes: WorktreeNode[] = JSON.parse(saved);
    // Migrate old nodes missing the size field
    return nodes.map(n => ({
      ...n,
      size: n.size || { width: 650, height: 350 },
      position: n.position || { x: 100, y: 100 },
    }));
  } catch {
    return [];
  }
}

function loadPersistedWorkspaces(): Workspace[] {
  try {
    const saved = localStorage.getItem(WORKSPACES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function loadActiveWorkspaceId(): string {
  try {
    return localStorage.getItem(ACTIVE_WS_KEY) || DEFAULT_WORKSPACE_ID;
  } catch {
    return DEFAULT_WORKSPACE_ID;
  }
}

function loadSlimToolbar(): boolean {
  try {
    return localStorage.getItem(SLIM_TOOLBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadMinimizedNodeIds(): string[] {
  try {
    const saved = localStorage.getItem(MINIMIZED_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function loadFocusedLayout(): boolean {
  try {
    return localStorage.getItem(FOCUSED_LAYOUT_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadFocusedNodeId(): string | null {
  try {
    return localStorage.getItem(FOCUSED_NODE_KEY) || null;
  } catch {
    return null;
  }
}

function persistState(state: CanvasState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.worktreeNodes));
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(state.workspaces));
  localStorage.setItem(ACTIVE_WS_KEY, state.activeWorkspaceId);
  localStorage.setItem(SLIM_TOOLBAR_KEY, String(state.slimToolbar));
  localStorage.setItem(MINIMIZED_KEY, JSON.stringify(state.minimizedNodeIds));
  localStorage.setItem(FOCUSED_LAYOUT_KEY, String(state.focusedLayout));
  localStorage.setItem(FOCUSED_NODE_KEY, state.focusedNodeId || '');
}

function canvasReducer(state: CanvasState, action: Action): CanvasState {
  let newState: CanvasState;

  switch (action.type) {
    case 'ADD_NODE': {
      // Add node to current active workspace
      const updatedWorkspaces = state.workspaces.map(ws =>
        ws.id === state.activeWorkspaceId
          ? { ...ws, nodeIds: [...ws.nodeIds, action.payload.id] }
          : ws
      );
      newState = {
        ...state,
        worktreeNodes: [...state.worktreeNodes, action.payload],
        workspaces: updatedWorkspaces,
      };
      break;
    }
    case 'REMOVE_NODE': {
      const updatedWorkspaces = state.workspaces.map(ws => ({
        ...ws,
        nodeIds: ws.nodeIds.filter(id => id !== action.payload),
      }));
      newState = {
        ...state,
        worktreeNodes: state.worktreeNodes.filter(n => n.id !== action.payload),
        workspaces: updatedWorkspaces,
      };
      break;
    }
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
    case 'UPDATE_SIZE':
      newState = {
        ...state,
        worktreeNodes: state.worktreeNodes.map(n =>
          n.id === action.payload.id ? { ...n, size: action.payload.size } : n
        ),
      };
      break;
    case 'LOAD_STATE':
      newState = {
        ...state,
        worktreeNodes: action.payload.nodes,
        workspaces: action.payload.workspaces,
        activeWorkspaceId: action.payload.activeWorkspaceId,
        slimToolbar: action.payload.slimToolbar,
        minimizedNodeIds: action.payload.minimizedNodeIds || [],
        focusedLayout: action.payload.focusedLayout ?? false,
        focusedNodeId: action.payload.focusedNodeId ?? null,
      };
      break;
    case 'CREATE_WORKSPACE':
      newState = { ...state, workspaces: [...state.workspaces, action.payload] };
      break;
    case 'RENAME_WORKSPACE':
      newState = {
        ...state,
        workspaces: state.workspaces.map(ws =>
          ws.id === action.payload.id ? { ...ws, name: action.payload.name } : ws
        ),
      };
      break;
    case 'DELETE_WORKSPACE': {
      if (action.payload === DEFAULT_WORKSPACE_ID) return state;
      const newWorkspaces = state.workspaces.filter(ws => ws.id !== action.payload);
      newState = {
        ...state,
        workspaces: newWorkspaces,
        activeWorkspaceId: state.activeWorkspaceId === action.payload
          ? DEFAULT_WORKSPACE_ID
          : state.activeWorkspaceId,
      };
      break;
    }
    case 'SET_ACTIVE_WORKSPACE':
      newState = { ...state, activeWorkspaceId: action.payload };
      break;
    case 'TOGGLE_SLIM_TOOLBAR':
      newState = { ...state, slimToolbar: !state.slimToolbar };
      break;
    case 'MINIMIZE_NODE':
      newState = {
        ...state,
        minimizedNodeIds: state.minimizedNodeIds.includes(action.payload)
          ? state.minimizedNodeIds
          : [...state.minimizedNodeIds, action.payload],
      };
      break;
    case 'RESTORE_NODE':
      newState = {
        ...state,
        minimizedNodeIds: state.minimizedNodeIds.filter(id => id !== action.payload),
      };
      break;
    case 'SET_FOCUSED_LAYOUT':
      newState = { ...state, focusedLayout: action.payload };
      break;
    case 'SET_FOCUSED_NODE':
      newState = { ...state, focusedNodeId: action.payload };
      break;
    case 'SET_SELECTED_NODE':
      newState = { ...state, selectedNodeId: action.payload };
      break;
    default:
      return state;
  }

  persistState(newState);
  return newState;
}

function buildReactFlowNodes(worktreeNodes: WorktreeNode[], visibleIds: Set<string>, minimizedIds: Set<string>): Node[] {
  return worktreeNodes
    .filter(wn => visibleIds.has(wn.id) && !minimizedIds.has(wn.id))
    .map(wn => ({
      id: wn.id,
      type: 'sandbox',
      position: wn.position,
      data: wn,
      dragHandle: '.terminal-node-drag-handle',
      style: { width: wn.size?.width || 650, height: wn.size?.height || 350 },
    }));
}

function buildReactFlowEdges(worktreeNodes: WorktreeNode[], visibleIds: Set<string>): Edge[] {
  return worktreeNodes
    .filter(wn => wn.parentNodeId && visibleIds.has(wn.id) && visibleIds.has(wn.parentNodeId))
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
  const [state, dispatch] = useReducer(canvasReducer, {
    worktreeNodes: [],
    workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Default', nodeIds: [] }],
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    slimToolbar: false,
    minimizedNodeIds: [],
    focusedLayout: false,
    focusedNodeId: null,
    selectedNodeId: null,
  });

  // Load persisted state on mount
  useEffect(() => {
    const savedNodes = loadPersistedNodes();
    let savedWorkspaces = loadPersistedWorkspaces();
    const savedActiveWs = loadActiveWorkspaceId();
    const savedSlimToolbar = loadSlimToolbar();
    const savedMinimizedIds = loadMinimizedNodeIds();
    const savedFocusedLayout = loadFocusedLayout();
    const savedFocusedNodeId = loadFocusedNodeId();

    // Ensure default workspace exists
    if (savedWorkspaces.length === 0) {
      savedWorkspaces = [{ id: DEFAULT_WORKSPACE_ID, name: 'Default', nodeIds: savedNodes.map(n => n.id) }];
    }

    dispatch({
      type: 'LOAD_STATE',
      payload: { nodes: savedNodes, workspaces: savedWorkspaces, activeWorkspaceId: savedActiveWs, slimToolbar: savedSlimToolbar, minimizedNodeIds: savedMinimizedIds, focusedLayout: savedFocusedLayout, focusedNodeId: savedFocusedNodeId },
    });
  }, []);

  const activeWorkspace = state.workspaces.find(ws => ws.id === state.activeWorkspaceId);
  const visibleIds = new Set(activeWorkspace?.nodeIds || []);
  const minimizedIds = new Set(state.minimizedNodeIds);

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

  const updateSize = useCallback((id: string, size: { width: number; height: number }) => {
    dispatch({ type: 'UPDATE_SIZE', payload: { id, size } });
  }, []);

  const createWorkspace = useCallback((name: string) => {
    dispatch({
      type: 'CREATE_WORKSPACE',
      payload: { id: `ws-${Date.now()}`, name, nodeIds: [] },
    });
  }, []);

  const renameWorkspace = useCallback((id: string, name: string) => {
    dispatch({ type: 'RENAME_WORKSPACE', payload: { id, name } });
  }, []);

  const deleteWorkspace = useCallback((id: string) => {
    dispatch({ type: 'DELETE_WORKSPACE', payload: id });
  }, []);

  const setActiveWorkspace = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: id });
  }, []);

  const toggleSlimToolbar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SLIM_TOOLBAR' });
  }, []);

  const minimizeNode = useCallback((id: string) => {
    dispatch({ type: 'MINIMIZE_NODE', payload: id });
  }, []);

  const restoreNode = useCallback((id: string) => {
    dispatch({ type: 'RESTORE_NODE', payload: id });
  }, []);

  const isNodeMinimized = useCallback((id: string) => {
    return state.minimizedNodeIds.includes(id);
  }, [state.minimizedNodeIds]);

  const setFocusedLayout = useCallback((active: boolean) => {
    dispatch({ type: 'SET_FOCUSED_LAYOUT', payload: active });
  }, []);

  const setFocusedNodeId = useCallback((id: string | null) => {
    dispatch({ type: 'SET_FOCUSED_NODE', payload: id });
  }, []);

  const setSelectedNodeId = useCallback((id: string | null) => {
    dispatch({ type: 'SET_SELECTED_NODE', payload: id });
  }, []);

  const nodes = buildReactFlowNodes(state.worktreeNodes, visibleIds, minimizedIds);
  const edges = buildReactFlowEdges(state.worktreeNodes, visibleIds);

  const value: CanvasContextValue = {
    state,
    nodes,
    edges,
    addNode,
    removeNode,
    updateNode,
    updatePosition,
    updateSize,
    activeWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setActiveWorkspace,
    toggleSlimToolbar,
    minimizeNode,
    restoreNode,
    isNodeMinimized,
    setFocusedLayout,
    setFocusedNodeId,
    selectedNodeId: state.selectedNodeId,
    setSelectedNodeId,
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
