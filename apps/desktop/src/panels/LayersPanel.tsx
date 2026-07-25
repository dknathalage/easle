import { useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { useStore, buildLayerTree } from '../store/store';
import type { TreeNode } from '../store/store';

const TYPE_ICON: Record<string, string> = { frame: '▭', group: '⧉', content: '◈' };

export function LayersPanel() {
  const nodes = useStore((s) => s.nodes);
  const currentPageId = useStore((s) => s.currentPageId);
  const tree = buildLayerTree(nodes).filter((n) => n.pageId === currentPageId);
  return (
    <div className="panel layers-panel">
      <div className="panel-head">
        <span>Layers</span>
        <GroupButtons />
      </div>
      <div className="panel-body">
        {tree.length === 0 && <div className="panel-empty">No layers yet.</div>}
        {tree.map((n) => (
          <LayerRow key={n.id} node={n} />
        ))}
      </div>
    </div>
  );
}

function GroupButtons() {
  const groupSelection = useStore((s) => s.groupSelection);
  const ungroupSelection = useStore((s) => s.ungroupSelection);
  const selection = useStore((s) => s.selection);
  const nodes = useStore((s) => s.nodes);
  const hasGroup = selection.some((id) => nodes.find((n) => n.id === id)?.type === 'group');
  return (
    <span className="group-buttons">
      <button title="Group (⌘G)" disabled={selection.length < 1} onClick={() => groupSelection()}>Group</button>
      <button title="Ungroup (⌘⇧G)" disabled={!hasGroup} onClick={() => ungroupSelection()}>Ungroup</button>
    </span>
  );
}

function LayerRow({ node }: { node: TreeNode }) {
  const selection = useStore((s) => s.selection);
  const collapsed = useStore((s) => s.collapsed[node.id]);
  const select = useStore((s) => s.select);
  const toggleCollapsed = useStore((s) => s.toggleCollapsed);
  const updateNode = useStore((s) => s.updateNode);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const selected = selection.includes(node.id);
  const hasKids = node.children.length > 0;

  const commit = () => {
    setEditing(false);
    if (name.trim() && name !== node.name) updateNode(node.id, { name: name.trim() });
    else setName(node.name);
  };

  const onDragStart = (e: ReactDragEvent) => {
    e.dataTransfer.setData('text/node-id', String(node.id));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const src = Number(e.dataTransfer.getData('text/node-id'));
    if (!src || src === node.id) return;
    // reparent onto a frame/group; otherwise reorder as sibling (share parent, adjust z)
    if (node.type === 'frame' || node.type === 'group') {
      updateNode(src, { parentId: node.id });
    } else {
      updateNode(src, { parentId: node.parentId, z: node.z + 1 });
    }
  };

  return (
    <div className="layer-branch" style={{ ['--depth' as any]: node.depth }}>
      <div
        className={`layer-row ${selected ? 'layer-selected' : ''} ${node.visible ? '' : 'layer-hidden'}`}
        draggable={!editing}
        onDragStart={onDragStart}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={onDrop}
        onClick={(e) => select(node.id, e.shiftKey)}
      >
        <span className="layer-indent" style={{ width: node.depth * 14 }} />
        {hasKids ? (
          <button className="layer-twisty" onClick={(e) => { e.stopPropagation(); toggleCollapsed(node.id); }}>
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="layer-twisty layer-twisty-empty" />
        )}
        <span className="layer-icon">{TYPE_ICON[node.type] ?? '•'}</span>
        {editing ? (
          <input
            className="layer-name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(node.name); setEditing(false); } }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="layer-name" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>
            {node.name}
          </span>
        )}
        <button
          className="layer-btn"
          title={node.visible ? 'Hide' : 'Show'}
          onClick={(e) => { e.stopPropagation(); updateNode(node.id, { visible: !node.visible }); }}
        >{node.visible ? '👁' : '🚫'}</button>
        <button
          className="layer-btn"
          title={node.locked ? 'Unlock' : 'Lock'}
          onClick={(e) => { e.stopPropagation(); updateNode(node.id, { locked: !node.locked }); }}
        >{node.locked ? '🔒' : '🔓'}</button>
      </div>
      {!collapsed && node.children.map((c) => <LayerRow key={c.id} node={c} />)}
    </div>
  );
}
