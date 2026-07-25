# Easle integration contract (build to this exactly)

Modules are built against this contract. Do not deviate from names/shapes.

## Data shapes (JSON)

```
Project  = { id, name, createdAt, updatedAt }              // listProjects adds documentCount
Document = { id, name, projectId|null, reviewState:'idle'|'awaiting'|'changes_requested'|'approved', createdAt, updatedAt }
Node = { id, documentId, parentId|null, pageId|null, type:'frame'|'group'|'content',
         name, x, y, w, h, z, visible:boolean, locked:boolean,
         createdAt, updatedAt, content?: { html, css, js } }   // content only on type==='content'
Note = { id, documentId, nodeId|null, x, y, body, author:'user'|'ai',
         status:'open'|'resolved'|'wontfix', parentId|null, createdAt, resolvedAt|null }
Version = { id, documentId, n, author:'ai'|'user', summary, createdAt }   // list omits snapshot; getVersion adds snapshot(JSON string)
```
Booleans are real JS booleans across IPC/HTTP (convert SQLite 0/1 at the DB layer). Timestamps are ISO strings.

## DB layer (apps/desktop/electron/db.js) — single source of truth

Export a factory `openDb(dbPath) -> db` where `db` has these methods (all synchronous, return the shapes above). Also export `runSchemaAndSeed(db)`. Every mutating method calls an injected `emitChanged()` hook after committing.

```
listProjects(): Project[]                                          // each with documentCount
getProject(id): { project: Project, documents: Document[] }
createProject({name?}): Project
updateProject(id, {name?}): Project
deleteProject(id): { ok:true }                                     // cascades documents→pages/nodes/notes/versions
listDocuments({projectId?}?): Document[]                            // optional project filter
createDocument({projectId,name?}): Document                        // also seeds one "Page 1"
getTree(documentId): { document: Document, nodes: Node[] }        // flat; content nodes include .content
getNode(id): Node | null
createNode({documentId,parentId?,type,name?,x?,y?,w?,h?,z?}): Node   // if type==='content', also make a contents row
updateNode(id, patch): Node                                        // patch subset of name,x,y,w,h,z,visible,locked,parentId
deleteNode(id): { ok:true }
setContent(id, {html?,css?,js?}): { ok:true }
groupNodes({nodeIds,name?}): Node                                  // new 'group' node; reparents nodeIds under it
ungroup(groupId): { ok:true }                                      // reparent children to group's parent, delete group
listNotes({documentId,status?}): Note[]
createNote({documentId,nodeId?,x,y,body,author?}): Note
updateNote(id, patch): Note
resolveNote(id, {resolution}): Note                                // resolution:'resolved'|'wontfix'
saveVersion({documentId,summary,author?}): Version                 // snapshot current nodes+contents to versions.snapshot
listVersions(documentId): Version[]
getVersion(id): Version & { snapshot:string }
restoreVersion(id): { ok:true }                                    // replace live nodes/contents from snapshot
getReviewState(documentId): { documentId, state }                 // idle|awaiting|changes_requested|approved
requestReview(documentId): { ok:true, state:'awaiting' }          // AI parks the doc for user review
submitReview(documentId): { ok:true, state:'changes_requested' }  // user pressed "Submit review"
approveReview(documentId): { ok:true, state:'approved' }          // user pressed "Approve & continue"
consumeReview(documentId): { state, consumed }                    // reset to idle if user acted; report prior state
applyOps(ops): { refs:{ [ref]:id }, results:[...] }                // batch — see "applyOps" below
```

## applyOps(ops) — the batch mutation path

Runs `ops` (array) in ONE SQLite transaction; any op throwing rolls back the whole
call. Ops execute in array order. A single `emitChanged()` fires after commit.

**Temp refs:** a create op may declare `ref:"<string>"`; later ops reference it via
`projectRef` / `documentRef` / `pageRef` / `parentRef` (and `ref` in an id position for
update*/setContent/moveNode/deleteNode, and inside `groupNodes.nodeIds`). Refs are
scoped to a single `applyOps` call. Returns `{ refs:{ref:id}, results:[...] }`.

Op catalogue (discriminated by `op`):
```
# create (each accepts optional ref; parent links accept a real id OR a *Ref)
createProject   { ref?, name }
createDocument  { ref?, projectId?|projectRef?, name }
createPage      { ref?, documentId?|documentRef?, name, idx? }
createNode      { ref?, documentId?|documentRef?, pageId?|pageRef?,
                  parentId?|parentRef?, type:'frame'|'group'|'content',
                  name?, x?, y?, w?, h?, z?, content?:{html?,css?,js?} }  // content+type='content' → component in one op
# patch (partial)
updateProject   { id|ref, patch:{name?} }
updateDocument  { id|ref, patch:{name?, projectId?} }
updatePage      { id|ref, patch:{name?, idx?} }
updateNode      { id|ref, patch:{name?,x?,y?,w?,h?,z?,visible?,locked?,parentId?} }
setContent      { id|ref, html?, css?, js? }
# structure / lifecycle
moveNode        { id|ref, parentId?|parentRef?, pageId?|pageRef?, z? }
groupNodes      { ref?, nodeIds:[id|ref], name? }
ungroup         { groupId }
deleteNode      { id|ref }
deletePage      { id }
deleteDocument  { id }
deleteProject   { id }
# review (AI authors)
createNote      { documentId?|documentRef?, nodeId?, x, y, body, author? }  // default author 'ai'
resolveNote     { id, resolution?:'resolved'|'wontfix' }
addVersion      { documentId?|documentRef?, summary }                       // author 'ai'
restoreVersion  { id }
requestReview   { documentId?|documentRef? }                               // park doc 'awaiting' for in-app user review
```

