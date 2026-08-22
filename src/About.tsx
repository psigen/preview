export function About() {
  return (
    <div className="prose-page">
      <section className="card prose">
        <h1>About preview</h1>
        <p>
          A client-side 3D mesh and CAD viewer. Files are read entirely in your browser — nothing is
          uploaded to any server, and the app works offline once loaded.
        </p>
        <h2>Licences</h2>
        <p>
          preview itself is MIT licensed. CAD import (STEP, IGES, BREP) uses{' '}
          <a href="https://github.com/kovacsv/occt-import-js">occt-import-js</a>, which is LGPL-2.1
          and bundles Open CASCADE Technology. Unmodified copies of that library and its licence
          texts are served alongside this app under <code>vendor/occt/</code>.
        </p>
        <p>
          <a href="#/">← Back to the viewer</a>
        </p>
      </section>
    </div>
  );
}
