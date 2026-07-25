// Easle localhost JSON API — loopback only (127.0.0.1:47600).
// Wraps the SAME db layer as IPC. No express; plain Node http. CommonJS.

const http = require('http');
const { URL } = require('url');
const { API_HOST, API_PORT } = require('@easle/shared');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function startApi(db) {
  const server = http.createServer(async (req, res) => {
    let parsed;
    try {
      parsed = new URL(req.url, `http://${API_HOST}:${API_PORT}`);
    } catch (e) {
      return sendJson(res, 400, { error: 'Bad URL' });
    }
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const q = parsed.searchParams;
    const method = req.method || 'GET';

    // helper: coerce numeric route/query params
    const num = (v) => {
      if (v === null || v === undefined || v === '') return undefined;
      const n = Number(v);
      return Number.isNaN(n) ? undefined : n;
    };

    // path segments after leading slash
    const seg = path.split('/').filter(Boolean); // e.g. ['node','5','content']

    try {
      // ---- GET /health --------------------------------------------------
      if (method === 'GET' && path === '/health') {
        return sendJson(res, 200, { ok: true });
      }

      // ---- GET /documents ----------------------------------------------
      if (method === 'GET' && path === '/documents') {
        return sendJson(res, 200, db.listDocuments());
      }

      // ---- GET /tree?documentId= ---------------------------------------
      if (method === 'GET' && path === '/tree') {
        const documentId = num(q.get('documentId'));
        if (documentId === undefined)
          return sendJson(res, 400, { error: 'documentId query param required' });
        return sendJson(res, 200, db.getTree(documentId));
      }

      // ---- GET /versions?documentId= -----------------------------------
      if (method === 'GET' && path === '/versions') {
        const documentId = num(q.get('documentId'));
        if (documentId === undefined)
          return sendJson(res, 400, { error: 'documentId query param required' });
        return sendJson(res, 200, db.listVersions(documentId));
      }

      // ---- GET /notes?documentId=&status= ------------------------------
      if (method === 'GET' && path === '/notes') {
        const documentId = num(q.get('documentId'));
        if (documentId === undefined)
          return sendJson(res, 400, { error: 'documentId query param required' });
        const status = q.get('status') || undefined;
        return sendJson(res, 200, db.listNotes({ documentId, status }));
      }

      // ---- GET /pages?documentId= --------------------------------------
      if (method === 'GET' && path === '/pages') {
        const documentId = num(q.get('documentId'));
        if (documentId === undefined)
          return sendJson(res, 400, { error: 'documentId query param required' });
        return sendJson(res, 200, db.listPages(documentId));
      }

      // ---- /node ... ----------------------------------------------------
      if (seg[0] === 'node') {
        // POST /node
        if (method === 'POST' && seg.length === 1) {
          const body = await readJsonBody(req);
          return sendJson(res, 200, db.createNode(body));
        }
        // routes with an id: /node/:id  and  /node/:id/content
        if (seg.length >= 2) {
          const id = num(seg[1]);
          if (id === undefined) return sendJson(res, 400, { error: 'Invalid node id' });

          // PUT /node/:id/content
          if (seg.length === 3 && seg[2] === 'content' && method === 'PUT') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, db.setContent(id, body));
          }

          // POST /node/:id/page  { pageId }
          if (seg.length === 3 && seg[2] === 'page' && method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, db.setNodePage(id, body.pageId));
          }

          if (seg.length === 2) {
            if (method === 'GET') {
              const node = db.getNode(id);
              if (!node) return sendJson(res, 404, { error: `Node ${id} not found` });
              return sendJson(res, 200, node);
            }
            if (method === 'PATCH') {
              const body = await readJsonBody(req);
              return sendJson(res, 200, db.updateNode(id, body));
            }
            if (method === 'DELETE') {
              return sendJson(res, 200, db.deleteNode(id));
            }
          }
        }
      }

      // ---- POST /group --------------------------------------------------
      if (method === 'POST' && path === '/group') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, db.groupNodes(body));
      }

      // ---- POST /ungroup ------------------------------------------------
      if (method === 'POST' && path === '/ungroup') {
        const body = await readJsonBody(req);
        if (body.groupId === undefined)
          return sendJson(res, 400, { error: 'groupId required' });
        return sendJson(res, 200, db.ungroup(body.groupId));
      }

      // ---- /page ... ----------------------------------------------------
      if (seg[0] === 'page') {
        if (method === 'POST' && seg.length === 1) {
          const body = await readJsonBody(req);
          return sendJson(res, 200, db.createPage(body));
        }
        if (seg.length === 2) {
          const id = num(seg[1]);
          if (id === undefined) return sendJson(res, 400, { error: 'Invalid page id' });
          if (method === 'PATCH') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, db.renamePage(id, body.name));
          }
          if (method === 'DELETE') {
            return sendJson(res, 200, db.deletePage(id));
          }
        }
      }

      // ---- /note ... ----------------------------------------------------
      if (seg[0] === 'note') {
        // POST /note
        if (method === 'POST' && seg.length === 1) {
          const body = await readJsonBody(req);
          return sendJson(res, 200, db.createNote(body));
        }
        if (seg.length >= 2) {
          const id = num(seg[1]);
          if (id === undefined) return sendJson(res, 400, { error: 'Invalid note id' });

          // POST /note/:id/resolve
          if (seg.length === 3 && seg[2] === 'resolve' && method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, db.resolveNote(id, body));
          }
          // PATCH /note/:id
          if (seg.length === 2 && method === 'PATCH') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, db.updateNote(id, body));
          }
        }
      }

      // ---- /version ... -------------------------------------------------
      if (seg[0] === 'version') {
        // POST /version
        if (method === 'POST' && seg.length === 1) {
          const body = await readJsonBody(req);
          return sendJson(res, 200, db.saveVersion(body));
        }
        if (seg.length >= 2) {
          const id = num(seg[1]);
          if (id === undefined) return sendJson(res, 400, { error: 'Invalid version id' });

          // POST /version/:id/restore
          if (seg.length === 3 && seg[2] === 'restore' && method === 'POST') {
            return sendJson(res, 200, db.restoreVersion(id));
          }
          // GET /version/:id
          if (seg.length === 2 && method === 'GET') {
            const v = db.getVersion(id);
            if (!v) return sendJson(res, 404, { error: `Version ${id} not found` });
            return sendJson(res, 200, v);
          }
        }
      }

      // ---- fallthrough --------------------------------------------------
      return sendJson(res, 404, { error: `No route for ${method} ${path}` });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      // "not found" errors surface as 404, everything else as 500
      const status = /not found/i.test(message) ? 404 : 500;
      return sendJson(res, status, { error: message });
    }
  });

  server.listen(API_PORT, API_HOST);
  return server;
}

module.exports = { startApi };
