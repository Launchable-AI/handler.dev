import { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import type {
  CommandCentreState,
  CommandCentreContextValue,
  TerminalSession,
  SplitLayout,
  ViewMode,
} from '../types/command-centre';

// Constants
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 13;
const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 220;

// Initial state
// Load persisted view mode from localStorage
const savedViewMode = (typeof window !== 'undefined' && localStorage.getItem('handler-view-mode')) as ViewMode | null;

const initialState: CommandCentreState = {
  sessions: [],
  layouts: [],
  activeSessionId: null,
  splitLayout: 'grid',
  focusedSessionIds: [],
  isFullscreen: false,
  maximizedSessionId: null,
  viewMode: savedViewMode || 'grid',
  fontSize: DEFAULT_FONT_SIZE,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
};

// Action types
type Action =
  | { type: 'CREATE_SESSION'; payload: TerminalSession }
  | { type: 'CLOSE_SESSION'; payload: string }
  | { type: 'UPDATE_SESSION_STATUS'; payload: { id: string; status: TerminalSession['status']; errorMessage?: string } }
  | { type: 'SET_ACTIVE_SESSION'; payload: string | null }
  | { type: 'SET_SPLIT_LAYOUT'; payload: SplitLayout }
  | { type: 'FOCUS_SESSION'; payload: string }
  | { type: 'FOCUS_SESSION_AT_INDEX'; payload: { sessionId: string; index: number } }
  | { type: 'UNFOCUS_SESSION'; payload: string }
  | { type: 'SWAP_FOCUS'; payload: { focusedId: string; unfocusedId: string } }
  | { type: 'TOGGLE_FOCUS'; payload: string }
  | { type: 'FOCUS_ALL' }
  | { type: 'UNFOCUS_ALL' }
  | { type: 'SET_FONT_SIZE'; payload: number }
  | { type: 'SET_SIDEBAR_WIDTH'; payload: number }
  | { type: 'TOGGLE_FULLSCREEN' }
  | { type: 'MAXIMIZE_SESSION'; payload: string | null }
  | { type: 'TOGGLE_MAXIMIZE'; payload: string }
  | { type: 'REORDER_SESSIONS'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'REORDER_FOCUSED_SESSIONS'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode };

// Reducer
function commandCentreReducer(state: CommandCentreState, action: Action): CommandCentreState {
  switch (action.type) {
    case 'CREATE_SESSION': {
      // New sessions are automatically focused
      return {
        ...state,
        sessions: [...state.sessions, action.payload],
        activeSessionId: action.payload.id,
        focusedSessionIds: [...state.focusedSessionIds, action.payload.id],
      };
    }
    case 'CLOSE_SESSION': {
      const newSessions = state.sessions.filter(s => s.id !== action.payload);
      const newFocusedIds = state.focusedSessionIds.filter(id => id !== action.payload);
      let newActiveSessionId = state.activeSessionId;

      // If closing the active session, switch to another one
      if (state.activeSessionId === action.payload) {
        // Prefer focused sessions, then any session
        newActiveSessionId = newFocusedIds.length > 0
          ? newFocusedIds[newFocusedIds.length - 1]
          : newSessions.length > 0
            ? newSessions[newSessions.length - 1].id
            : null;
      }

      return {
        ...state,
        sessions: newSessions,
        activeSessionId: newActiveSessionId,
        focusedSessionIds: newFocusedIds,
      };
    }
    case 'UPDATE_SESSION_STATUS': {
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.payload.id
            ? { ...s, status: action.payload.status, errorMessage: action.payload.errorMessage }
            : s
        ),
      };
    }
    case 'SET_ACTIVE_SESSION': {
      return {
        ...state,
        activeSessionId: action.payload,
      };
    }
    case 'SET_SPLIT_LAYOUT': {
      return {
        ...state,
        splitLayout: action.payload,
      };
    }
    case 'FOCUS_SESSION': {
      if (state.focusedSessionIds.includes(action.payload)) {
        return state;
      }
      return {
        ...state,
        focusedSessionIds: [...state.focusedSessionIds, action.payload],
        activeSessionId: action.payload,
      };
    }
    case 'FOCUS_SESSION_AT_INDEX': {
      const { sessionId, index } = action.payload;
      // Remove from current position if already focused
      const filtered = state.focusedSessionIds.filter(id => id !== sessionId);
      // Insert at specified index
      const newFocusedIds = [
        ...filtered.slice(0, index),
        sessionId,
        ...filtered.slice(index),
      ];
      return {
        ...state,
        focusedSessionIds: newFocusedIds,
        activeSessionId: sessionId,
      };
    }
    case 'UNFOCUS_SESSION': {
      // Don't unfocus if it's the last focused session
      if (state.focusedSessionIds.length <= 1) {
        return state;
      }
      const newFocusedIds = state.focusedSessionIds.filter(id => id !== action.payload);
      let newActiveId = state.activeSessionId;
      // If unfocusing the active session, switch to another focused one
      if (state.activeSessionId === action.payload) {
        newActiveId = newFocusedIds[newFocusedIds.length - 1] || null;
      }
      return {
        ...state,
        focusedSessionIds: newFocusedIds,
        activeSessionId: newActiveId,
      };
    }
    case 'SWAP_FOCUS': {
      const { focusedId, unfocusedId } = action.payload;
      // Find the index of the focused session
      const focusedIndex = state.focusedSessionIds.indexOf(focusedId);
      if (focusedIndex === -1) return state;
      // Replace the focused session with the unfocused one at the same position
      const newFocusedIds = [...state.focusedSessionIds];
      newFocusedIds[focusedIndex] = unfocusedId;
      return {
        ...state,
        focusedSessionIds: newFocusedIds,
        activeSessionId: unfocusedId,
      };
    }
    case 'TOGGLE_FOCUS': {
      const isFocused = state.focusedSessionIds.includes(action.payload);
      if (isFocused) {
        // Don't unfocus if it's the last one
        if (state.focusedSessionIds.length <= 1) {
          return state;
        }
        const newFocusedIds = state.focusedSessionIds.filter(id => id !== action.payload);
        let newActiveId = state.activeSessionId;
        if (state.activeSessionId === action.payload) {
          newActiveId = newFocusedIds[newFocusedIds.length - 1] || null;
        }
        return {
          ...state,
          focusedSessionIds: newFocusedIds,
          activeSessionId: newActiveId,
        };
      } else {
        return {
          ...state,
          focusedSessionIds: [...state.focusedSessionIds, action.payload],
          activeSessionId: action.payload,
        };
      }
    }
    case 'FOCUS_ALL': {
      return {
        ...state,
        focusedSessionIds: state.sessions.map(s => s.id),
      };
    }
    case 'UNFOCUS_ALL': {
      // Keep only one session focused (the active one or the first one)
      const keepFocused = state.activeSessionId || state.sessions[0]?.id;
      if (!keepFocused) return state;
      return {
        ...state,
        focusedSessionIds: [keepFocused],
        activeSessionId: keepFocused,
      };
    }
    case 'SET_FONT_SIZE': {
      const size = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, action.payload));
      return {
        ...state,
        fontSize: size,
      };
    }
    case 'SET_SIDEBAR_WIDTH': {
      const width = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, action.payload));
      return {
        ...state,
        sidebarWidth: width,
      };
    }
    case 'TOGGLE_FULLSCREEN': {
      return {
        ...state,
        isFullscreen: !state.isFullscreen,
      };
    }
    case 'MAXIMIZE_SESSION': {
      return {
        ...state,
        maximizedSessionId: action.payload,
      };
    }
    case 'TOGGLE_MAXIMIZE': {
      return {
        ...state,
        maximizedSessionId: state.maximizedSessionId === action.payload ? null : action.payload,
      };
    }
    case 'REORDER_SESSIONS': {
      const { fromIndex, toIndex } = action.payload;
      const newSessions = [...state.sessions];
      const [removed] = newSessions.splice(fromIndex, 1);
      newSessions.splice(toIndex, 0, removed);
      return {
        ...state,
        sessions: newSessions,
      };
    }
    case 'REORDER_FOCUSED_SESSIONS': {
      const { fromIndex, toIndex } = action.payload;
      const newFocusedIds = [...state.focusedSessionIds];
      const [removed] = newFocusedIds.splice(fromIndex, 1);
      newFocusedIds.splice(toIndex, 0, removed);
      return {
        ...state,
        focusedSessionIds: newFocusedIds,
      };
    }
    case 'SET_VIEW_MODE': {
      localStorage.setItem('handler-view-mode', action.payload);
      return {
        ...state,
        viewMode: action.payload,
      };
    }
    default:
      return state;
  }
}

