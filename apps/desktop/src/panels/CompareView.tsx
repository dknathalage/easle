import { useEffect, useState } from 'react';
import { getCanvas } from '../store/ipc';
import type { CanvasNode } from '../store/types';

interface Props {
  versionIds: number[];
  singleSnapshot?: string | null;
  onClose: () => void;
}

interface SnapPane {
  title: string;
  nodes: CanvasNode[];
}

// Read-only side-by-side snapshot viewer (v1 compare). Renders each version's
// content nodes as static thumbnails; no diff highlighting yet.
export function CompareView({ versionIds, singleSnapshot, onClose }: Props) {
  const [panes, setPanes] = useState<SnapPane[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result: SnapPane[] = [];
      if (singleSnapshot != null && versionIds.length >= 1) {
        result.push({ title: `Version ${versionIds[0]}`, nodes: parseNodes(singleSnapshot) });
      } else {
        for (const id of versionIds) {
          const v = await getCanvas().getVersion(id);
          result.push({ title: `v${v.n} — ${v.summary}`, nodes: parseNodes(v.snapshot) });
        }
      }
      if (!cancelled) setPanes(result);
    })();
    return () => { cancelled = true; };
  }, [versionIds.join(','), singleSnapshot]);

  return (
    <div className="compare-overlay" onClick={onClose}>
      <div className="compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compare-head">
          <span>Compare (read-only)</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="compare-split">
          {panes.map((p, i) => (
            <div className="compare-pane" key={i}>
              <div className="compare-pane-title">{p.title}</div>
              <div className="compare-canvas">
                {p.nodes.filter((n) => n.parentId == null).map((n) => (
                  <SnapNode key={n.id} node={n} all={p.nodes} />
                ))}
              </div>
            </div>
          ))}
          {panes.length === 0 && <div className="compare-pane"><div className="panel-empty">Loading…</div></div>}
        </div>
      </div>
    </div>
  );
}

function SnapNode({ node, all }: { node: CanvasNode; all: CanvasNode[] }) {
  if (!node.visible) return null;
  const kids = all.filter((n) => n.parentId === node.id);
  return (
    <div
      className={`snap-node snap-${node.type}`}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
    >
      {(node.type === 'frame' || node.type === 'group') && <div className="snap-label">{node.name}</div>}
      {node.type === 'content' && node.content && (
        <iframe
          className="snap-frame"
          title={`snap-${node.id}`}
          sandbox=""
          srcDoc={`<style>*{box-sizing:border-box}html,body{margin:0}${node.content.css}</style>${node.content.html}`}
        />
      )}
      {kids.map((k) => <SnapNode key={k.id} node={k} all={all} />)}
    </div>
  );
}

function parseNodes(snapshot: string): CanvasNode[] {
  try {
    const parsed = JSON.parse(snapshot);
    // snapshot shape is flexible; accept {nodes:[...]} or [...] or {document,nodes}
    const nodes: any[] = Array.isArray(parsed) ? parsed : parsed.nodes ?? [];
    return nodes.map((n) => ({
      ...n,
      // contents may live inline as n.content or under a contents map — normalize inline
      content: n.content ?? undefined,
    }));
  } catch {
    return [];
  }
}
