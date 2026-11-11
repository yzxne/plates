import { useEffect, useState } from 'preact/hooks';
import { hideUndo, subscribeUndo, type UndoMsg } from '../undo';

export function UndoHost() {
  const [msg, setMsg] = useState<UndoMsg | null>(null);
  useEffect(() => subscribeUndo(setMsg), []);
  if (!msg) return null;
  return (
    <div class="undo-bar" role="status" key={msg.id}>
      <span class="clip">{msg.text}</span>
      {msg.edit && <button class="btn link" onClick={() => { hideUndo(); msg.edit!(); }}>Edit</button>}
      {msg.undo && <button class="btn link" onClick={() => { hideUndo(); void msg.undo!(); }}>Undo</button>}
    </div>
  );
}
