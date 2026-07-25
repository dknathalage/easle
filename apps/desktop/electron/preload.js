// Easle preload — exposes window.easle to the renderer via contextBridge.
// Each DB-layer method maps 1:1 to ipcRenderer.invoke('easle:<method>', ...args).
// Plus onChanged(cb) subscribing to main->renderer 'db:changed'.

const { contextBridge, ipcRenderer } = require('electron');

// DB-layer method names (mirror db.js). Keep in sync with main.js handlers.
const METHODS = [
  'listDocuments',
  'getTree',
  'getNode',
  'listPages',
  'createPage',
  'renamePage',
  'deletePage',
  'setNodePage',
  'createNode',
  'updateNode',
  'deleteNode',
  'setContent',
  'groupNodes',
  'ungroup',
  'listNotes',
  'createNote',
  'updateNote',
  'resolveNote',
  'saveVersion',
  'listVersions',
  'getVersion',
  'restoreVersion',
];

const easle = {};
for (const method of METHODS) {
  easle[method] = (...args) => ipcRenderer.invoke(`easle:${method}`, ...args);
}

// Subscribe to db:changed; returns an unsubscribe function.
easle.onChanged = (cb) => {
  const listener = () => {
    try {
      cb();
    } catch (_) {
      /* swallow renderer callback errors */
    }
  };
  ipcRenderer.on('db:changed', listener);
  return () => ipcRenderer.removeListener('db:changed', listener);
};

contextBridge.exposeInMainWorld('easle', easle);
