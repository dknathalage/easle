// Thin accessor for the window.easle bridge exposed by preload.js.
//
// When the renderer is loaded outside Electron (e.g. `vite` in a plain browser
// for UI work), window.easle is undefined. We provide a small in-memory mock so
// the tool chrome still renders and is inspectable. In Electron this is never used.

import type { CanvasApi, CanvasNode, Note, Version, Tree, ReviewState } from './types';

function buildMock(): CanvasApi {
  const now = () => new Date().toISOString();
  const project = { id: 1, name: 'Demo (mock)', createdAt: now(), updatedAt: now() };
  const doc: { id: number; name: string; projectId: number; reviewState: ReviewState; createdAt: string; updatedAt: string } =
    { id: 1, name: 'Demo (mock)', projectId: 1, reviewState: 'idle', createdAt: now(), updatedAt: now() };
  let nid = 100;
  let noteId = 100;
  let verId = 100;
  const nodes: CanvasNode[] = [
    {
      id: 1, documentId: 1, parentId: null, type: 'frame', name: 'Screen 1',
      x: 80, y: 80, w: 393, h: 852, z: 0, visible: true, locked: false,
      createdAt: now(), updatedAt: now(),
    },
    {
      id: 2, documentId: 1, parentId: 1, type: 'content', name: 'Card',
      x: 24, y: 120, w: 345, h: 200, z: 0, visible: true, locked: false,
      createdAt: now(), updatedAt: now(),
      content: {
        html: '<div class="card"><h1>Hello Easle</h1><p>Mock content node.</p></div>',
        css: '.card{font-family:system-ui;padding:24px;background:#fff;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.08)}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#666}',
        js: '',
      },
    },
  ];
  const notes: Note[] = [];
  const versions: Version[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  return {
    async listProjects() { return [{ ...project, documentCount: 1 }]; },
    async getProject() { return { project: { ...project }, documents: [{ ...doc }] }; },
    async createProject(input) { return { ...project, name: input.name ?? 'Untitled Project' }; },
    async updateProject(_id, patch) { return { ...project, name: patch.name ?? project.name }; },
    async deleteProject() { emit(); return { ok: true }; },
    async listDocuments() { return [{ ...doc }]; },
    async createDocument(input) { return { ...doc, id: ++nid, name: input.name ?? 'Untitled', projectId: input.projectId }; },
    async getTree(): Promise<Tree> { return { document: doc, nodes: nodes.map((n) => ({ ...n })) }; },
    async getNode(id) { return nodes.find((n) => n.id === id) ?? null; },
    async createNode(input) {
      const n: CanvasNode = {
        id: ++nid, documentId: input.documentId, parentId: input.parentId ?? null,
        type: input.type, name: input.name ?? input.type, x: input.x ?? 0, y: input.y ?? 0,
        w: input.w ?? 393, h: input.h ?? 852, z: input.z ?? 0, visible: true, locked: false,
        createdAt: now(), updatedAt: now(),
        ...(input.type === 'content' ? { content: { html: '', css: '', js: '' } } : {}),
      };
      nodes.push(n); emit(); return n;
    },
    async updateNode(id, patch) {
      const n = nodes.find((x) => x.id === id)!;
      Object.assign(n, patch, { updatedAt: now() });
      emit(); return { ...n };
    },
    async deleteNode(id) {
      const i = nodes.findIndex((x) => x.id === id);
      if (i >= 0) nodes.splice(i, 1);
      emit(); return { ok: true };
    },
    async setContent(id, c) {
      const n = nodes.find((x) => x.id === id);
      if (n) n.content = { html: '', css: '', js: '', ...n.content, ...c };
      emit(); return { ok: true };
    },
    async groupNodes({ nodeIds, name }) {
      const first = nodes.find((n) => nodeIds.includes(n.id))!;
      const g: CanvasNode = {
        id: ++nid, documentId: 1, parentId: first?.parentId ?? null, type: 'group',
        name: name ?? 'Group', x: first?.x ?? 0, y: first?.y ?? 0, w: 200, h: 200, z: 0,
        visible: true, locked: false, createdAt: now(), updatedAt: now(),
      };
      nodes.push(g);
      nodes.forEach((n) => { if (nodeIds.includes(n.id)) n.parentId = g.id; });
      emit(); return g;
    },
    async ungroup(groupId) {
      const g = nodes.find((n) => n.id === groupId);
      if (g) {
        nodes.forEach((n) => { if (n.parentId === groupId) n.parentId = g.parentId; });
        const i = nodes.indexOf(g); nodes.splice(i, 1);
      }
      emit(); return { ok: true };
    },
    async listNotes({ status }) {
      return notes.filter((n) => !status || status === 'open' ? n.status === 'open' || !status : n.status === status)
        .map((n) => ({ ...n }));
    },
    async createNote(input) {
      const n: Note = {
        id: ++noteId, documentId: input.documentId, nodeId: input.nodeId ?? null,
        x: input.x, y: input.y, body: input.body, author: input.author ?? 'user',
        status: 'open', parentId: null, createdAt: now(), resolvedAt: null,
      };
      notes.push(n); emit(); return n;
    },
    async updateNote(id, patch) {
      const n = notes.find((x) => x.id === id)!;
      Object.assign(n, patch); emit(); return { ...n };
    },
    async resolveNote(id, { resolution }) {
      const n = notes.find((x) => x.id === id)!;
      n.status = resolution; n.resolvedAt = now(); emit(); return { ...n };
    },
    async saveVersion({ summary, author }) {
      const v: Version = {
        id: ++verId, documentId: 1, n: versions.length + 1, author: author ?? 'user',
        summary, createdAt: now(),
      };
      versions.push(v); emit(); return v;
    },
    async listVersions() { return versions.map((v) => ({ ...v })); },
    async getVersion(id) {
      const v = versions.find((x) => x.id === id)!;
      return { ...v, snapshot: JSON.stringify({ nodes }) };
    },
    async restoreVersion() { emit(); return { ok: true }; },
    async getReviewState() { return { documentId: doc.id, state: doc.reviewState }; },
    async requestReview() { doc.reviewState = 'awaiting'; emit(); return { ok: true, state: doc.reviewState }; },
    async submitReview() { doc.reviewState = 'changes_requested'; emit(); return { ok: true, state: doc.reviewState }; },
    async approveReview() { doc.reviewState = 'approved'; emit(); return { ok: true, state: doc.reviewState }; },
    async consumeReview() {
      const prior = doc.reviewState;
      const consumed = prior === 'changes_requested' || prior === 'approved';
      if (consumed) { doc.reviewState = 'idle'; emit(); }
      return { state: prior, consumed };
    },
    async applyOps() { emit(); return { refs: {}, results: [] }; },
    async listPages() { return [{ id: 1, documentId: 1, name: 'Page 1', idx: 0 }]; },
    async createPage(input) { return { id: 2, documentId: input.documentId, name: input.name ?? 'Page', idx: 1 }; },
    async renamePage() { return { ok: true }; },
    async deletePage() { return { ok: true }; },
    async setNodePage() { emit(); return { ok: true }; },
    onChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

let mock: CanvasApi | null = null;

export function getCanvas(): CanvasApi {
  if (typeof window !== 'undefined' && window.easle) return window.easle;
  if (!mock) {
    mock = buildMock();
    // eslint-disable-next-line no-console
    console.warn('[easle] window.easle not found — using in-memory mock (not running in Electron).');
  }
  return mock;
}

export const isElectron = typeof window !== 'undefined' && !!window.easle;
