import { create } from 'zustand';
import { getCanvas } from './ipc';
import type { CanvasDocument, CanvasNode, Note, NoteStatus, Project, Version } from './types';

export type Mode = 'select' | 'note';

export interface Page {
  id: number;
  documentId: number;
  name: string;
  idx: number;
}

// In-app modal state — Electron has no window.prompt/confirm, so we roll our own.
export interface ModalState {
  kind: 'prompt' | 'confirm';
  title: string;
  defaultValue: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (value: any) => void;
}

export interface Camera {
  x: number; // pan offset in screen px
  y: number;
  zoom: number;
}

interface StoreState {
  // data
  projects: Project[];
  currentProjectId: number | null;
  documents: CanvasDocument[]; // documents under the current project
  documentId: number | null; // the active document (currentDocumentId)
  document: CanvasDocument | null;
  nodes: CanvasNode[];
  notes: Note[];
  versions: Version[];
  pages: Page[];
  currentPageId: number | null;

  // ui
  selection: number[]; // node ids
  camera: Camera;
  mode: Mode;
  enteredNodeId: number | null; // node "entered" for iframe interaction
  collapsed: Record<number, boolean>; // layers panel collapse state by node id
  noteFilter: 'open' | 'all';
  loading: boolean;
  usingMock: boolean;

  // lifecycle
  init(): Promise<void>;
  reload(): Promise<void>;
  refreshProjects(): Promise<void>;

  // project / document switching
  selectProject(projectId: number): Promise<void>;
  selectDocument(documentId: number): Promise<void>;

  // selection
  select(id: number, additive?: boolean): void;
  clearSelection(): void;
  setSelection(ids: number[]): void;

  // camera
  setCamera(cam: Partial<Camera>): void;
  panBy(dx: number, dy: number): void;

  // mode
  setMode(mode: Mode): void;
  enterNode(id: number | null): void;
  toggleCollapsed(id: number): void;
  setNoteFilter(f: 'open' | 'all'): void;
  setPage(id: number): void;

  // node ops (write-through + local optimistic reload)
  updateNode(id: number, patch: Partial<CanvasNode>): Promise<void>;
  moveSelectionBy(dx: number, dy: number): Promise<void>;
  groupSelection(): Promise<void>;
  ungroupSelection(): Promise<void>;
  deleteSelection(): Promise<void>;

  // notes
  createNote(x: number, y: number, body: string, nodeId?: number | null): Promise<void>;
  resolveNote(id: number, resolution: 'resolved' | 'wontfix'): Promise<void>;

  // versions
  saveVersion(summary: string): Promise<void>;
  restoreVersion(id: number): Promise<void>;

  // review loop (user side)
  submitReview(): Promise<void>;
  approveReview(): Promise<void>;

  // in-app modal (prompt/confirm)
  modal: ModalState | null;
  promptText(title: string, defaultValue?: string): Promise<string | null>;
  confirmDialog(message: string): Promise<boolean>;
  resolveModal(value: string | boolean | null): void;
}

