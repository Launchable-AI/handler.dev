import { useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  SHORTCUT_DEFINITIONS,
  getShortcutsEnabled,
  setShortcutsEnabled,
  getCombo,
  setCombo,
  resetCombo,
  resetAll,
  formatCombo,
  getCanvasModifier,
  setCanvasModifier,
  getVimMode,
  setVimMode,
  isShortcutDisabled,
  setShortcutDisabled,
  type KeyCombo,
  type ModifierKey,
} from '../../lib/keyboard-shortcuts';

const MODIFIER_OPTIONS: { value: ModifierKey; label: string }[] = [
  { value: 'alt', label: 'Alt' },
  { value: 'ctrl', label: 'Ctrl' },
  { value: 'meta', label: 'Meta / Cmd' },
  { value: 'ctrl+shift', label: 'Ctrl+Shift' },
];

export function KeyboardShortcutsSettings() {
  const [enabled, setEnabled] = useState(getShortcutsEnabled);
  const [canvasMod, setCanvasMod] = useState(getCanvasModifier);
  const [vimMode, setVimModeState] = useState(getVimMode);
  const [, forceUpdate] = useState(0);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  // Re-read state when shortcuts change
  useEffect(() => {
    const handler = () => {
      setEnabled(getShortcutsEnabled());
      setCanvasMod(getCanvasModifier());
      setVimModeState(getVimMode());
      forceUpdate(n => n + 1);
    };
    window.addEventListener('handler-shortcuts-changed', handler);
    return () => window.removeEventListener('handler-shortcuts-changed', handler);
  }, []);

  const handleToggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    setShortcutsEnabled(next);
  };

  const handleStartRecording = (id: string) => {
    setRecordingId(id);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!recordingId) return;
    e.preventDefault();
    e.stopPropagation();

    // Ignore bare modifier presses
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    const combo: KeyCombo = {
      key: e.key,
      ...(e.ctrlKey && { ctrl: true }),
      ...(e.shiftKey && { shift: true }),
      ...(e.altKey && { alt: true }),
      ...(e.metaKey && { meta: true }),
    };

    setCombo(recordingId, combo);
    setRecordingId(null);
  }, [recordingId]);

  useEffect(() => {
    if (!recordingId) return;
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [recordingId, handleKeyDown]);

  // Cancel recording on Escape
  useEffect(() => {
    if (!recordingId) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setRecordingId(null);
      }
    };
    window.addEventListener('keydown', onEscape, { capture: true });
    return () => window.removeEventListener('keydown', onEscape, { capture: true });
  }, [recordingId]);

  const categories = [...new Set(SHORTCUT_DEFINITIONS.map(d => d.category))];

  const categoryLabels: Record<string, string> = {
    terminal: 'Terminal',
    canvas: 'Canvas',
    navigation: 'Navigation',
    general: 'General',
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Keyboard Shortcuts</h3>
        <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
          Configure keyboard shortcuts. Click a key binding to remap it. Toggle individual shortcuts on/off.
        </p>
      </div>

      {/* Global toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleToggleEnabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            enabled ? 'bg-[hsl(var(--cyan))]' : 'bg-[hsl(var(--text-muted)/0.3)]'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className="text-xs text-[hsl(var(--text-secondary))]">
          {enabled ? 'Shortcuts enabled' : 'Shortcuts disabled'}
        </span>
      </div>

      {/* Shortcuts table */}
      <div className={`space-y-4 ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {categories.map(category => (
          <div key={category}>
            <h4 className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] mb-2">
              {categoryLabels[category] || category}
            </h4>

            {/* Canvas modifier picker + vim mode */}
            {category === 'canvas' && (<>
              <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded">
                <span className="text-xs text-[hsl(var(--text-secondary))]">Modifier key:</span>
                <div className="flex items-center gap-1">
                  {MODIFIER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setCanvasMod(opt.value); setCanvasModifier(opt.value); }}
                      className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                        canvasMod === opt.value
                          ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)]'
                          : 'bg-[hsl(var(--bg-base))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))] hover:text-[hsl(var(--text-primary))]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <span className="text-[9px] text-[hsl(var(--text-muted))] ml-auto">
                  Applies to all canvas shortcuts without manual overrides
                </span>
              </div>

              <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded">
                <button
                  onClick={() => { const next = !vimMode; setVimModeState(next); setVimMode(next); }}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0 ${
                    vimMode ? 'bg-[hsl(var(--cyan))]' : 'bg-[hsl(var(--text-muted)/0.2)]'
                  }`}
                >
                  <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
                    vimMode ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`} />
                </button>
                <span className="text-xs text-[hsl(var(--text-secondary))]">
                  Vim navigation
                </span>
                <span className="text-[9px] text-[hsl(var(--text-muted))] ml-auto font-mono">
                  {vimMode ? 'h / j / k / l' : 'Arrow keys'}
                </span>
              </div>
            </>)}

            <div className="border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
              {SHORTCUT_DEFINITIONS.filter(d => d.category === category).map(def => {
                const currentCombo = getCombo(def.id);
                const hasOverride = formatCombo(currentCombo) !== formatCombo(
                  def.category === 'canvas' && def.defaultCombo.key !== '?'
                    ? { key: def.defaultCombo.key, ...(canvasMod === 'alt' ? { alt: true } : canvasMod === 'ctrl' ? { ctrl: true } : canvasMod === 'meta' ? { meta: true } : { ctrl: true, shift: true }) }
                    : def.defaultCombo
                );
                const isRecording = recordingId === def.id;
                const disabled = isShortcutDisabled(def.id);

                return (
                  <div key={def.id} className={`flex items-center justify-between px-3 py-2 bg-[hsl(var(--bg-surface))] ${disabled ? 'opacity-40' : ''}`}>
                    <div className="flex items-center gap-2">
                      {/* Per-shortcut enable/disable toggle */}
                      <button
                        onClick={() => setShortcutDisabled(def.id, !disabled)}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0 ${
                          !disabled ? 'bg-[hsl(var(--cyan))]' : 'bg-[hsl(var(--text-muted)/0.2)]'
                        }`}
                        title={disabled ? 'Enable this shortcut' : 'Disable this shortcut'}
                      >
                        <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
                          !disabled ? 'translate-x-3.5' : 'translate-x-0.5'
                        }`} />
                      </button>
                      <span className="text-xs text-[hsl(var(--text-primary))]">{def.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartRecording(def.id)}
                        className={`px-2.5 py-1 text-xs font-mono border transition-colors ${
                          isRecording
                            ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] text-[hsl(var(--cyan))] animate-pulse'
                            : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--cyan)/0.5)]'
                        }`}
                      >
                        {isRecording ? 'Press keys...' : formatCombo(currentCombo)}
                      </button>
                      {hasOverride && (
                        <button
                          onClick={() => resetCombo(def.id)}
                          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                          title="Reset to default"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Reset all */}
      <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
        <button
          onClick={resetAll}
          className="flex items-center gap-1.5 px-4 py-2 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)]"
        >
          <RotateCcw className="h-3 w-3" />
          Reset All to Defaults
        </button>
      </div>
    </div>
  );
}
