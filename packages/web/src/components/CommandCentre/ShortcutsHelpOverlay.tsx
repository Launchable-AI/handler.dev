/**
 * ShortcutsHelpOverlay — Keyboard shortcuts reference triggered by ?
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { SHORTCUT_DEFINITIONS, getCombo, formatCombo } from '../../lib/keyboard-shortcuts';

interface ShortcutsHelpOverlayProps {
  onClose: () => void;
}

export function ShortcutsHelpOverlay({ onClose }: ShortcutsHelpOverlayProps) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  // Group shortcuts by category
  const groups: Record<string, typeof SHORTCUT_DEFINITIONS> = {};
  for (const def of SHORTCUT_DEFINITIONS) {
    (groups[def.category] ??= []).push(def);
  }

  const categoryLabels: Record<string, string> = {
    canvas: 'Canvas',
    terminal: 'Terminal',
    navigation: 'Navigation',
    general: 'General',
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg shadow-2xl max-w-md w-full max-h-[80vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--text-primary))]">Keyboard Shortcuts</h2>
            <button
              onClick={onClose}
              className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Shortcut groups */}
          <div className="px-5 py-3 space-y-4">
            {Object.entries(groups).map(([category, defs]) => (
              <div key={category}>
                <div className="text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider mb-2">
                  {categoryLabels[category] || category}
                </div>
                <div className="space-y-1">
                  {defs.map(def => {
                    const combo = getCombo(def.id);
                    return (
                      <div key={def.id} className="flex items-center justify-between py-1">
                        <span className="text-xs text-[hsl(var(--text-secondary))]">{def.label}</span>
                        <kbd className="px-2 py-0.5 text-[10px] font-mono bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] rounded text-[hsl(var(--text-primary))]">
                          {formatCombo(combo)}
                        </kbd>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-2 border-t border-[hsl(var(--border))] text-[10px] text-[hsl(var(--text-muted))]">
            Remap shortcuts in Settings &gt; Keyboard
          </div>
        </div>
      </div>
    </>
  );
}
