export function About() {
  return (
    <div className="prose-page">
      <section className="card prose">
        <h1>About preview</h1>
        <p>
          A client-side 3D mesh and CAD viewer. Files are read entirely in your browser —
          nothing is uploaded to any server, and the app makes no network requests at all
          once it has loaded.
        </p>

        <h2>Licences</h2>
        <p>
          preview itself is MIT licensed. Every dependency is MIT except one: CAD import
          (STEP and IGES) uses{' '}
          <a href="https://github.com/kovacsv/occt-import-js">occt-import-js</a>, which is
          LGPL-2.1 and statically links Open CASCADE Technology.
        </p>
        <p>
          Its WebAssembly build is never bundled — it is served as a separate, unmodified,
          replaceable file, so relinking a rebuilt copy stays possible, which is what LGPL
          asks for. Both licence texts are served beside it:
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
          A build made with <code>VITE_ENABLE_CAD=0</code> omits CAD support entirely and
          contains no LGPL artifacts.
        </p>

        <p>
          <a href="#/">← Back to the viewer</a>
        </p>
      </section>
    </div>
  );
}
