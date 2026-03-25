/**
 * Canvas keyboard shortcuts hook.
 * Wires shortcut IDs to canvas actions: spatial navigation, layout cycling,
 * focus/minimize/close, and help overlay toggle.
 */

import { useCallback, useMemo, useState } from 'react';
import { useCanvas } from '../context/CanvasContext';
import type { WorktreeNode } from '../types/command-centre';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

interface UseCanvasShortcutsOptions {
  /** Called when arrangeNodes should fire */
  arrangeNodes: (layout: 'grid' | 'vertical' | 'horizontal') => void;
  /** Called to pan camera to a node */
  focusCamera: (node: WorktreeNode) => void;
}

export function useCanvasShortcuts({ arrangeNodes, focusCamera }: UseCanvasShortcutsOptions) {
  const {
    state,
    removeNode,
    minimizeNode,
    setFocusedLayout,
    setFocusedNodeId,
    selectedNodeId,
    setSelectedNodeId,
    activeWorkspace,
  } = useCanvas();

  const [showHelp, setShowHelp] = useState(false);

  // Visible, non-minimized nodes in the active workspace
  const visibleNodes = useMemo(() => {
    const activeNodeIds = new Set(activeWorkspace?.nodeIds || []);
    const minimizedSet = new Set(state.minimizedNodeIds);
    return state.worktreeNodes.filter(n => activeNodeIds.has(n.id) && !minimizedSet.has(n.id));
  }, [state.worktreeNodes, state.minimizedNodeIds, activeWorkspace]);

  // All workspace nodes (including minimized) for focused-mode swap
  const allWorkspaceNodes = useMemo(() => {
    const activeNodeIds = new Set(activeWorkspace?.nodeIds || []);
    return state.worktreeNodes.filter(n => activeNodeIds.has(n.id));
  }, [state.worktreeNodes, activeWorkspace]);

  // Resolve current selected node, defaulting to the first visible node
  const resolveSelected = useCallback((): WorktreeNode | null => {
    if (visibleNodes.length === 0) return null;
    // In focused mode, the selected node is the focused one
    if (state.focusedLayout && state.focusedNodeId) {
      return visibleNodes.find(n => n.id === state.focusedNodeId) || visibleNodes[0];
    }
    if (selectedNodeId) {
      const found = visibleNodes.find(n => n.id === selectedNodeId);
      if (found) return found;
    }
    return visibleNodes[0];
  }, [visibleNodes, selectedNodeId, state.focusedLayout, state.focusedNodeId]);

  // Spatial navigation: find nearest node in a direction
  const navigateSpatial = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const current = resolveSelected();
    if (!current || visibleNodes.length <= 1) return;

    const cx = current.position.x + (current.size?.width || 650) / 2;
    const cy = current.position.y + (current.size?.height || 350) / 2;

    let best: WorktreeNode | null = null;
    let bestScore = Infinity;

    for (const node of visibleNodes) {
      if (node.id === current.id) continue;
      const nx = node.position.x + (node.size?.width || 650) / 2;
      const ny = node.position.y + (node.size?.height || 350) / 2;
      const dx = nx - cx;
      const dy = ny - cy;

      // Check if node is in the correct direction (90-degree cone)
      let inDirection = false;
      switch (direction) {
        case 'right': inDirection = dx > 0 && Math.abs(dy) < Math.abs(dx); break;
        case 'left':  inDirection = dx < 0 && Math.abs(dy) < Math.abs(-dx); break;
        case 'down':  inDirection = dy > 0 && Math.abs(dx) < Math.abs(dy); break;
        case 'up':    inDirection = dy < 0 && Math.abs(dx) < Math.abs(-dy); break;
      }
      if (!inDirection) continue;

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestScore) {
        bestScore = dist;
        best = node;
      }
    }

    if (best) {
      if (state.focusedLayout) {
        setFocusedNodeId(best.id);
      } else {
        setSelectedNodeId(best.id);
        focusCamera(best);
      }
    }
  }, [resolveSelected, visibleNodes, state.focusedLayout, setSelectedNodeId, setFocusedNodeId, focusCamera]);

  // List-order navigation (next/prev)
  const navigateList = useCallback((delta: 1 | -1) => {
    if (state.focusedLayout) {
      // In focused mode, cycle through all workspace nodes
      if (allWorkspaceNodes.length <= 1) return;
      const currentId = state.focusedNodeId || allWorkspaceNodes[0]?.id;
      const idx = allWorkspaceNodes.findIndex(n => n.id === currentId);
      const next = (idx + delta + allWorkspaceNodes.length) % allWorkspaceNodes.length;
      setFocusedNodeId(allWorkspaceNodes[next].id);
    } else {
      const current = resolveSelected();
      if (!current || visibleNodes.length <= 1) return;
      const idx = visibleNodes.findIndex(n => n.id === current.id);
      const next = (idx + delta + visibleNodes.length) % visibleNodes.length;
      setSelectedNodeId(visibleNodes[next].id);
      focusCamera(visibleNodes[next]);
    }
  }, [visibleNodes, allWorkspaceNodes, state.focusedLayout, state.focusedNodeId, resolveSelected, setSelectedNodeId, setFocusedNodeId, focusCamera]);

  const handlers = useMemo(() => ({
    // Navigation
    'canvas.nextNode': () => navigateList(1),
    'canvas.prevNode': () => navigateList(-1),
    'canvas.nodeAbove': () => navigateSpatial('up'),
    'canvas.nodeBelow': () => navigateSpatial('down'),

    // Actions
    'canvas.focusNode': () => {
      const current = resolveSelected();
      if (!current) return;
      if (state.focusedLayout) {
        // Toggle focused layout off
        setFocusedLayout(false);
      } else {
        // Enter focused layout with this node
        setFocusedLayout(true);
        setFocusedNodeId(current.id);
      }
    },
    'canvas.minimizeNode': () => {
      const current = resolveSelected();
      if (!current) return;
      minimizeNode(current.id);
      // Select the next visible node
      const remaining = visibleNodes.filter(n => n.id !== current.id);
      if (remaining.length > 0) {
        setSelectedNodeId(remaining[0].id);
      }
    },
    'canvas.closeNode': () => {
      const current = resolveSelected();
      if (!current) return;
      removeNode(current.id);
      const remaining = visibleNodes.filter(n => n.id !== current.id);
      if (remaining.length > 0) {
        setSelectedNodeId(remaining[0].id);
      }
    },

    // Layouts
    'canvas.layoutGrid': () => arrangeNodes('grid'),
    'canvas.layoutVertical': () => arrangeNodes('vertical'),
    'canvas.layoutHorizontal': () => arrangeNodes('horizontal'),
    'canvas.layoutFocused': () => {
      if (!state.focusedLayout) setFocusedNodeId(null); // Clear stale ID so auto-select works
      setFocusedLayout(!state.focusedLayout);
    },

    // Focused mode swap
    'canvas.swapNext': () => navigateList(1),
    'canvas.swapPrev': () => navigateList(-1),

    // Help
    'canvas.showHelp': () => setShowHelp(prev => !prev),
  }), [navigateList, navigateSpatial, resolveSelected, state.focusedLayout, visibleNodes, arrangeNodes, setFocusedLayout, setFocusedNodeId, minimizeNode, removeNode, setSelectedNodeId]);

  useKeyboardShortcuts(handlers);

  return { showHelp, setShowHelp };
}
