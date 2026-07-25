import { useState } from 'react';
import { useStore } from '../store/store';
import { useSettings } from '../store/settings';
import { getCanvas } from '../store/ipc';
import type { Version } from '../store/types';
import { CompareView } from './CompareView';
import { ProjectBar } from './ProjectBar';

export function VersionBar() {
  const versions = useStore((s) => s.versions);
  const usingMock = useStore((s) => s.usingMock);
  const saveVersion = useStore((s) => s.saveVersion);
  const restoreVersion = useStore((s) => s.restoreVersion);
  const promptText = useStore((s) => s.promptText);
  const confirmDialog = useStore((s) => s.confirmDialog);

  const [open, setOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const onSave = async () => {
    const summary = await promptText('Version summary');
    if (typeof summary === 'string' && summary.trim()) await saveVersion(summary.trim());
  };

  const toggleCompare = (id: number) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id].slice(-2); // keep last two
    });
  };

  const openVersion = async (v: Version) => {
    const full = await getCanvas().getVersion(v.id);
    // read-only peek: show single snapshot in the compare view (left only)
    setCompareIds([v.id]);
    setSingleSnapshot(full.snapshot);
    setShowCompare(true);
  };
  const [singleSnapshot, setSingleSnapshot] = useState<string | null>(null);

  return (
    <div className="version-bar">
      <div className="vb-title">
        <strong className="vb-brand">Easle</strong>
        <ProjectBar />
        {usingMock && <span className="vb-mock">mock mode — window.easle not found</span>}
      </div>
      <div className="vb-actions">
        <button className="vb-gear" title="Preferences" onClick={() => useSettings.getState().toggle()}>⚙</button>
        <button onClick={onSave}>Save version</button>
        <div className="vb-dropdown">
          <button onClick={() => setOpen((o) => !o)}>
            Versions ({versions.length}) ▾
          </button>
          {open && (
            <div className="vb-menu">
              {versions.length === 0 && <div className="vb-menu-empty">No versions yet.</div>}
              {versions.slice().reverse().map((v) => (
                <div key={v.id} className="vb-menu-row">
                  <label className="vb-compare-check" title="Select to compare (max 2)">
                    <input
                      type="checkbox"
                      checked={compareIds.includes(v.id)}
                      onChange={() => toggleCompare(v.id)}
                    />
                  </label>
                  <span className="vb-vnum">v{v.n}</span>
                  <span className={`vb-vauthor vb-vauthor-${v.author}`}>{v.author}</span>
                  <span className="vb-vsummary" title={v.summary}>{v.summary}</span>
                  <button className="vb-open" onClick={() => openVersion(v)}>Open</button>
                  <button
                    className="vb-restore"
                    onClick={async () => {
                      if (await confirmDialog(`Restore v${v.n}? This replaces the live document.`)) {
                        await restoreVersion(v.id);
                        setOpen(false);
                      }
                    }}
                  >Restore</button>
                </div>
              ))}
              {compareIds.length === 2 && (
                <div className="vb-menu-foot">
                  <button onClick={() => { setSingleSnapshot(null); setShowCompare(true); }}>
                    Compare selected
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCompare && (
        <CompareView
          versionIds={compareIds}
          singleSnapshot={singleSnapshot}
          onClose={() => { setShowCompare(false); setSingleSnapshot(null); }}
        />
      )}
    </div>
  );
}
