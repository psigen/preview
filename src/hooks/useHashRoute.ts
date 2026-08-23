import { useEffect, useState } from 'react';

export type Route = 'viewer' | 'about';

function routeFromHash(hash: string): Route {
  return hash.startsWith('#/about') ? 'about' : 'viewer';
}

/**
 * Hash routing, by hand and without a router dependency, so a deep link survives a refresh
 * on GitHub Pages — which cannot rewrite paths.
 *
 * Returns a route rather than swapping the tree: About is shown as an overlay ABOVE the
 * viewer, because swapping it in would unmount the app and take the loaded model with it.
 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState(() =>
    typeof window === 'undefined' ? 'viewer' : routeFromHash(window.location.hash),
  );

  useEffect(() => {
    const onChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

/** Leave a hash route without adding a history entry or leaving a bare '#' behind. */
export function closeHashRoute(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
