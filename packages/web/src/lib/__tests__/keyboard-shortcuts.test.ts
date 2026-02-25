import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchesCombo,
  formatCombo,
  getCombo,
  setCombo,
  resetCombo,
  resetAll,
  getShortcutsEnabled,
  setShortcutsEnabled,
  SHORTCUT_DEFINITIONS,
  type KeyCombo,
} from '../keyboard-shortcuts';

// Helper to create a minimal KeyboardEvent-like object
function fakeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('matchesCombo', () => {
  it('matches Ctrl+] exactly', () => {
    const combo: KeyCombo = { key: ']', ctrl: true };
    const event = fakeKeyEvent({ key: ']', ctrlKey: true });
    expect(matchesCombo(event, combo)).toBe(true);
  });

  it('rejects wrong key', () => {
    const combo: KeyCombo = { key: ']', ctrl: true };
    const event = fakeKeyEvent({ key: '[', ctrlKey: true });
    expect(matchesCombo(event, combo)).toBe(false);
  });

  it('rejects missing modifier', () => {
    const combo: KeyCombo = { key: ']', ctrl: true };
    const event = fakeKeyEvent({ key: ']', ctrlKey: false });
    expect(matchesCombo(event, combo)).toBe(false);
  });

  it('rejects extra modifier', () => {
    const combo: KeyCombo = { key: ']', ctrl: true };
    const event = fakeKeyEvent({ key: ']', ctrlKey: true, shiftKey: true });
    expect(matchesCombo(event, combo)).toBe(false);
  });

  it('matches combo with multiple modifiers', () => {
    const combo: KeyCombo = { key: 'k', ctrl: true, shift: true };
    const event = fakeKeyEvent({ key: 'k', ctrlKey: true, shiftKey: true });
    expect(matchesCombo(event, combo)).toBe(true);
  });

  it('returns false for empty key', () => {
    const combo: KeyCombo = { key: '' };
    const event = fakeKeyEvent({ key: '' });
    expect(matchesCombo(event, combo)).toBe(false);
  });

  it('handles meta key', () => {
    const combo: KeyCombo = { key: 's', meta: true };
    const event = fakeKeyEvent({ key: 's', metaKey: true });
    expect(matchesCombo(event, combo)).toBe(true);
  });
});

describe('formatCombo', () => {
  it('formats Ctrl+key', () => {
    expect(formatCombo({ key: ']', ctrl: true })).toBe('Ctrl+]');
  });

  it('formats multiple modifiers in order', () => {
    expect(formatCombo({ key: 'k', ctrl: true, alt: true, shift: true })).toBe('Ctrl+Alt+Shift+K');
  });

  it('capitalizes single-character keys', () => {
    expect(formatCombo({ key: 'a' })).toBe('A');
  });

  it('preserves multi-character key names', () => {
    expect(formatCombo({ key: 'Enter', ctrl: true })).toBe('Ctrl+Enter');
  });

  it('handles meta modifier', () => {
    expect(formatCombo({ key: 's', meta: true })).toBe('Meta+S');
  });

  it('handles empty key', () => {
    expect(formatCombo({ key: '' })).toBe('');
  });
});

describe('localStorage-based operations', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getShortcutsEnabled / setShortcutsEnabled', () => {
    it('defaults to enabled', () => {
      expect(getShortcutsEnabled()).toBe(true);
    });

    it('persists disabled state', () => {
      setShortcutsEnabled(false);
      expect(getShortcutsEnabled()).toBe(false);
    });

    it('can re-enable', () => {
      setShortcutsEnabled(false);
      setShortcutsEnabled(true);
      expect(getShortcutsEnabled()).toBe(true);
    });
  });

  describe('getCombo / setCombo / resetCombo', () => {
    it('returns default combo when no override exists', () => {
      const combo = getCombo('terminal.nextTab');
      expect(combo).toEqual({ key: ']', ctrl: true });
    });

    it('returns empty key for unknown ID', () => {
      expect(getCombo('nonexistent')).toEqual({ key: '' });
    });

    it('persists custom combo', () => {
      const custom: KeyCombo = { key: 'n', ctrl: true, shift: true };
      setCombo('terminal.nextTab', custom);
      expect(getCombo('terminal.nextTab')).toEqual(custom);
    });

    it('resets to default', () => {
      setCombo('terminal.nextTab', { key: 'x' });
      resetCombo('terminal.nextTab');
      expect(getCombo('terminal.nextTab')).toEqual({ key: ']', ctrl: true });
    });
  });

  describe('resetAll', () => {
    it('clears all overrides', () => {
      setCombo('terminal.nextTab', { key: 'x' });
      setCombo('terminal.prevTab', { key: 'y' });
      resetAll();
      expect(getCombo('terminal.nextTab')).toEqual(SHORTCUT_DEFINITIONS[0].defaultCombo);
      expect(getCombo('terminal.prevTab')).toEqual(SHORTCUT_DEFINITIONS[1].defaultCombo);
    });
  });
});
