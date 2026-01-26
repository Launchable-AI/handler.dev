import { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import type {
  CommandCentreState,
  CommandCentreContextValue,
  TerminalSession,
  LayoutMode,
} from '../types/command-centre';

// Initial state
const initialState: CommandCentreState = {
  sessions: [],
  layouts: [],
  activeSessionId: null,
  maximizedSessionId: null,
  layoutMode: 'grid',
};

// Action types
type Action =
  | { type: 'CREATE_SESSION'; payload: TerminalSession }
  | { type: 'CLOSE_SESSION'; payload: string }
  | { type: 'UPDATE_SESSION_STATUS'; payload: { id: string; status: TerminalSession['status']; errorMessage?: string } }
  | { type: 'SET_ACTIVE_SESSION'; payload: string | null }
  | { type: 'SET_MAXIMIZED_SESSION'; payload: string | null }
  | { type: 'SET_LAYOUT_MODE'; payload: LayoutMode }
  | { type: 'SWAP_WITH_MAXIMIZED'; payload: string };

// Reducer
function commandCentreReducer(state: CommandCentreState, action: Action): CommandCentreState {
  switch (action.type) {
    case 'CREATE_SESSION': {
      return {
        ...state,
        sessions: [...state.sessions, action.payload],
        activeSessionId: action.payload.id,
      };
    }
    case 'CLOSE_SESSION': {
      const newSessions = state.sessions.filter(s => s.id !== action.payload);
      let newActiveSessionId = state.activeSessionId;
      let newMaximizedSessionId = state.maximizedSessionId;

      // If closing the active session, switch to another one
      if (state.activeSessionId === action.payload) {
        newActiveSessionId = newSessions.length > 0 ? newSessions[newSessions.length - 1].id : null;
      }

      // If closing the maximized session, restore grid
      if (state.maximizedSessionId === action.payload) {
        newMaximizedSessionId = null;
      }

      return {
        ...state,
        sessions: newSessions,
        activeSessionId: newActiveSessionId,
        maximizedSessionId: newMaximizedSessionId,
        layoutMode: newMaximizedSessionId ? 'maximized' : 'grid',
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
    case 'SET_MAXIMIZED_SESSION': {
      return {
        ...state,
        maximizedSessionId: action.payload,
        layoutMode: action.payload ? 'maximized' : 'grid',
      };
    }
    case 'SET_LAYOUT_MODE': {
      return {
        ...state,
        layoutMode: action.payload,
        maximizedSessionId: action.payload === 'grid' ? null : state.maximizedSessionId,
      };
    }
    case 'SWAP_WITH_MAXIMIZED': {
      // Swap the clicked thumbnail with the maximized session
      if (!state.maximizedSessionId) return state;
      return {
        ...state,
        maximizedSessionId: action.payload,
        activeSessionId: action.payload,
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

  const maximizeSession = useCallback((sessionId: string) => {
    dispatch({ type: 'SET_MAXIMIZED_SESSION', payload: sessionId });
    dispatch({ type: 'SET_ACTIVE_SESSION', payload: sessionId });
  }, []);

  const restoreLayout = useCallback(() => {
    dispatch({ type: 'SET_MAXIMIZED_SESSION', payload: null });
  }, []);

  const toggleMaximize = useCallback((sessionId: string) => {
    if (state.maximizedSessionId === sessionId) {
      dispatch({ type: 'SET_MAXIMIZED_SESSION', payload: null });
    } else {
      dispatch({ type: 'SET_MAXIMIZED_SESSION', payload: sessionId });
      dispatch({ type: 'SET_ACTIVE_SESSION', payload: sessionId });
    }
  }, [state.maximizedSessionId]);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    dispatch({ type: 'SET_LAYOUT_MODE', payload: mode });
  }, []);

  const swapWithMaximized = useCallback((sessionId: string) => {
    dispatch({ type: 'SWAP_WITH_MAXIMIZED', payload: sessionId });
  }, []);

  const value: CommandCentreContextValue = {
    state,
    createSession,
    closeSession,
    updateSessionStatus,
    setActiveSession,
    maximizeSession,
    restoreLayout,
    toggleMaximize,
    setLayoutMode,
    swapWithMaximized,
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
