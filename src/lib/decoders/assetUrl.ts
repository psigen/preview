/**
 * Resolve a staged decoder asset under public/vendor/.
 *
 * base is './' (see vite.config.ts), so this resolves against the current document rather
 * than assuming a root-absolute path — the same build has to work under
 * user.github.io/<repo>/ and under a custom domain.
 *
 * Outside a browser there is no document to resolve against, and no decoder that needs one:
 * Draco requires a Worker and KTX2 a WebGLRenderer, neither of which exists in Node. The
 * relative path is returned unchanged rather than inventing an origin.
 */
export function vendorUrl(relativePath: string): string {
  const path = `${import.meta.env.BASE_URL || './'}vendor/${relativePath}`;
  return typeof window === 'undefined' ? path : new URL(path, window.location.href).href;
}
