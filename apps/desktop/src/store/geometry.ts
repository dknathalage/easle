// Pure canvas geometry helpers — no store/DOM dependencies, so they are unit
// testable in isolation. store.ts re-exports these for existing import sites.

import type { CanvasNode } from './types';

// absolute position of a node = sum of ancestor x/y offsets
export function absolutePos(nodes: CanvasNode[], node: CanvasNode): { x: number; y: number } {
  let x = node.x;
  let y = node.y;
  let cur = node;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  while (cur.parentId != null) {
    const p = byId.get(cur.parentId);
    if (!p) break;
    x += p.x;
    y += p.y;
    cur = p;
  }
  return { x, y };
}

// The page a node belongs to = the pageId of its top-level (root) ancestor.
// Children carry pageId=null, so we must walk up to the root to find it.
export function nodePageId(nodes: CanvasNode[], node: CanvasNode): number | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur: CanvasNode | undefined = node;
  while (cur && cur.parentId != null) {
    cur = byId.get(cur.parentId);
  }
  return cur ? cur.pageId ?? null : null;
}

// Topmost visible node ON THE GIVEN PAGE whose absolute bounds contain the point.
// Scoping to `pageId` is essential: frames on different pages are commonly laid
// out at the same world coordinates, so an unscoped hit-test binds a note to an
// overlapping node on another page (wrong screen). Prefers content over frames,
// then highest z.
export function nodeAtPoint(
  nodes: CanvasNode[],
  wx: number,
  wy: number,
  pageId: number | null
): CanvasNode | null {
  const hits = nodes.filter((n) => {
    if (!n.visible) return false;
    if (nodePageId(nodes, n) !== pageId) return false;
    const p = absolutePos(nodes, n);
    return wx >= p.x && wx <= p.x + n.w && wy >= p.y && wy <= p.y + n.h;
  });
  if (!hits.length) return null;
  hits.sort((a, b) => (a.type === 'content' ? 1 : 0) - (b.type === 'content' ? 1 : 0) || a.z - b.z);
  return hits[hits.length - 1];
}
