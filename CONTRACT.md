# Easle integration contract (build to this exactly)

Three modules are built in parallel against this contract. Do not deviate from names/shapes.

## Data shapes (JSON)

```
Document = { id, name, createdAt, updatedAt }
Node = { id, documentId, parentId|null, type:'frame'|'group'|'content',
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
listDocuments(): Document[]
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
```

## Preload IPC (apps/desktop/electron/preload.js) — renderer uses `window.easle`

`window.easle` mirrors the DB layer 1:1 as async methods (Promise-returning, via ipcRenderer.invoke to channels named `easle:<method>`), PLUS:
```
window.easle.onChanged(cb): () => void   // subscribe to main→renderer 'db:changed'; returns unsubscribe
```
Main registers `ipcMain.handle('easle:<method>', (e,...args)=>db.<method>(...args))` for every method, and sends `db:changed` to all windows via the emitChanged hook.

## Localhost HTTP API (apps/desktop/electron/api.js) — MCP uses this

Loopback only (`127.0.0.1:47600` from @canvas/shared). JSON in/out. Wraps the SAME db layer.
```
GET  /health                         -> { ok:true }
GET  /documents                      -> Document[]
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

## MCP tools (packages/mcp/server.js) — stdio, thin HTTP client to the API

Tool name -> API call. All return compact JSON text. If the API is unreachable, return an error telling the user to start the Easle app.
```
list_documents            -> GET /documents
get_tree {documentId?}    -> GET /tree (default first document)
get_node {id}             -> GET /node/:id
create_node {documentId,parentId?,type,name?,x?,y?,w?,h?} -> POST /node
update_node {id, ...patch}-> PATCH /node/:id
set_content {id,html?,css?,js?} -> PUT /node/:id/content
delete_node {id}          -> DELETE /node/:id
group_nodes {nodeIds,name?}-> POST /group
ungroup {groupId}         -> POST /ungroup
list_notes {status?,documentId?} -> GET /notes (default status=open)
resolve_note {id,resolution?} -> POST /note/:id/resolve (default resolution='resolved')
add_version {documentId,summary} -> POST /version (author:'ai')
list_versions {documentId}-> GET /versions
restore_version {id}      -> POST /version/:id/restore
```

## Seed (runSchemaAndSeed)
Run schema.sql (from @canvas/shared/schema.sql). If no documents exist, create one document "Demo", one `frame` node (x 80,y 80,w 393,h 852,name "Screen 1"), and one child `content` node (name "Card", x 24,y 120,w 345,h 200) whose content renders a simple styled card so the canvas isn't empty on first run.
