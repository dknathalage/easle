import { useMemo } from 'react';
import type { Content } from '../store/types';
import { FONT_FACE_CSS } from './fonts';

interface Props {
  content?: Content;
  entered: boolean; // whether this node is "entered" for interaction
}

// Sandboxed content renderer. srcDoc composed from html/css/js per DESIGN §7.
// sandbox="allow-scripts" isolates styles+script from the tool and siblings.
export function ContentFrame({ content, entered }: Props) {
  const srcDoc = useMemo(() => {
    const html = content?.html ?? '';
    const css = content?.css ?? '';
    const js = content?.js ?? '';
    return (
      `<style>${FONT_FACE_CSS}</style>` +
      `<style>*{box-sizing:border-box}html,body{margin:0;padding:0}${css}</style>` +
      html +
      // split the closing script tag so it doesn't terminate our own string
      `<script>${js}<\/script>`
    );
  }, [content?.html, content?.css, content?.js]);

  return (
    <iframe
      className="content-frame"
      title="content"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      // pointer-events gated: only interactive when the node is "entered"
      style={{ pointerEvents: entered ? 'auto' : 'none' }}
    />
  );
}
