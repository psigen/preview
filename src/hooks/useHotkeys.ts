import { useEffect, useRef } from 'react';
import { resolveHotkey, type HotkeyAction } from '../lib/hotkeys';

/**
 * Global viewer shortcuts.
 *
 * Bound once with an empty dependency list, with a ref carrying the current handler, so the
 * listener is never torn down and re-added while the user is mid-interaction. The ref is
 * written in an effect rather than during render, because writing one during render is
 * unsafe under concurrent rendering and a keystroke can only arrive after paint.
 */
export function useHotkeys(onAction: (action: HotkeyAction) => void, enabled = true): void {
  const params = useRef({ onAction, enabled });
  useEffect(() => {
    params.current = { onAction, enabled };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!params.current.enabled) return;
      const action = resolveHotkey(event, event.target as HTMLElement | null);
      if (!action) return;
      event.preventDefault();
      params.current.onAction(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
