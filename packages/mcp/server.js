// Canvas MCP server — stdio, thin HTTP client over the Canvas desktop app's
// loopback API (127.0.0.1:47600). The desktop app owns the API/DB; this server
// only proxies. See Canvas/CONTRACT.md "MCP tools" + "Localhost HTTP API".

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import pkg from '@canvas/shared';
const { API_BASE } = pkg;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const APP_DOWN_MESSAGE =
  'Cannot reach the Canvas API at ' +
  API_BASE +
  '. The Canvas desktop app must be running — it owns the localhost API. ' +
  'Start the Canvas app and try again.';

class ApiDownError extends Error {}
class ApiHttpError extends Error {
  constructor(status, body) {
    super(
      'Canvas API returned HTTP ' +
        status +
        (body && body.error ? ': ' + body.error : '')
    );
    this.status = status;
    this.body = body;
  }
}

// Perform a request against the Canvas API. Returns parsed JSON on success.
// Throws ApiDownError when the app isn't running, ApiHttpError on 4xx/5xx.
async function apiFetch(path, { method = 'GET', body } = {}) {
  const url = API_BASE + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Node's global fetch throws a TypeError ("fetch failed") whose cause
    // carries ECONNREFUSED when nothing is listening on the port.
    const code = err && err.cause && err.cause.code;
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNRESET' ||
      (err && /fetch failed/i.test(String(err.message)))
    ) {
      throw new ApiDownError(APP_DOWN_MESSAGE);
    }
    throw err;
  }

  let parsed = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    throw new ApiHttpError(res.status, parsed);
  }
  return parsed;
}

// Build a query string from an object, skipping undefined/null values.
function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? '?' + s : '';
}

// Wrap a tool handler: run it, coerce the result into MCP text content, and
// turn API-down / HTTP errors into MCP error results (isError:true) with a
// helpful text payload rather than throwing.
function tool(fn) {
  return async (args) => {
    try {
      const result = await fn(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      if (err instanceof ApiDownError) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
      if (err instanceof ApiHttpError) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
      return {
        isError: true,
        content: [{ type: 'text', text: 'Canvas MCP error: ' + String(err && err.message ? err.message : err) }],
      };
    }
  };
}

// get_tree with no documentId resolves the first document via GET /documents.
async function resolveDefaultDocumentId() {
  const docs = await apiFetch('/documents');
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new ApiHttpError(404, { error: 'No documents exist in the Canvas app.' });
  }
  return docs[0].id;
}

// ---------------------------------------------------------------------------
// Server + tools
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'canvas', version: '0.1.0' });

const NODE_TYPE = z.enum(['frame', 'group', 'content']);

// list_documents -> GET /documents
server.tool(
  'list_documents',
  'List all Canvas documents.',
  {},
  tool(async () => apiFetch('/documents'))
);

// get_tree {documentId?} -> GET /tree (default first document)
server.tool(
  'get_tree',
  'Get the flat node tree for a document (content nodes include their content). Defaults to the first document.',
  { documentId: z.number().int().optional() },
  tool(async ({ documentId }) => {
    const id = documentId ?? (await resolveDefaultDocumentId());
    return apiFetch('/tree' + qs({ documentId: id }));
  })
);

// get_node {id} -> GET /node/:id
server.tool(
  'get_node',
  'Get a single node by id.',
  { id: z.number().int() },
  tool(async ({ id }) => apiFetch('/node/' + encodeURIComponent(id)))
);

// create_node {documentId,parentId?,type,name?,x?,y?,w?,h?} -> POST /node
server.tool(
  'create_node',
  'Create a node. If type is "content" a contents row is also created.',
  {
    documentId: z.number().int(),
    parentId: z.number().int().nullable().optional(),
    type: NODE_TYPE,
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  },
  tool(async (args) => apiFetch('/node', { method: 'POST', body: args }))
);

