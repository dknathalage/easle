// Easle embedded MCP server. Runs inside the Electron main process and calls the
// db layer directly (no HTTP self-proxy). Exposed over the SDK's Streamable HTTP
// transport by api.js at 127.0.0.1:47600/mcp. CommonJS.
//
// The single write path is `apply(ops)` (see db.applyOps + Phase 4). Everything
// else here is a read tool. Keeping the surface small forces the batch/patch idiom.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');

// Wrap a handler so its return value becomes MCP text content and thrown errors
// become an isError result rather than crashing the request.
function textTool(fn) {
  return async (args) => {
    try {
      const result = await fn(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return { isError: true, content: [{ type: 'text', text: 'Easle MCP error: ' + message }] };
    }
  };
}

// Resolve a default document (first one) when a read tool omits documentId.
function firstDocumentId(db) {
  const docs = db.listDocuments();
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error('No documents exist yet. Create one with apply([{op:"createDocument",...}]).');
  }
  return docs[0].id;
}

// Build and return a configured McpServer bound to the given db layer.
// A fresh server is created per HTTP request (stateless transport), so this is
// called on every /mcp call — keep it cheap.
function createMcpServer(db) {
  const server = new McpServer({ name: 'easle', version: '0.1.0' });

  // ---- read tools ---------------------------------------------------------

  server.registerTool(
    'list_projects',
    {
      description: 'List all projects (each with a documentCount).',
      inputSchema: {},
    },
    textTool(async () => db.listProjects())
  );

  server.registerTool(
    'get_project',
    {
      description: 'Get one project and the documents under it.',
      inputSchema: { id: z.number().int() },
    },
    textTool(async ({ id }) => db.getProject(id))
  );

  server.registerTool(
    'get_tree',
    {
      description:
        'Get the flat node tree for a document. content nodes (components) include their html/css/js. Defaults to the first document.',
      inputSchema: { documentId: z.number().int().optional() },
    },
    textTool(async ({ documentId }) => db.getTree(documentId ?? firstDocumentId(db)))
  );

  server.registerTool(
    'get_node',
    {
      description: 'Get one node by id (content nodes include their content).',
      inputSchema: { id: z.number().int() },
    },
    textTool(async ({ id }) => db.getNode(id))
  );

  server.registerTool(
    'list_notes',
    {
      description: 'List notes for a document, filtered by status (default "open"). Defaults to the first document.',
      inputSchema: {
        documentId: z.number().int().optional(),
        status: z.enum(['open', 'resolved', 'wontfix']).optional(),
      },
    },
    textTool(async ({ documentId, status }) =>
      db.listNotes({ documentId: documentId ?? firstDocumentId(db), status: status ?? 'open' })
    )
  );

  server.registerTool(
    'list_versions',
    {
      description: 'List versions for a document (snapshots omitted). Defaults to the first document.',
      inputSchema: { documentId: z.number().int().optional() },
    },
    textTool(async ({ documentId }) => db.listVersions(documentId ?? firstDocumentId(db)))
  );

  server.registerTool(
    'get_version',
    {
      description: 'Get one version including its snapshot JSON.',
      inputSchema: { id: z.number().int() },
    },
    textTool(async ({ id }) => db.getVersion(id))
  );

  // ---- write tool (apply) is registered in Phase 4 ------------------------
  if (typeof db.applyOps === 'function') {
    registerApply(server, db);
  }

  return server;
}

// Registered only when db.applyOps exists (Phase 4). Extracted so Phase 3 can
// ship the read surface without the write path.
function registerApply(server, db) {
  server.registerTool(
    'apply',
    {
      description:
        'The single atomic mutation tool. Runs an array of ops in one transaction; any failure rolls back the whole call. ' +
        'Ops run in order. A create op may declare a temp `ref` (string); later ops reference it via `projectRef`/`documentRef`/`pageRef`/`parentRef` (or `ref` in an id position). Returns { ok, refs:{ref:id}, results:[...] }.\n' +
        'Example — build a whole tree in one call:\n' +
        '[{"op":"createProject","ref":"p","name":"App"},' +
        '{"op":"createDocument","ref":"d","projectRef":"p","name":"Home"},' +
        '{"op":"createPage","ref":"pg","documentRef":"d","name":"Page 1"},' +
        '{"op":"createNode","ref":"frame","documentRef":"d","pageRef":"pg","type":"frame","name":"Screen","x":80,"y":80},' +
        '{"op":"createNode","documentRef":"d","parentRef":"frame","type":"content","name":"Card","content":{"html":"<div>hi</div>","css":".x{}","js":""}}]\n' +
        'Op kinds: createProject, createDocument, createPage, createNode, updateProject, updateDocument, updatePage, updateNode, setContent, moveNode, groupNodes, ungroup, deleteNode, deletePage, deleteDocument, deleteProject, createNote, resolveNote, addVersion, restoreVersion.',
      inputSchema: {
        ops: z.array(z.object({ op: z.string() }).passthrough()),
      },
    },
    textTool(async ({ ops }) => db.applyOps(ops))
  );
}

module.exports = { createMcpServer };
