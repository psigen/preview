import { useEffect, useRef } from 'react';

interface Props {
  onClose(): void;
}

/**
 * Licences and provenance, shown over the viewer rather than in place of it.
 *
 * An overlay specifically so the app underneath stays mounted: rendering this as a route
 * unmounted the viewer and disposed whatever model was open.
 */
export function About({ onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  return (
    <div
      className="about-overlay"
      // Clicking the backdrop dismisses, but a click inside must not bubble out to it.
      onClick={onClose}
      role="presentation"
    >
      <section
        className="card prose about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="about-head">
          <h1 id="about-title">About preview</h1>
          <button
            ref={closeButton}
            type="button"
            className="link"
            data-action="about-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p>
          A client-side 3D mesh and CAD viewer. Files are read entirely in your browser — nothing is
          uploaded to any server, and the app makes no network requests at all once it has loaded.
        </p>

        <h2>Licences</h2>
        <p>
          preview itself is MIT licensed. Every dependency is MIT except one: CAD import (STEP and
          IGES) uses <a href="https://github.com/kovacsv/occt-import-js">occt-import-js</a>, which
          is LGPL-2.1 and statically links Open CASCADE Technology.
        </p>
        <p>
          Its WebAssembly build is never bundled — it is served as a separate, unmodified,
          replaceable file, so relinking a rebuilt copy stays possible, which is what LGPL asks for.
          Both licence texts are served beside it:
        </p>
        <ul>
          <li>
            <a href="./vendor/occt/license.occt.txt">Open CASCADE Technology licence</a>
          </li>
          <li>
            <a href="./vendor/occt/license.occt-import-js.txt">occt-import-js licence</a>
          </li>
        </ul>
        <p>
          A build made with <code>VITE_ENABLE_CAD=0</code> omits CAD support entirely and contains
          no LGPL artifacts.
        </p>
      </section>
    </div>
  );
}
