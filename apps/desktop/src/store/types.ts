// Data shapes mirror CONTRACT.md exactly.

export type NodeType = 'frame' | 'group' | 'content';

export interface Content {
  html: string;
  css: string;
  js: string;
  // React path (compile-on-write). When `compiled` is set the node renders via
  // the content-renderer bundle; when null it falls back to legacy html/css/js.
  source?: string | null;
  compiled?: string | null;
}

// Document-level shared styles/js the AI can set (empty by default — blank slate).
export interface DocumentAssets {
  css: string;
  js: string;
}

// A reusable per-document React component (compiled CJS, references global React).
export interface ComponentDef {
  id: number;
  documentId: number;
  name: string;
  source: string;
  compiled: string;
  css: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasNode {
  id: number;
  documentId: number;
  parentId: number | null;
  pageId?: number | null; // top-level nodes belong to a page
  type: NodeType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  visible: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  content?: Content; // only on type === 'content'
}

export type NoteAuthor = 'user' | 'ai';
export type NoteStatus = 'open' | 'resolved' | 'wontfix';

export interface Note {
  id: number;
  documentId: number;
  nodeId: number | null;
  x: number;
  y: number;
  body: string;
  author: NoteAuthor;
  status: NoteStatus;
  parentId: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type VersionAuthor = 'ai' | 'user';

export interface Version {
  id: number;
  documentId: number;
  n: number;
  author: VersionAuthor;
  summary: string;
  createdAt: string;
  snapshot?: string; // present on getVersion
}

export interface Project {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number; // present on listProjects
}

// In-app review loop state for a document.
export type ReviewState = 'idle' | 'awaiting' | 'changes_requested' | 'approved';

export interface CanvasDocument {
  id: number;
  name: string;
  projectId?: number | null;
  reviewState?: ReviewState;
  createdAt: string;
  updatedAt: string;
}

export interface Tree {
  document: CanvasDocument;
  nodes: CanvasNode[];
}

// The window.easle bridge (preload.js). All async, Promise-returning.
export interface CanvasApi {
  listProjects(): Promise<Project[]>;
  getProject(id: number): Promise<{ project: Project; documents: CanvasDocument[] }>;
  createProject(input: { name?: string }): Promise<Project>;
  updateProject(id: number, patch: { name?: string }): Promise<Project>;
  deleteProject(id: number): Promise<{ ok: true }>;
  listDocuments(filter?: { projectId?: number }): Promise<CanvasDocument[]>;
  createDocument(input: { projectId: number; name?: string }): Promise<CanvasDocument>;
  getTree(documentId: number): Promise<Tree>;
  getNode(id: number): Promise<CanvasNode | null>;
  listPages(documentId: number): Promise<import('./store').Page[]>;
  createPage(input: { documentId: number; name?: string; idx?: number }): Promise<import('./store').Page>;
  renamePage(id: number, name: string): Promise<{ ok: true }>;
  deletePage(id: number): Promise<{ ok: true }>;
  setNodePage(nodeId: number, pageId: number): Promise<{ ok: true }>;
  createNode(input: {
    documentId: number;
    parentId?: number | null;
    type: NodeType;
    name?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    z?: number;
  }): Promise<CanvasNode>;
  updateNode(id: number, patch: Partial<CanvasNode>): Promise<CanvasNode>;
  deleteNode(id: number): Promise<{ ok: true }>;
  setContent(id: number, content: Partial<Content>): Promise<{ ok: true }>;
  groupNodes(input: { nodeIds: number[]; name?: string }): Promise<CanvasNode>;
  ungroup(groupId: number): Promise<{ ok: true }>;
  listNotes(input: { documentId: number; status?: NoteStatus }): Promise<Note[]>;
  createNote(input: {
    documentId: number;
    nodeId?: number | null;
    x: number;
    y: number;
    body: string;
    author?: NoteAuthor;
  }): Promise<Note>;
  updateNote(id: number, patch: Partial<Note>): Promise<Note>;
  resolveNote(id: number, input: { resolution: 'resolved' | 'wontfix' }): Promise<Note>;
  saveVersion(input: { documentId: number; summary: string; author?: VersionAuthor }): Promise<Version>;
  listVersions(documentId: number): Promise<Version[]>;
  getVersion(id: number): Promise<Version & { snapshot: string }>;
  restoreVersion(id: number): Promise<{ ok: true }>;
  // react component system
  getDocumentAssets(documentId: number): Promise<DocumentAssets>;
  listComponents(documentId: number): Promise<ComponentDef[]>;
  // review loop
  getReviewState(documentId: number): Promise<{ documentId: number; state: ReviewState }>;
  requestReview(documentId: number): Promise<{ ok: true; state: ReviewState }>;
  submitReview(documentId: number): Promise<{ ok: true; state: ReviewState }>;
  approveReview(documentId: number): Promise<{ ok: true; state: ReviewState }>;
  consumeReview(documentId: number): Promise<{ state: ReviewState; consumed: boolean }>;
  // batch-first mutation: an array of ops in one atomic transaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyOps(ops: any[]): Promise<{ refs: Record<string, number>; results: any[] }>;
  onChanged(cb: () => void): () => void;
}

declare global {
  interface Window {
    easle: CanvasApi;
  }
}