export const useStore = create<StoreState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  documents: [],
  documentId: null,
  document: null,
  nodes: [],
  notes: [],
  versions: [],
  pages: [],
  currentPageId: null,

  selection: [],
  camera: { x: 0, y: 0, zoom: 1 },
  mode: 'select',
  enteredNodeId: null,
  collapsed: {},
  noteFilter: 'open',
  loading: true,
  usingMock: typeof window !== 'undefined' && !window.easle,

  async init() {
    const api = getCanvas();
    const projects = await api.listProjects();
    const project = projects[0];
    if (!project) {
      set({ projects, loading: false });
      return;
    }
    const { documents } = await api.getProject(project.id);
    const doc = documents[0];
    set({
      projects,
      currentProjectId: project.id,
      documents,
      documentId: doc ? doc.id : null,
      document: doc ?? null,
      loading: false,
    });
    if (doc) await get().reload();
    // live refresh on any DB change (renderer or MCP)
    api.onChanged(() => {
      get().refreshProjects();
      get().reload();
    });
  },

  async refreshProjects() {
    const api = getCanvas();
    const projects = await api.listProjects();
    const { currentProjectId } = get();
    if (currentProjectId != null && projects.some((p) => p.id === currentProjectId)) {
      const { documents } = await api.getProject(currentProjectId);
      set({ projects, documents });
    } else {
      set({ projects });
    }
  },

  async selectProject(projectId) {
    const api = getCanvas();
    const { documents } = await api.getProject(projectId);
    const doc = documents[0];
    set({
      currentProjectId: projectId,
      documents,
      documentId: doc ? doc.id : null,
      document: doc ?? null,
      selection: [],
      currentPageId: null,
    });
    if (doc) await get().reload();
    else set({ nodes: [], notes: [], versions: [], pages: [] });
  },

  async selectDocument(documentId) {
    set({ documentId, selection: [], currentPageId: null });
    await get().reload();
  },

  async reload() {
    const api = getCanvas();
    const { documentId, noteFilter } = get();
    if (documentId == null) return;
    const [tree, notes, versions, pages] = await Promise.all([
      api.getTree(documentId),
      api.listNotes({ documentId, status: noteFilter === 'open' ? 'open' : undefined }),
      api.listVersions(documentId),
      api.listPages(documentId),
    ]);
    // prune selection to still-existing nodes
    const ids = new Set(tree.nodes.map((n) => n.id));
    set((s) => {
      // keep current page valid; default to first page
      const stillValid = s.currentPageId != null && pages.some((p: Page) => p.id === s.currentPageId);
      const currentPageId = stillValid ? s.currentPageId : (pages[0]?.id ?? null);
      return {
        document: tree.document,
        nodes: tree.nodes,
        notes,
        versions,
        pages,
        currentPageId,
        selection: s.selection.filter((id) => ids.has(id)),
      };
    });
  },

  setPage(id) {
    set({ currentPageId: id, selection: [] });
  },

  select(id, additive = false) {
    set((s) => {
      if (additive) {
        return s.selection.includes(id)
          ? { selection: s.selection.filter((x) => x !== id) }
          : { selection: [...s.selection, id] };
      }
      return { selection: [id] };
    });
  },
  clearSelection() { set({ selection: [], enteredNodeId: null }); },
  setSelection(ids) { set({ selection: ids }); },

  setCamera(cam) { set((s) => ({ camera: { ...s.camera, ...cam } })); },
  panBy(dx, dy) {
    set((s) => ({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } }));
  },

  setMode(mode) { set({ mode, enteredNodeId: null }); },
  enterNode(id) { set({ enteredNodeId: id }); },
  toggleCollapsed(id) {
    set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }));
  },
  async setNoteFilter(f) {
    set({ noteFilter: f });
    await get().reload();
  },

  async updateNode(id, patch) {
    const api = getCanvas();
    // optimistic
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    await api.updateNode(id, patch);
  },

  async moveSelectionBy(dx, dy) {
    const { selection, nodes } = get();
    const locked = new Set(nodes.filter((n) => n.locked).map((n) => n.id));
    const targets = selection.filter((id) => !locked.has(id));
    // optimistic
    set((s) => ({
      nodes: s.nodes.map((n) =>
        targets.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n
      ),
    }));
    const api = getCanvas();
    await Promise.all(
      targets.map((id) => {
        const n = get().nodes.find((x) => x.id === id)!;
        return api.updateNode(id, { x: n.x, y: n.y });
      })
    );
  },

  async groupSelection() {
    const { selection } = get();
    if (selection.length < 1) return;
    const api = getCanvas();
    const g = await api.groupNodes({ nodeIds: selection });
    await get().reload();
    set({ selection: [g.id] });
  },

  async ungroupSelection() {
    const { selection, nodes } = get();
    const groups = selection.filter((id) => nodes.find((n) => n.id === id)?.type === 'group');
    if (!groups.length) return;
    const api = getCanvas();
    for (const g of groups) await api.ungroup(g);
    await get().reload();
    set({ selection: [] });
  },

  async deleteSelection() {
    const { selection } = get();
    if (!selection.length) return;
    const api = getCanvas();
    for (const id of selection) await api.deleteNode(id);
    set({ selection: [] });
    await get().reload();
  },

  async createNote(x, y, body, nodeId = null) {
    const api = getCanvas();
    const { documentId } = get();
    if (documentId == null) return;
    await api.createNote({ documentId, nodeId, x, y, body, author: 'user' });
    await get().reload();
  },

  async resolveNote(id, resolution) {
    const api = getCanvas();
    await api.resolveNote(id, { resolution });
    await get().reload();
  },

  async saveVersion(summary) {
    const api = getCanvas();
    const { documentId } = get();
    if (documentId == null) return;
    await api.saveVersion({ documentId, summary, author: 'user' });
    await get().reload();
  },

  async restoreVersion(id) {
    const api = getCanvas();
    await api.restoreVersion(id);
    await get().reload();
  },

  async submitReview() {
    const { documentId } = get();
    if (documentId == null) return;
    await getCanvas().submitReview(documentId);
    await get().reload();
  },

  async approveReview() {
    const { documentId } = get();
    if (documentId == null) return;
    await getCanvas().approveReview(documentId);
    await get().reload();
  },

  modal: null,
  promptText(title, defaultValue = '') {
    return new Promise<string | null>((resolve) =>
      set({ modal: { kind: 'prompt', title, defaultValue, resolve } })
    );
  },
  confirmDialog(message) {
    return new Promise<boolean>((resolve) =>
      set({ modal: { kind: 'confirm', title: message, defaultValue: '', resolve } })
    );
  },
  resolveModal(value) {
    const m = get().modal;
    set({ modal: null });
    if (m) m.resolve(value);
  },
}));

// ---- derived helpers (pure) ----

export interface TreeNode extends CanvasNode {
  children: TreeNode[];
  depth: number;
}

export function buildLayerTree(nodes: CanvasNode[]): TreeNode[] {
  const byParent = new Map<number | null, CanvasNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  const build = (parentId: number | null, depth: number): TreeNode[] => {
    const kids = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.z - b.z);
    return kids.map((n) => ({ ...n, depth, children: build(n.id, depth + 1) }));
  };
  return build(null, 0);
}

// Pure canvas geometry helpers live in ./geometry (dependency-free + unit tested).
// Re-exported here so existing import sites (`from './store/store'`) keep working.
export { absolutePos, nodePageId, nodeAtPoint } from './geometry';
