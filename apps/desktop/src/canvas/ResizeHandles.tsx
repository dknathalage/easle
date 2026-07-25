import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../store/store';
import type { CanvasNode } from '../store/types';

interface Props {
  node: CanvasNode;
}

type Dir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
const DIRS: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// Eight resize handles around a selected node. Writes w/h (and x/y for N/W edges).
export function ResizeHandles({ node }: Props) {
  const camera = useStore((s) => s.camera);
  const updateNode = useStore((s) => s.updateNode);
  const start = useRef<{ mx: number; my: number; x: number; y: number; w: number; h: number; dir: Dir } | null>(null);

  const begin = (dir: Dir) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = { mx: e.clientX, my: e.clientY, x: node.x, y: node.y, w: node.w, h: node.h, dir };
  };

  const move = (e: ReactPointerEvent) => {
    if (!start.current) return;
    e.stopPropagation();
    const s = start.current;
    const dx = (e.clientX - s.mx) / camera.zoom;
    const dy = (e.clientY - s.my) / camera.zoom;
    let { x, y, w, h } = s;
    const min = 16;
    if (s.dir.includes('e')) w = Math.max(min, s.w + dx);
    if (s.dir.includes('s')) h = Math.max(min, s.h + dy);
    if (s.dir.includes('w')) { w = Math.max(min, s.w - dx); x = s.x + (s.w - w); }
    if (s.dir.includes('n')) { h = Math.max(min, s.h - dy); y = s.y + (s.h - h); }
    updateNode(node.id, { x, y, w, h });
  };

  const end = (e: ReactPointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    start.current = null;
  };

  return (
    <>
      {DIRS.map((dir) => (
        <div
          key={dir}
          className={`resize-handle rh-${dir}`}
          onPointerDown={begin(dir)}
          onPointerMove={move}
          onPointerUp={end}
        />
      ))}
    </>
  );
}
