// Compile AI/user-authored JSX to CommonJS once, at write time (Electron main).
// The renderer bundle provides `React` as a global; classic runtime keeps output
// dependency-free (no import of a jsx-runtime).
const esbuild = require('esbuild');

function compileJsx(source, opts = {}) {
  const result = esbuild.transformSync(source, {
    loader: 'jsx',
    format: 'cjs',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    sourcefile: opts.filename || 'component.jsx',
  });
  return { code: result.code };
}

module.exports = { compileJsx };
