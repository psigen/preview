import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

/**
 * The app is mounted once and never swapped.
 *
 * Routing used to render <About /> INSTEAD of <App />, which unmounted the viewer and ran
 * its cleanup — so reading the licences disposed the loaded model and returned you to an
 * empty state. About is an overlay now; see useHashRoute.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