// update_node {id, ...patch} -> PATCH /node/:id
server.tool(
  'update_node',
  'Update a node. Patchable: name, x, y, w, h, z, visible, locked, parentId.',
  {
    id: z.number().int(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    z: z.number().optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    parentId: z.number().int().nullable().optional(),
  },
  tool(async ({ id, ...patch }) =>
    apiFetch('/node/' + encodeURIComponent(id), { method: 'PATCH', body: patch })
  )
);

// set_content {id,html?,css?,js?} -> PUT /node/:id/content
server.tool(
  'set_content',
  'Set the HTML/CSS/JS content of a content node.',
  {
    id: z.number().int(),
    html: z.string().optional(),
    css: z.string().optional(),
    js: z.string().optional(),
  },
  tool(async ({ id, ...content }) =>
    apiFetch('/node/' + encodeURIComponent(id) + '/content', { method: 'PUT', body: content })
  )
);

// delete_node {id} -> DELETE /node/:id
server.tool(
  'delete_node',
  'Delete a node.',
  { id: z.number().int() },
  tool(async ({ id }) => apiFetch('/node/' + encodeURIComponent(id), { method: 'DELETE' }))
);

// group_nodes {nodeIds,name?} -> POST /group
server.tool(
  'group_nodes',
  'Group nodes under a new group node.',
  { nodeIds: z.array(z.number().int()), name: z.string().optional() },
  tool(async (args) => apiFetch('/group', { method: 'POST', body: args }))
);

// ungroup {groupId} -> POST /ungroup
server.tool(
  'ungroup',
  'Ungroup a group node (reparent its children, delete the group).',
  { groupId: z.number().int() },
  tool(async (args) => apiFetch('/ungroup', { method: 'POST', body: args }))
);

// list_notes {status?,documentId?} -> GET /notes (default status=open)
server.tool(
  'list_notes',
  'List notes for a document, filtered by status (default "open").',
  {
    documentId: z.number().int().optional(),
    status: z.enum(['open', 'resolved', 'wontfix']).default('open'),
  },
  tool(async ({ documentId, status }) => {
    const docId = documentId ?? (await resolveDefaultDocumentId());
    return apiFetch('/notes' + qs({ documentId: docId, status: status ?? 'open' }));
  })
);

// resolve_note {id,resolution?} -> POST /note/:id/resolve (default 'resolved')
server.tool(
  'resolve_note',
  'Resolve a note (resolution defaults to "resolved").',
  {
    id: z.number().int(),
    resolution: z.enum(['resolved', 'wontfix']).default('resolved'),
  },
  tool(async ({ id, resolution }) =>
    apiFetch('/note/' + encodeURIComponent(id) + '/resolve', {
      method: 'POST',
      body: { resolution: resolution ?? 'resolved' },
    })
  )
);

// add_version {documentId,summary} -> POST /version (author:'ai')
server.tool(
  'add_version',
  'Snapshot the current document as a new version (author "ai").',
  { documentId: z.number().int(), summary: z.string() },
  tool(async ({ documentId, summary }) =>
    apiFetch('/version', { method: 'POST', body: { documentId, summary, author: 'ai' } })
  )
);

// list_versions {documentId} -> GET /versions
server.tool(
  'list_versions',
  'List versions for a document (snapshots omitted).',
  { documentId: z.number().int() },
  tool(async ({ documentId }) => apiFetch('/versions' + qs({ documentId })))
);

// restore_version {id} -> POST /version/:id/restore
server.tool(
  'restore_version',
  'Restore a document to a saved version.',
  { id: z.number().int() },
  tool(async ({ id }) =>
    apiFetch('/version/' + encodeURIComponent(id) + '/restore', { method: 'POST' })
  )
);

// ---------------------------------------------------------------------------
// Resource: canvas://document/{id}/tree -> GET /tree?documentId=id
// ---------------------------------------------------------------------------

server.resource(
  'document-tree',
  new ResourceTemplate('canvas://document/{id}/tree', { list: undefined }),
  async (uri, { id }) => {
    const tree = await apiFetch('/tree' + qs({ documentId: id }));
    return {
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tree) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
