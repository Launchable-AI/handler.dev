/**
 * Global keyboard shortcut hook.
 * Registers a window keydown listener in the capture phase to intercept
 * before xterm/browser handlers. Respects global enable state and skips
 * when focus is in an input/textarea/contenteditable.
 */

import { useEffect, useRef } from 'react';
import { getShortcutsEnabled, getCombo, matchesCombo, isShortcutDisabled } from '../lib/keyboard-shortcuts';

export function useKeyboardShortcuts(handlers: Record<string, () => void>): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!getShortcutsEnabled()) return;

      // Skip if focus is in an editable element — but allow modifier-key
      // combos (Alt+, Ctrl+, Meta+) through since they aren't normal text input.
      // This lets canvas shortcuts work even when xterm (which uses a hidden
      // textarea) has focus.
      const target = e.target as HTMLElement;
      const hasModifier = e.altKey || e.ctrlKey || e.metaKey;
      if (
        !hasModifier &&
        (target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.isContentEditable)
      ) {
        return;
      }

      for (const actionId of Object.keys(handlersRef.current)) {
        if (isShortcutDisabled(actionId)) continue;
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
