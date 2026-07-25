import type { Note } from '../store/types';

interface Props {
  note: Note;
  onClick?: () => void;
}

// A pin rendered in world space (inside the transformed canvas plane).
export function NotePin({ note, onClick }: Props) {
  return (
    <div
      className={`note-pin note-pin-${note.author} note-pin-${note.status}`}
      style={{ left: note.x, top: note.y }}
      title={`${note.author}: ${note.body}`}
      onPointerDown={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      {note.author === 'ai' ? '✦' : '💬'}
    </div>
  );
}
