import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/store';
import type { Content, DocumentAssets } from '../store/types';
import type { RenderPayload } from '../content-renderer/render';
import { FONT_FACE_CSS } from './fonts';

interface Props {
  content?: Content;
  entered: boolean; // whether this node is "entered" for interaction
}

// URL of the built content-renderer bundle, resolved relative to the app document
// so it works both under the Vite dev server and the packaged file:// build.
const RENDERER_URL =
  typeof window !== 'undefined'
    ? new URL('content-renderer.html', window.location.href).href
    : 'content-renderer.html';

// Pure: legacy html/css/js srcDoc. Same behavior as before, with document-level
// shared assets (empty by default) injected ahead of the node's own css/js.
export function buildLegacySrcDoc(content?: Content, assets?: DocumentAssets): string {
  const html = content?.html ?? '';
  const css = content?.css ?? '';
  const js = content?.js ?? '';
  const aCss = assets?.css ?? '';
  const aJs = assets?.js ?? '';
  return (
    `<style>${FONT_FACE_CSS}</style>` +
    `<style>*{box-sizing:border-box}html,body{margin:0;padding:0}${aCss}${css}</style>` +
    html +
    // split the closing script tag so it doesn't terminate our own string
    `<script>${aJs}<\/script>` +
    `<script>${js}<\/script>`
  );
}

// Pure: the payload the content-renderer bundle expects. React path when the node
// carries compiled output; otherwise raw (legacy) mode.
export function buildRenderPayload(
  content?: Content,
  assets?: DocumentAssets,
  components?: Record<string, string>,
): RenderPayload {
  const a = { css: assets?.css ?? '', js: assets?.js ?? '' };
  if (content?.compiled) {
    return { mode: 'react', compiled: content.compiled, components: components ?? {}, assets: a };
  }
  return {
    mode: 'raw',
    assets: a,
    raw: { html: content?.html ?? '', css: content?.css ?? '', js: content?.js ?? '' },
  };
}

// Stable-ish key so React remounts the iframe (fresh document + root) whenever the
// react payload changes — avoids re-calling createRoot on the same node.
function hashPayload(p: RenderPayload): string {
  const s = JSON.stringify(p);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

// Sandboxed content renderer. Legacy nodes render via srcDoc exactly as before;
// React nodes load the content-renderer bundle and receive their payload by
// postMessage. sandbox="allow-scripts" isolates styles+script from the tool.
export function ContentFrame({ content, entered }: Props) {
  const assets = useStore((s) => s.assets);
  const components = useStore((s) => s.components);
  const isReact = !!content?.compiled;

  const payload = useMemo(
    () => buildRenderPayload(content, assets, components),
    [content?.compiled, content?.html, content?.css, content?.js, assets, components],
  );
  const reactKey = isReact ? hashPayload(payload) : 'legacy';

  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!isReact) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const post = () => iframe.contentWindow?.postMessage({ type: 'easle:render', payload }, '*');
    iframe.addEventListener('load', post);
    return () => iframe.removeEventListener('load', post);
  }, [reactKey, isReact, payload]);

  const pointerEvents = entered ? ('auto' as const) : ('none' as const);

  if (isReact) {
    return (
      <iframe
        key={reactKey}
        ref={iframeRef}
        className="content-frame"
        title="content"
        sandbox="allow-scripts"
        src={RENDERER_URL}
        style={{ pointerEvents }}
      />
    );
  }

  return (
    <iframe
      className="content-frame"
      title="content"
      sandbox="allow-scripts"
      srcDoc={buildLegacySrcDoc(content, assets)}
      style={{ pointerEvents }}
    />
  );
}
