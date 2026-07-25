// Easle Electron main process — window, DB layer wiring, IPC handlers, localhost API.
// CommonJS.

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const { openDb, runSchemaAndSeed } = require('./db');
const { startApi } = require('./api');

// Same method list registered on preload's window.easle.
const DB_METHODS = [
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

let db = null;
let apiServer = null;
let mainWindow = null;

function resolveDbPath() {
  if (process.env.CANVAS_DB_PATH) return process.env.CANVAS_DB_PATH;
  // default: <repo>/data/canvas.db — electron/ is apps/desktop/electron
  const dataDir = path.resolve(__dirname, '..', '..', '..', 'data');
  return path.join(dataDir, 'canvas.db');
}

function emitChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('db:changed');
    }
  }
}

function initDb() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = openDb(dbPath, { onChanged: emitChanged });
  // also wire via setter in case a future openDb ignores opts
  if (typeof db.setOnChanged === 'function') db.setOnChanged(emitChanged);
  runSchemaAndSeed(db);
}

function registerIpc() {
  for (const method of DB_METHODS) {
    ipcMain.handle(`easle:${method}`, (_event, ...args) => {
      if (!db || typeof db[method] !== 'function') {
        throw new Error(`DB method ${method} unavailable`);
      }
      return db[method](...args);
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Easle',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Pipe renderer console + crashes to the main-process stdout so they show in logs.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[render-process-gone]', JSON.stringify(details));
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('[did-fail-load]', code, desc);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    if (process.env.CANVAS_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initDb();
  registerIpc();
  apiServer = startApi(db);

  createWindow();

  app.on('activate', () => {
    // macOS: re-create a window when dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS convention: stay alive until Cmd+Q.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (apiServer) {
    try {
      apiServer.close();
    } catch (_) {
      /* ignore */
    }
  }
  if (db && db._raw) {
    try {
      db._raw.close();
    } catch (_) {
      /* ignore */
    }
  }
});
