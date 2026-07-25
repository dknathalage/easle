// Compile AI/user-authored JSX to CommonJS once, at write time (Electron main).
// The renderer bundle provides `React` as a global; the classic JSX runtime keeps
// output dependency-free (no jsx-runtime import).
//
// Uses Sucrase (pure JS) rather than esbuild: esbuild spawns a platform binary,
// which fails from inside a packaged app.asar ("spawn ENOTDIR"). Sucrase has no
// native binary, so it packs into the asar and runs unchanged in the built app.
// The 'imports' transform lowers ESM (import/export) to CommonJS so the renderer
// can eval the output as a CJS module (module.exports.default + require('./Name')).
const { transform } = require('sucrase');

function compileJsx(source, opts = {}) {
  const result = transform(source, {
    transforms: ['jsx', 'imports'],
    jsxRuntime: 'classic',
    production: true,
    jsxPragma: 'React.createElement',
    jsxFragmentPragma: 'React.Fragment',
    filePath: opts.filename || 'component.jsx',
  });
  return { code: result.code };
}

module.exports = { compileJsx };
