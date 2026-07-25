import { useEffect } from 'react';
import { useStore, absolutePos } from './store/store';
import { Canvas } from './canvas/Canvas';
import { LayersPanel } from './panels/LayersPanel';
import { NotesPanel } from './panels/NotesPanel';
import { VersionBar } from './panels/VersionBar';
import { ReviewBar } from './panels/ReviewBar';
import { PagesBar } from './panels/PagesBar';
import { PreferencesPanel } from './panels/PreferencesPanel';
import { ModalHost } from './components/ModalHost';
import './styles/app.css';

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

export default function App() {
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const document = useStore((s) => s.document);

  useEffect(() => { init(); }, [init]);

  useGlobalShortcuts();

  return (
    <div className="app-shell">
      <VersionBar />
      <ReviewBar />
      <div className="app-main">
        <LayersPanel />
        <div className="app-center">
          <PagesBar />
          {loading && <div className="center-msg">Loading…</div>}
          {!loading && !document && <div className="center-msg">No documents found.</div>}
          {!loading && document && <Canvas />}
          <ZoomControls />
        </div>
        <NotesPanel />
        <PreferencesPanel />
      </div>
      <ModalHost />
    </div>
  );
}

function ZoomControls() {
  const camera = useStore((s) => s.camera);
  const setCamera = useStore((s) => s.setCamera);
  const nodes = useStore((s) => s.nodes);

  const setZoom = (zoom: number) => {
    // zoom around canvas center (approx) keeping current pan proportional
    setCamera({ zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX) });
  };

  const zoomToFit = () => {
    const roots = nodes.filter((n) => n.visible);
    if (roots.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes.filter((x) => x.parentId == null && x.visible)) {
      const p = absolutePos(nodes, n);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.w);
      maxY = Math.max(maxY, p.y + n.h);
    }
    if (!isFinite(minX)) return;
    const el = window.document.querySelector('.canvas-wrap') as HTMLElement | null;
    const vw = el?.clientWidth ?? 800;
    const vh = el?.clientHeight ?? 600;
    const pad = 60;
    const zoom = clamp(Math.min((vw - pad * 2) / (maxX - minX || 1), (vh - pad * 2) / (maxY - minY || 1)), ZOOM_MIN, ZOOM_MAX);
    const x = (vw - (maxX - minX) * zoom) / 2 - minX * zoom;
    const y = (vh - (maxY - minY) * zoom) / 2 - minY * zoom;
    setCamera({ zoom, x, y });
  };

  return (
    <div className="zoom-controls">
      <button onClick={() => setZoom(camera.zoom / 1.2)}>−</button>
      <button className="zoom-readout" onClick={() => setZoom(1)} title="Reset to 100%">
        {Math.round(camera.zoom * 100)}%
      </button>
      <button onClick={() => setZoom(camera.zoom * 1.2)}>＋</button>
      <button className="zoom-fit" onClick={zoomToFit}>Fit</button>
    </div>
  );
}

function useGlobalShortcuts() {
  const store = useStore;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      const s = store.getState();
      const meta = e.metaKey || e.ctrlKey;

      // group / ungroup
      if (meta && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelection();
        else s.groupSelection();
        return;
      }
      // note mode toggle
      if (e.key.toLowerCase() === 'n' && !meta) {
        s.setMode(s.mode === 'note' ? 'select' : 'note');
        return;
      }
      // escape -> back to select + clear
      if (e.key === 'Escape') {
        s.setMode('select');
        s.enterNode(null);
        return;
      }
      // delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) {
        e.preventDefault();
        s.deleteSelection();
        return;
      }
      // arrow nudge
      if (s.selection.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.moveSelectionBy(dx, dy);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
