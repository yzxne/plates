import { IconClose } from './Icons';

const OPTIONS = [
  { label: 'Search foods', phase: 2 },
  { label: 'Scan barcode', phase: 3 },
  { label: 'Paste label text', phase: 2 },
  { label: 'AI meal scan', phase: 6 },
  { label: 'Paste AI result', phase: 6 },
  { label: 'Quick add', phase: 2 },
];

export function AddSheet({ onClose }: { onClose: () => void }) {
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Add" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-head">
          <h2>Add</h2>
          <button class="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>
        <div class="list">
          {OPTIONS.map((o) => (
            <div class="row disabled" key={o.label}>
              <span>{o.label}</span>
              <small>Phase {o.phase}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
