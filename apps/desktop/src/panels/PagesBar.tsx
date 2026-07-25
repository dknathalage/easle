import { useStore } from '../store/store';
import { getCanvas } from '../store/ipc';

// Figma-style page tabs. Switching a page filters the canvas + Layers to that
// page's frames and fits them into view.
export function PagesBar() {
  const pages = useStore((s) => s.pages);
  const currentPageId = useStore((s) => s.currentPageId);
  const setPage = useStore((s) => s.setPage);
  const documentId = useStore((s) => s.documentId);
  const promptText = useStore((s) => s.promptText);
  const reload = useStore((s) => s.reload);

  const addPage = async () => {
    if (documentId == null) return;
    const name = await promptText('Page name', 'New Page');
    if (typeof name !== 'string' || !name.trim()) return;
    const p = await getCanvas().createPage({ documentId, name: name.trim() });
    await reload();
    if (p && p.id) setPage(p.id);
  };

  const rename = async (id: number, current: string) => {
    const name = await promptText('Rename page', current);
    if (typeof name !== 'string' || !name.trim()) return;
    await getCanvas().renamePage(id, name.trim());
    await reload();
  };

  if (!pages.length) return null;
  return (
    <div className="pages-bar">
      <span className="pages-label">Pages</span>
      {pages.map((p) => (
        <button
          key={p.id}
          className={`page-tab ${p.id === currentPageId ? 'on' : ''}`}
          onClick={() => setPage(p.id)}
          onDoubleClick={() => rename(p.id, p.name)}
          title="Click to open · double-click to rename"
        >
          {p.name}
        </button>
      ))}
      <button className="page-add" title="Add page" onClick={addPage}>＋</button>
    </div>
  );
}
