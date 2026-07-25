import { useStore } from '../store/store';
import { getCanvas } from '../store/ipc';

// Top-bar Project + Document pickers. Switching either changes which document
// the canvas shows (store.currentProjectId / documentId). Follows the small
// dropdown style used elsewhere (PagesBar).
export function ProjectBar() {
  const projects = useStore((s) => s.projects);
  const documents = useStore((s) => s.documents);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const documentId = useStore((s) => s.documentId);
  const selectProject = useStore((s) => s.selectProject);
  const selectDocument = useStore((s) => s.selectDocument);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const promptText = useStore((s) => s.promptText);

  const addProject = async () => {
    const name = await promptText('Project name', 'New Project');
    if (typeof name !== 'string' || !name.trim()) return;
    const p = await getCanvas().createProject({ name: name.trim() });
    await refreshProjects();
    if (p && p.id) await selectProject(p.id);
  };

  const addDocument = async () => {
    if (currentProjectId == null) return;
    const name = await promptText('Document name', 'New Document');
    if (typeof name !== 'string' || !name.trim()) return;
    const d = await getCanvas().createDocument({ projectId: currentProjectId, name: name.trim() });
    await refreshProjects();
    if (d && d.id) await selectDocument(d.id);
  };

  if (!projects.length) return null;

  return (
    <div className="project-bar">
      <select
        className="pb-select"
        value={currentProjectId ?? ''}
        onChange={(e) => selectProject(Number(e.target.value))}
        title="Project"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button className="pb-add" title="New project" onClick={addProject}>＋</button>

      <span className="pb-sep">/</span>

      <select
        className="pb-select"
        value={documentId ?? ''}
        onChange={(e) => selectDocument(Number(e.target.value))}
        title="Document"
        disabled={!documents.length}
      >
        {documents.length === 0 && <option value="">No documents</option>}
        {documents.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      <button className="pb-add" title="New document" onClick={addDocument} disabled={currentProjectId == null}>＋</button>
    </div>
  );
}
