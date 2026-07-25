import type { Root } from 'react-dom/client';

export interface RenderPayload {
  mode: 'react' | 'raw';
  compiled?: string;
  components?: Record<string, string>;
  assets: { css: string; js: string };
  raw?: { html: string; css: string; js: string };
}

/**
 * Eval a compiled CJS module string in a scoped function. `require('react')`
 * resolves to the passed React; `require('./ComponentName')` resolves to a
 * sibling component via `resolve`.
 */
function evalModule(code: string, React: any, resolve: (name: string) => any) {
  const module = { exports: {} as any };
  const require = (name: string) => {
    if (name === 'react') return React;
    const clean = name.replace(/^\.\//, '');
    const c = resolve(clean);
    if (!c) throw new Error(`unknown component: ${name}`);
    return { default: c, __esModule: true };
  };
  // eslint-disable-next-line no-new-func
  new Function('React', 'module', 'exports', 'require', code)(
    React,
    module,
    module.exports,
    require,
  );
  return module.exports.default || module.exports;
}

/**
 * Render a RenderPayload into `mountEl`. Intended to run inside a
 * sandbox="allow-scripts" iframe — never assumes host access.
 */
export function renderPayload(
  payload: RenderPayload,
  mountEl: HTMLElement,
  React: any,
  ReactDOM?: { createRoot: (el: Element) => Root },
) {
  // Shared document css/js (may be empty).
  if (payload.assets.css) {
    const s = document.createElement('style');
    s.textContent = payload.assets.css;
    document.head.appendChild(s);
  }
  if (payload.assets.js) {
    const j = document.createElement('script');
    j.textContent = payload.assets.js;
    document.body.appendChild(j);
  }

  if (payload.mode === 'raw' && payload.raw) {
    if (payload.raw.css) {
      const s = document.createElement('style');
      s.textContent = payload.raw.css;
      document.head.appendChild(s);
    }
    mountEl.innerHTML = payload.raw.html;
    if (payload.raw.js) {
      const j = document.createElement('script');
      j.textContent = payload.raw.js;
      document.body.appendChild(j);
    }
    return;
  }

  const registry: Record<string, any> = {};
  const resolve = (name: string) => registry[name];
  // Components may reference earlier ones via require('./Name').
  for (const [name, code] of Object.entries(payload.components || {})) {
    registry[name] = evalModule(code, React, resolve);
  }
  const Component = evalModule(
    payload.compiled || 'module.exports.default = () => null',
    React,
    resolve,
  );
  if (ReactDOM) {
    ReactDOM.createRoot(mountEl).render(React.createElement(Component));
  }
}
