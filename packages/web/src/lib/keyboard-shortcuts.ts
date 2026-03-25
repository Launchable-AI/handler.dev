/**
 * Keyboard shortcut definitions, storage, and matching utilities.
 * User overrides are stored in localStorage.
 */

export interface KeyCombo {
  key: string;          // KeyboardEvent.key value (e.g., ']', '[', 'f')
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface ShortcutDefinition {
  id: string;           // e.g. 'terminal.nextTab'
  label: string;        // e.g. 'Next terminal tab'
  category: 'terminal' | 'navigation' | 'general' | 'canvas';
  defaultCombo: KeyCombo;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Terminal
  { id: 'terminal.nextTab', label: 'Next terminal tab', category: 'terminal', defaultCombo: { key: ']', ctrl: true } },
  { id: 'terminal.prevTab', label: 'Previous terminal tab', category: 'terminal', defaultCombo: { key: '[', ctrl: true } },

  // Canvas — navigation (Alt+Arrow defaults, vim users can remap to Alt+h/j/k/l in Settings)
  { id: 'canvas.nextNode', label: 'Next node', category: 'canvas', defaultCombo: { key: 'ArrowRight', alt: true } },
  { id: 'canvas.prevNode', label: 'Previous node', category: 'canvas', defaultCombo: { key: 'ArrowLeft', alt: true } },
  { id: 'canvas.nodeAbove', label: 'Node above', category: 'canvas', defaultCombo: { key: 'ArrowUp', alt: true } },
  { id: 'canvas.nodeBelow', label: 'Node below', category: 'canvas', defaultCombo: { key: 'ArrowDown', alt: true } },

  // Canvas — actions
  { id: 'canvas.focusNode', label: 'Focus / maximize node', category: 'canvas', defaultCombo: { key: 'Enter', alt: true } },
  { id: 'canvas.minimizeNode', label: 'Minimize node', category: 'canvas', defaultCombo: { key: 'm', alt: true } },
  { id: 'canvas.closeNode', label: 'Close / remove node', category: 'canvas', defaultCombo: { key: 'w', alt: true } },

  // Canvas — layouts
  { id: 'canvas.layoutGrid', label: 'Grid layout', category: 'canvas', defaultCombo: { key: '1', alt: true } },
  { id: 'canvas.layoutVertical', label: 'Vertical layout', category: 'canvas', defaultCombo: { key: '2', alt: true } },
  { id: 'canvas.layoutHorizontal', label: 'Horizontal layout', category: 'canvas', defaultCombo: { key: '3', alt: true } },
  { id: 'canvas.layoutFocused', label: 'Focused layout', category: 'canvas', defaultCombo: { key: '4', alt: true } },

  // Canvas — focused mode
  { id: 'canvas.swapNext', label: 'Swap to next node', category: 'canvas', defaultCombo: { key: ']', alt: true } },
  { id: 'canvas.swapPrev', label: 'Swap to previous node', category: 'canvas', defaultCombo: { key: '[', alt: true } },

  // Canvas — help
  { id: 'canvas.showHelp', label: 'Show keyboard shortcuts', category: 'canvas', defaultCombo: { key: '?' } },
];

const STORAGE_ENABLED_KEY = 'handler:shortcuts-enabled';
const STORAGE_OVERRIDES_KEY = 'handler:shortcuts';

// --- Enabled state ---

export function getShortcutsEnabled(): boolean {
  const stored = localStorage.getItem(STORAGE_ENABLED_KEY);
  return stored !== 'false'; // default enabled
}

export function setShortcutsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('handler-shortcuts-changed'));
}

// --- Overrides ---

function getOverrides(): Record<string, KeyCombo> {
  try {
    const raw = localStorage.getItem(STORAGE_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setOverrides(overrides: Record<string, KeyCombo>): void {
  localStorage.setItem(STORAGE_OVERRIDES_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new CustomEvent('handler-shortcuts-changed'));
}

export function getCombo(id: string): KeyCombo {
  const overrides = getOverrides();
  if (overrides[id]) return overrides[id];
  const def = SHORTCUT_DEFINITIONS.find(d => d.id === id);
  return def ? def.defaultCombo : { key: '' };
}

export function setCombo(id: string, combo: KeyCombo): void {
  const overrides = getOverrides();
  overrides[id] = combo;
  setOverrides(overrides);
}

export function resetCombo(id: string): void {
  const overrides = getOverrides();
  delete overrides[id];
  setOverrides(overrides);
}

export function resetAll(): void {
  localStorage.removeItem(STORAGE_OVERRIDES_KEY);
  window.dispatchEvent(new CustomEvent('handler-shortcuts-changed'));
}

// --- Matching ---

export function matchesCombo(event: KeyboardEvent, combo: KeyCombo): boolean {
  if (!combo.key) return false;
  if (event.key !== combo.key) return false;
  if (!!combo.ctrl !== event.ctrlKey) return false;
  if (!!combo.shift !== event.shiftKey) return false;
  if (!!combo.alt !== event.altKey) return false;
  if (!!combo.meta !== event.metaKey) return false;
  return true;
}

// --- Display ---

export function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Meta');
  if (combo.key) {
    // Capitalize single character keys for display
    const display = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
    parts.push(display);
  }
  return parts.join('+');
}
