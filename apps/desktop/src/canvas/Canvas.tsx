import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useStore, absolutePos, nodeAtPoint, nodePageId } from '../store/store';
import type { CanvasNode } from '../store/types';
import { NodeView } from './NodeView';
import { NotePin } from './NotePin';

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

export function Canvas() {
  const nodes = useStore((s) => s.nodes);
  const notes = useStore((s) => s.notes);
  const camera = useStore((s) => s.camera);
  const mode = useStore((s) => s.mode);
  const currentPageId = useStore((s) => s.currentPageId);
  const setCamera = useStore((s) => s.setCamera);
  const panBy = useStore((s) => s.panBy);
  const clearSelection = useStore((s) => s.clearSelection);
  const createNote = useStore((s) => s.createNote);
  const setMode = useStore((s) => s.setMode);
  const promptText = useStore((s) => s.promptText);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const spaceDown = useRef(false);
  const panning = useRef<{ startX: number; startY: number } | null>(null);
  const fittedPage = useRef<number | null>(null);

  // Fit the current page's frames into view once (when the page changes and its
  // nodes are available). Doesn't refit during editing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || currentPageId == null || fittedPage.current === currentPageId) return;
    const pageRoots = nodes.filter((n) => n.parentId == null && n.pageId === currentPageId && n.visible);
    if (!pageRoots.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of pageRoots) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    }
    const vw = el.clientWidth, vh = el.clientHeight, pad = 60;
    const zoom = clamp(Math.min((vw - pad * 2) / (maxX - minX || 1), (vh - pad * 2) / (maxY - minY || 1)), ZOOM_MIN, ZOOM_MAX);
    setCamera({ zoom, x: (vw - (maxX - minX) * zoom) / 2 - minX * zoom, y: (vh - (maxY - minY) * zoom) / 2 - minY * zoom });
    fittedPage.current = currentPageId;
  }, [currentPageId, nodes, setCamera]);

  // track spacebar for space-drag pan
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) { spaceDown.current = true; }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const px = sx - (rect?.left ?? 0);
    const py = sy - (rect?.top ?? 0);
    return { x: (px - camera.x) / camera.zoom, y: (py - camera.y) / camera.zoom };
  }, [camera]);

  const onWheel = (e: ReactWheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // zoom toward cursor
      e.preventDefault();
      const rect = wrapRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const worldX = (px - camera.x) / camera.zoom;
      const worldY = (py - camera.y) / camera.zoom;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const zoom = clamp(camera.zoom * factor, ZOOM_MIN, ZOOM_MAX);
      setCamera({ zoom, x: px - worldX * zoom, y: py - worldY * zoom });
    } else {
      // wheel to pan
      panBy(-e.deltaX, -e.deltaY);
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const isMiddle = e.button === 1;
    const wantPan = isMiddle || (spaceDown.current && e.button === 0);
    if (wantPan) {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      panning.current = { startX: e.clientX, startY: e.clientY };
      return;
    }
    // background click (select mode) clears selection; note mode is handled by
    // the full-canvas capture overlay below.
    if (mode !== 'note' && (e.target === wrapRef.current || (e.target as HTMLElement).classList.contains('canvas-plane'))) {
      clearSelection();
    }
  };

  // In note mode, an overlay covers the whole canvas (including content iframes)
  // so a click anywhere places a note — Electron has no window.prompt, so we use
  // the in-app modal for the body.
  const onPlaceNote = async (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // allow panning within note mode via space/middle
    if (e.button === 1 || spaceDown.current) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      panning.current = { startX: e.clientX, startY: e.clientY };
      return;
    }
    const w = screenToWorld(e.clientX, e.clientY);
    // Scope the hit-test to the page being viewed so the note never binds to an
    // overlapping node on another page (frames across pages share coordinates).
    const host = nodeAtPoint(nodes, w.x, w.y, currentPageId);
    const body = await promptText('Note');
    if (typeof body === 'string' && body.trim()) {
      if (host) {
        const abs = absolutePos(nodes, host);
        await createNote(w.x - abs.x, w.y - abs.y, body.trim(), host.id);
      } else {
        await createNote(w.x, w.y, body.trim(), null);
      }
    }
    setMode('select');
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (panning.current) {
      const dx = e.clientX - panning.current.startX;
      const dy = e.clientY - panning.current.startY;
      panning.current = { startX: e.clientX, startY: e.clientY };
      panBy(dx, dy);
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    panning.current = null;
  };

  const roots = nodes.filter((n) => n.parentId == null && n.pageId === currentPageId).sort((a, b) => a.z - b.z);
  const kidsOf = (id: number): CanvasNode[] => nodes.filter((n) => n.parentId === id).sort((a, b) => a.z - b.z);

  // note pins with node-relative positions resolved to world coords
  const pinWorld = (n: typeof notes[number]) => {
    if (n.nodeId == null) return { x: n.x, y: n.y };
    const host = nodes.find((x) => x.id === n.nodeId);
    if (!host) return { x: n.x, y: n.y };
    const abs = absolutePos(nodes, host);
    return { x: abs.x + n.x, y: abs.y + n.y };
  };

  // Only show notes for the page being viewed. A note attached to a node belongs
  // to that node's page; canvas-pinned notes (nodeId=null) are document-level.
  const pageNotes = notes.filter((n) => {
    if (n.nodeId == null) return true;
    const host = nodes.find((x) => x.id === n.nodeId);
    if (!host) return false;
    return nodePageId(nodes, host) === currentPageId;
  });

  const cursor = panning.current ? 'grabbing' : spaceDown.current ? 'grab' : mode === 'note' ? 'crosshair' : 'default';

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      style={{ cursor }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="canvas-plane"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {roots.map((n) => (
          <NodeView key={n.id} node={n} childrenNodes={kidsOf(n.id)} allNodes={nodes} />
        ))}
        {pageNotes.map((n) => {
          const w = pinWorld(n);
          return <NotePin key={n.id} note={{ ...n, x: w.x, y: w.y }} />;
        })}
      </div>
      {mode === 'note' && (
        <div
          className="note-capture"
          style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 50 }}
          onPointerDown={onPlaceNote}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}