// Context
const CommandCentreContext = createContext<CommandCentreContextValue | null>(null);

// Provider component
export function CommandCentreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(commandCentreReducer, initialState);

  const createSession = useCallback((
    type: 'vm' | 'container',
    targetId: string,
    targetName: string,
    ip?: string
  ) => {
    // Check if session for this target already exists
    const existing = state.sessions.find(s => s.targetId === targetId && s.type === type);
    if (existing) {
      dispatch({ type: 'SET_ACTIVE_SESSION', payload: existing.id });
      // Also focus it if in focus mode
      dispatch({ type: 'FOCUS_SESSION', payload: existing.id });
      return;
    }

    const session: TerminalSession = {
      id: `session-${type}-${targetId}-${Date.now()}`,
      type,
      targetId,
      targetName,
      targetIp: ip,
      shell: '/bin/bash',
      createdAt: new Date(),
      status: 'connecting',
    };

    dispatch({ type: 'CREATE_SESSION', payload: session });
  }, [state.sessions]);

  const closeSession = useCallback((sessionId: string) => {
    dispatch({ type: 'CLOSE_SESSION', payload: sessionId });
  }, []);

  const updateSessionStatus = useCallback((
    sessionId: string,
    status: TerminalSession['status'],
    errorMessage?: string
  ) => {
    dispatch({ type: 'UPDATE_SESSION_STATUS', payload: { id: sessionId, status, errorMessage } });
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    dispatch({ type: 'SET_ACTIVE_SESSION', payload: sessionId });
  }, []);

  const setSplitLayout = useCallback((layout: SplitLayout) => {
    dispatch({ type: 'SET_SPLIT_LAYOUT', payload: layout });
  }, []);

  const focusSession = useCallback((sessionId: string) => {
    dispatch({ type: 'FOCUS_SESSION', payload: sessionId });
  }, []);

  const focusSessionAtIndex = useCallback((sessionId: string, index: number) => {
    dispatch({ type: 'FOCUS_SESSION_AT_INDEX', payload: { sessionId, index } });
  }, []);

  const unfocusSession = useCallback((sessionId: string) => {
    dispatch({ type: 'UNFOCUS_SESSION', payload: sessionId });
  }, []);

  const swapFocus = useCallback((focusedId: string, unfocusedId: string) => {
    dispatch({ type: 'SWAP_FOCUS', payload: { focusedId, unfocusedId } });
  }, []);

  const toggleFocus = useCallback((sessionId: string) => {
    dispatch({ type: 'TOGGLE_FOCUS', payload: sessionId });
  }, []);

  const focusAll = useCallback(() => {
    dispatch({ type: 'FOCUS_ALL' });
  }, []);

  const unfocusAll = useCallback(() => {
    dispatch({ type: 'UNFOCUS_ALL' });
  }, []);

  const setFontSize = useCallback((size: number) => {
    dispatch({ type: 'SET_FONT_SIZE', payload: size });
  }, []);

  const increaseFontSize = useCallback(() => {
    dispatch({ type: 'SET_FONT_SIZE', payload: state.fontSize + 1 });
  }, [state.fontSize]);

  const decreaseFontSize = useCallback(() => {
    dispatch({ type: 'SET_FONT_SIZE', payload: state.fontSize - 1 });
  }, [state.fontSize]);

  const setSidebarWidth = useCallback((width: number) => {
    dispatch({ type: 'SET_SIDEBAR_WIDTH', payload: width });
  }, []);

  const toggleFullscreen = useCallback(() => {
    dispatch({ type: 'TOGGLE_FULLSCREEN' });
  }, []);

  const maximizeSession = useCallback((sessionId: string | null) => {
    dispatch({ type: 'MAXIMIZE_SESSION', payload: sessionId });
  }, []);

  const toggleMaximize = useCallback((sessionId: string) => {
    dispatch({ type: 'TOGGLE_MAXIMIZE', payload: sessionId });
  }, []);

  const reorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: 'REORDER_SESSIONS', payload: { fromIndex, toIndex } });
  }, []);

  const reorderFocusedSessions = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: 'REORDER_FOCUSED_SESSIONS', payload: { fromIndex, toIndex } });
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
  }, []);

  const value: CommandCentreContextValue = {
    state,
    createSession,
    closeSession,
    updateSessionStatus,
    setActiveSession,
    setSplitLayout,
    focusSession,
    focusSessionAtIndex,
    unfocusSession,
    swapFocus,
    toggleFocus,
    focusAll,
    unfocusAll,
    setFontSize,
    increaseFontSize,
    decreaseFontSize,
    setSidebarWidth,
    toggleFullscreen,
    maximizeSession,
    toggleMaximize,
    reorderSessions,
    reorderFocusedSessions,
    setViewMode,
  };

  return (
    <CommandCentreContext.Provider value={value}>
      {children}
    </CommandCentreContext.Provider>
  );
}

// Hook to use the context
export function useCommandCentre(): CommandCentreContextValue {
  const context = useContext(CommandCentreContext);
  if (!context) {
    throw new Error('useCommandCentre must be used within CommandCentreProvider');
  }
  return context;
}