## Preload IPC (apps/desktop/electron/preload.js) — renderer uses `window.easle`

`window.easle` mirrors the DB layer 1:1 as async methods (Promise-returning, via ipcRenderer.invoke to channels named `easle:<method>`), PLUS:
```
window.easle.onChanged(cb): () => void   // subscribe to main→renderer 'db:changed'; returns unsubscribe
```
Main registers `ipcMain.handle('easle:<method>', (e,...args)=>db.<method>(...args))` for every method, and sends `db:changed` to all windows via the emitChanged hook.

## Localhost HTTP API (apps/desktop/electron/api.js) — REST + embedded MCP

Loopback only (`127.0.0.1:47600` from `@easle/shared`). JSON in/out. Wraps the SAME db layer.
The embedded MCP server is mounted here too (see below).
```
GET  /health                         -> { ok:true }
GET  /projects                       -> Project[]  (with documentCount)
GET  /project/:id                    -> { project, documents }
POST /project         {name?}        -> Project
PATCH /project/:id    {name?}        -> Project
DELETE /project/:id                  -> { ok }
GET  /documents?projectId=1          -> Document[] (projectId optional → all)
POST /document        {projectId,name?} -> Document
GET  /tree?documentId=1              -> { document, nodes }
GET  /node/:id                       -> Node
POST /node            {documentId,parentId?,type,name?,x?,y?,w?,h?} -> Node
PATCH /node/:id       {patch...}     -> Node
DELETE /node/:id                     -> { ok }
PUT  /node/:id/content {html?,css?,js?} -> { ok }
POST /group           {nodeIds,name?} -> Node
POST /ungroup         {groupId}      -> { ok }
GET  /notes?documentId=1&status=open -> Note[]
POST /note            {documentId,nodeId?,x,y,body,author?} -> Note
PATCH /note/:id       {patch...}     -> Note
POST /note/:id/resolve {resolution}  -> Note
POST /version         {documentId,summary,author?} -> Version
GET  /versions?documentId=1          -> Version[]
GET  /version/:id                    -> Version & { snapshot }
POST /version/:id/restore            -> { ok }
```
Errors: HTTP 4xx/5xx with `{ error: "message" }`.

## MCP tools (apps/desktop/electron/mcp.js) — embedded, Streamable HTTP at `/mcp`

The MCP server runs **inside** the Electron main process and calls the db layer
directly (no HTTP self-proxy). It is exposed over the SDK's Streamable HTTP transport
at `POST/GET/DELETE 127.0.0.1:47600/mcp`, in **stateless** mode (a fresh `McpServer` +
transport per request). Starting the app is all that's needed; there is no separate
process. All tools return compact JSON text.

The single write path is **`apply`**; everything else is a read tool:
```
apply { ops:[...] }        -> db.applyOps(ops)     # the sole mutation tool (see applyOps above)
list_projects              -> db.listProjects()
get_project {id}           -> db.getProject(id)
get_tree {documentId?}     -> db.getTree (default first document)
get_node {id}              -> db.getNode(id)
list_notes {documentId?,status?} -> db.listNotes (default status='open', first document)
list_versions {documentId?}-> db.listVersions (default first document)
get_version {id}           -> db.getVersion(id)
get_review_state {documentId?} -> db.getReviewState (default first document)
wait_for_review {documentId?,timeoutMs?} -> long-poll (~25s) the review loop
```
`wait_for_review` returns `{status:'pending'}` (call again), `{status:'changes_requested',notes,latestVersion}`,
or `{status:'approved',notes}`; it consumes the signal (resets to idle) when the user acts. `notes` are the open
user notes. The AI's loop: `apply([…changes, addVersion, requestReview])` → `wait_for_review` until not pending →
revise + resolveNote + addVersion + requestReview → repeat until approved.

Individual mutation tools are intentionally NOT exposed — `apply` is the only write path.

Consumer `.mcp.json`: `{ "mcpServers": { "easle": { "type":"http", "url":"http://127.0.0.1:47600/mcp" } } }`.

## Seed (runSchemaAndSeed)
Run schema.sql (from `@easle/shared/schema.sql`). If no documents exist, create one project "Demo" → one document "Demo" (under it) → one page "Page 1" → one `frame` node (x 80,y 80,w 393,h 852,name "Screen 1") on that page → one child `content` node (name "Card", x 24,y 120,w 345,h 200) whose content renders a simple styled card so the canvas isn't empty on first run.
