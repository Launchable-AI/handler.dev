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
  category: 'terminal' | 'navigation' | 'general';
  defaultCombo: KeyCombo;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'terminal.nextTab', label: 'Next terminal tab', category: 'terminal', defaultCombo: { key: ']', ctrl: true } },
  { id: 'terminal.prevTab', label: 'Previous terminal tab', category: 'terminal', defaultCombo: { key: '[', ctrl: true } },
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
