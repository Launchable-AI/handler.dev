/**
 * Global keyboard shortcut hook.
 * Registers a window keydown listener in the capture phase to intercept
 * before xterm/browser handlers. Respects global enable state and skips
 * when focus is in an input/textarea/contenteditable.
 */

import { useEffect, useRef } from 'react';
import { getShortcutsEnabled, getCombo, matchesCombo } from '../lib/keyboard-shortcuts';

export function useKeyboardShortcuts(handlers: Record<string, () => void>): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!getShortcutsEnabled()) return;

      // Skip if focus is in an editable element
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      for (const actionId of Object.keys(handlersRef.current)) {
        const combo = getCombo(actionId);
        if (matchesCombo(e, combo)) {
          e.preventDefault();
          e.stopPropagation();
          handlersRef.current[actionId]();
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });

    // Re-read config when shortcuts change
    const onShortcutsChanged = () => {
      // The handler already calls getCombo() on each keydown, so nothing to refresh here.
      // This event exists so React components (like Settings) can re-render.
    };
    window.addEventListener('handler-shortcuts-changed', onShortcutsChanged);

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('handler-shortcuts-changed', onShortcutsChanged);
    };
  }, []);
}
