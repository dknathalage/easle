import { useStore } from '../store/store';
import type { Note } from '../store/types';

export function NotesPanel() {
  const notes = useStore((s) => s.notes);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const noteFilter = useStore((s) => s.noteFilter);
  const setNoteFilter = useStore((s) => s.setNoteFilter);
  const resolveNote = useStore((s) => s.resolveNote);

  return (
    <div className="panel notes-panel">
      <div className="panel-head">
        <span>Notes</span>
        <button
          className={`note-mode-btn ${mode === 'note' ? 'active' : ''}`}
          title="Note mode (N): click the canvas to pin a note"
          onClick={() => setMode(mode === 'note' ? 'select' : 'note')}
        >{mode === 'note' ? '● Placing…' : '+ Note'}</button>
      </div>
      <div className="notes-filter">
        <label>
          <input
            type="radio"
            checked={noteFilter === 'open'}
            onChange={() => setNoteFilter('open')}
          /> Open
        </label>
        <label>
          <input
            type="radio"
            checked={noteFilter === 'all'}
            onChange={() => setNoteFilter('all')}
          /> All
        </label>
      </div>
      <div className="panel-body">
        {notes.length === 0 && <div className="panel-empty">No notes. Click “+ Note”, then click the canvas.</div>}
        {notes.map((n) => (
          <NoteCard key={n.id} note={n} onResolve={(r) => resolveNote(n.id, r)} />
        ))}
      </div>
    </div>
  );
}

function NoteCard({ note, onResolve }: { note: Note; onResolve: (r: 'resolved' | 'wontfix') => void }) {
  return (
    <div className={`note-card note-${note.author} note-status-${note.status}`}>
      <div className="note-card-head">
        <span className={`note-author note-author-${note.author}`}>
          {note.author === 'ai' ? '✦ AI' : '💬 You'}
        </span>
        <span className={`note-status note-status-tag-${note.status}`}>{note.status}</span>
      </div>
      <div className="note-body">{note.body}</div>
      {note.status === 'open' && (
        <div className="note-actions">
          <button onClick={() => onResolve('resolved')}>Resolve</button>
          <button className="ghost" onClick={() => onResolve('wontfix')}>Won’t fix</button>
        </div>
      )}
    </div>
  );
}
