import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';

// In-app prompt/confirm dialog. Electron doesn't support window.prompt/confirm,
// so all text input + confirmations route through here.
export function ModalHost() {
  const modal = useStore((s) => s.modal);
  const resolveModal = useStore((s) => s.resolveModal);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (modal?.kind === 'prompt') {
      setValue(modal.defaultValue ?? '');
      // focus + select on open
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [modal]);

  if (!modal) return null;

  const isPrompt = modal.kind === 'prompt';
  const ok = () => resolveModal(isPrompt ? value : true);
  const cancel = () => resolveModal(isPrompt ? null : false);

  return (
    <div className="modal-backdrop" onPointerDown={cancel}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{modal.title}</div>
        {isPrompt && (
          <input
            ref={inputRef}
            className="modal-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ok();
              if (e.key === 'Escape') cancel();
            }}
          />
        )}
        <div className="modal-actions">
          <button className="btn" onClick={cancel}>Cancel</button>
          <button className="btn btn-primary" onClick={ok}>{isPrompt ? 'Add' : 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
