import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useStore } from '../store/store';
import type { CanvasNode } from '../store/types';
import { ContentFrame } from './ContentFrame';
import { ResizeHandles } from './ResizeHandles';

interface Props {
  node: CanvasNode;
  childrenNodes: CanvasNode[]; // direct children (already ordered by z)
  allNodes: CanvasNode[];
}

// Recursive node renderer. Positioned absolutely relative to its parent.
export function NodeView({ node, childrenNodes, allNodes }: Props) {
  const selection = useStore((s) => s.selection);
  const camera = useStore((s) => s.camera);
  const mode = useStore((s) => s.mode);
  const enteredNodeId = useStore((s) => s.enteredNodeId);
  const select = useStore((s) => s.select);
  const enterNode = useStore((s) => s.enterNode);
  const moveSelectionBy = useStore((s) => s.moveSelectionBy);

  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const pendingMove = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const selected = selection.includes(node.id);
  const entered = enteredNodeId === node.id;

  if (!node.visible) return null;

  const kidsOf = (id: number) => allNodes.filter((n) => n.parentId === id).sort((a, b) => a.z - b.z);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (mode === 'note') return; // note mode handled by Canvas overlay
    if (node.locked) {
      // still selectable but not draggable
      e.stopPropagation();
      select(node.id, e.shiftKey);
      return;
    }
    e.stopPropagation();
    select(node.id, e.shiftKey);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
    pendingMove.current = { dx: 0, dy: 0 };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / camera.zoom;
    const dy = (e.clientY - dragRef.current.startY) / camera.zoom;
    const incX = dx - pendingMove.current.dx;
    const incY = dy - pendingMove.current.dy;
    pendingMove.current = { dx, dy };
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
    if (dragRef.current.moved) moveSelectionBy(incX, incY);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (node.type === 'content') {
      e.stopPropagation();
      enterNode(entered ? null : node.id);
    }
  };

  const cls = [
    'node',
    `node-${node.type}`,
    selected ? 'node-selected' : '',
    entered ? 'node-entered' : '',
    node.locked ? 'node-locked' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {(node.type === 'frame' || node.type === 'group') && (
        <div className="node-label">{node.name}{node.locked ? ' 🔒' : ''}</div>
      )}

      {node.type === 'content' && (
        <ContentFrame content={node.content} entered={entered} />
      )}

      {/* nested children positioned relative to this node */}
      {childrenNodes.map((c) => (
        <NodeView key={c.id} node={c} childrenNodes={kidsOf(c.id)} allNodes={allNodes} />
      ))}

      {selected && !node.locked && <ResizeHandles node={node} />}
    </div>
  );
}
