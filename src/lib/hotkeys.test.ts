import { describe, expect, it } from 'vitest';
import { isTypingTarget, resolveHotkey } from './hotkeys';

const press = (key: string, over: Record<string, unknown> = {}) => ({ key, ...over });

describe('resolveHotkey', () => {
  it.each([
    ['1', 'front'],
    ['2', 'back'],
    ['3', 'right'],
    ['4', 'left'],
    ['5', 'top'],
    ['6', 'bottom'],
    ['7', 'iso'],
  ])('%s selects the %s view', (key, view) => {
    expect(resolveHotkey(press(key), null)).toEqual({ kind: 'view', view });
  });

  it.each(['f', 'F', 'Home'])('%s fits the model', (key) => {
    expect(resolveHotkey(press(key), null)).toEqual({ kind: 'fit' });
  });

  it('ignores unmapped keys', () => {
    for (const key of ['0', '8', 'g', 'Escape', 'Enter', ' ']) {
      expect(resolveHotkey(press(key), null), key).toBeNull();
    }
  });

  /** Ctrl+1 switches browser tab, Cmd+F opens find. Those must not be stolen. */
  it.each(['ctrlKey', 'metaKey', 'altKey'])('leaves %s combinations to the browser', (mod) => {
    expect(resolveHotkey(press('1', { [mod]: true }), null)).toBeNull();
    expect(resolveHotkey(press('f', { [mod]: true }), null)).toBeNull();
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea'])(
    'does nothing while typing in a %s',
    (tagName) => {
      expect(resolveHotkey(press('1'), { tagName })).toBeNull();
    },
  );

  it('does nothing in a contenteditable region', () => {
    expect(resolveHotkey(press('5'), { tagName: 'DIV', isContentEditable: true })).toBeNull();
  });

  it('still fires over an ordinary element', () => {
    expect(resolveHotkey(press('5'), { tagName: 'DIV' })).toEqual({ kind: 'view', view: 'top' });
    expect(resolveHotkey(press('5'), { tagName: 'BUTTON' })).toEqual({ kind: 'view', view: 'top' });
  });
});

describe('isTypingTarget', () => {
  it('handles a missing target', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});
