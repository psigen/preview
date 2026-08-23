/**
 * Which action a keystroke maps to, as pure logic.
 *
 * Separated from the DOM binding so the parts that are easy to get wrong — the ignore list
 * and the Space carve-out — are testable without dispatching events.
 */
export type HotkeyAction =
  | { kind: 'view'; view: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom' | 'iso' }
  | { kind: 'fit' };

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

export interface TargetLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}

const VIEW_KEYS: Record<string, Extract<HotkeyAction, { kind: 'view' }>['view']> = {
  '1': 'front',
  '2': 'back',
  '3': 'right',
  '4': 'left',
  '5': 'top',
  '6': 'bottom',
  '7': 'iso',
};

/** Typing in any of these must never trigger a shortcut. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TYPING_TAGS.has((target.tagName ?? '').toUpperCase());
}

/**
 * @returns the action to run, or null to leave the keystroke alone.
 */
export function resolveHotkey(
  event: KeyEventLike,
  target: TargetLike | null | undefined,
): HotkeyAction | null {
  // A modified key belongs to the browser or the OS, never to us.
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(target)) return null;

  const view = VIEW_KEYS[event.key];
  if (view) return { kind: 'view', view };
  if (event.key === 'f' || event.key === 'F' || event.key === 'Home') return { kind: 'fit' };
  return null;
}
