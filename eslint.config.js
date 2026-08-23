import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'public/vendor', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build/tooling scripts run in Node, not the browser.
    files: ['scripts/**/*.mjs', '*.config.{js,mjs}'],
    languageOptions: { globals: globals.nodeBuiltin },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // The app must work fully offline after load — it is a static GitHub Pages site with no
      // backend. These drei APIs fetch fonts or HDRIs from a CDN at runtime. Prose erodes; this
      // rule is what actually holds the line. See CLAUDE.md "No network at runtime".
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@react-three/drei',
              importNames: ['Text', 'Text3D', 'Environment', 'useEnvironment', 'Loader'],
              message:
                'Fetches fonts/HDRIs from a CDN at runtime. Use <Html> for text and RoomEnvironment for lighting.',
            },
          ],
        },
      ],
    },
  },
  {
    // react-hooks/immutability assumes a value returned from a hook is React data. In
    // react-three-fiber it is a three.js scene object, and mutating it IS the programming
    // model: the renderer reads camera.near, material.side and object.position directly.
    //
    // The declarative alternative — driving near/far through React state — would re-render
    // the tree on every frame of an orbit, which is precisely what this app is built to
    // avoid (frameloop="demand", zero renders during pointer motion). So the rule is a
    // false positive for the whole R3F layer, and only for that layer: it stays on for
    // src/lib and anything else.
    files: ['src/components/**/*.tsx', 'src/hooks/**/*.ts'],
    rules: { 'react-hooks/immutability': 'off' },
  },
  {
    // lib/ is the pure layer: no React, no JSX, so it stays testable in plain Node.
    files: ['src/lib/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', '@react-three/*'], message: 'src/lib must stay React-free.' },
          ],
        },
      ],
    },
  },
);
