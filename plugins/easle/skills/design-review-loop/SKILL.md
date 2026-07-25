---
name: design-review-loop
description: Use when the user wants to design, mock up, or iterate on a UI/screen/component in Easle — the local canvas app. Covers authoring HTML/CSS/JS designs via the Easle MCP server and running the in-app review loop (push a version, wait for the user's notes in the app, revise, repeat until approved).
---

# Designing in Easle

Easle is a local desktop app where **you (the AI) author** interactive HTML/CSS/JS
designs on an infinite canvas, and **the user reviews** them in the app — leaving
pinned notes and approving versions. You drive everything through the **`easle` MCP
server**. This skill is the loop.

## Prerequisites

The Easle app must be **running** (it hosts the MCP server on `127.0.0.1:47600`). If
any `easle` tool errors with a connection/"start the Easle app" message, tell the user
to launch Easle, then continue. Don't try to start it yourself.

## The one write path: `apply(ops)`

**Every mutation goes through `apply`** — an array of ops run in one transaction (all
succeed or all roll back). There are no individual create/update/delete tools. Batch
aggressively: build a whole tree in a single call.

**Temp refs** wire up parent/child links within one `apply` call: a create op declares
`ref:"x"`; later ops reference it via `documentRef` / `pageRef` / `parentRef` / `projectRef`
(or `ref` in an id position for updates/deletes).

### Structure

`Project → Document → Page → nodes`. Node `type` is:
- **`frame`** — a screen/container (e.g. a 393×852 phone frame).
- **`group`** — organizational grouping.
- **`content`** — a leaf design, authored as self-contained **HTML/CSS/JS**. This is
  where the actual UI lives. Pass `content:{html,css,js}` right in the `createNode` op.

Author content as complete, live HTML/CSS/JS (CSS scoped within the node; JS optional
for interactivity). Frames hold content; don't put raw HTML on a frame.

### Example — author a screen in one call

```json
apply({ "ops": [
  {"op":"createProject","ref":"p","name":"Onboarding"},
  {"op":"createDocument","ref":"d","projectRef":"p","name":"Sign up"},
  {"op":"createPage","ref":"pg","documentRef":"d","name":"Page 1"},
  {"op":"createNode","ref":"screen","documentRef":"d","pageRef":"pg","type":"frame","name":"Sign up","x":80,"y":80,"w":393,"h":852},
  {"op":"createNode","documentRef":"d","parentRef":"screen","type":"content","name":"Form","x":24,"y":120,"w":345,"h":520,
   "content":{"html":"<form class=\"c\">…</form>","css":".c{…}","js":""}}
]})
```

If a document already exists, read it first with `get_tree` (defaults to the first
document) and reuse its ids instead of creating a new project.

## The review loop (the important part)

After authoring or revising, **hand off to the user inside the app and wait**. Do not
end your turn assuming the user will come back to chat — park on the app.

1. **Push + request review** in one batch:
   ```json
   apply({ "ops": [ …your changes…, {"op":"addVersion","documentRef":"d","summary":"Sign-up screen v1"}, {"op":"requestReview","documentRef":"d"} ]})
   ```
   (Use real `documentId` once you have it.) This snapshots a version and flips the app
   into "awaiting review" — a review bar appears with **Submit review** and **Approve & continue**.

2. **Wait** by calling `wait_for_review`. It returns one of:
   - `{"status":"pending"}` — the user hasn't acted yet. **Call `wait_for_review` again.**
     Keep doing this to stay parked; each call blocks ~25s.
   - `{"status":"changes_requested","notes":[…]}` — the user pressed **Submit review**.
     Go to step 3.
   - `{"status":"approved"}` — the user pressed **Approve & continue**. **Stop the loop**
     and continue your broader task.

3. **Revise** based on the open `notes` (each has `body`, and `nodeId` when pinned to a
   node). In one `apply` batch: make the edits (`setContent`, `updateNode`, `createNode`,
   `deleteNode`, …), `resolveNote` each note you addressed
   (`{"op":"resolveNote","id":<noteId>}`), then `addVersion` and `requestReview` again.

4. **Back to step 2.** Repeat until `approved`.

Always `addVersion` before `requestReview` so each review round is a distinct, comparable
version. Always resolve the notes you actually addressed so the user sees progress.

## Deleting

Deletion is just `apply` ops — no separate tool:
- `{"op":"deleteNode","id":<id>}` (or `"ref"`) — removes a node and its subtree.
- `{"op":"deletePage","id":<id>}`, `{"op":"deleteDocument","id":<id>}`, `{"op":"deleteProject","id":<id>}`.

Deletes are destructive and cascade. When you remove something the user asked about,
say so in your version summary.

## Read tools (no writes)

- `list_projects` / `get_project {id}` — inventory.
- `get_tree {documentId?}` — the flat node tree with content; defaults to first document.
- `get_node {id}` — one node.
- `list_notes {documentId?, status?}` — feedback (default open); `wait_for_review` already
  returns the open user notes, so you rarely need this mid-loop.
- `list_versions {documentId?}` / `get_version {id}` — history + snapshots.
- `get_review_state {documentId?}` — non-blocking peek at `idle|awaiting|changes_requested|approved`.

## Guardrails

- `apply` is the **only** write path; never assume per-op tools exist.
- One `apply` call = one atomic batch. Prefer one big call over many small ones.
- After pushing a version, **park on `wait_for_review`** — don't finish your turn until
  the user approves (or explicitly redirects you in chat).
- Keep content self-contained; don't rely on external network resources.
