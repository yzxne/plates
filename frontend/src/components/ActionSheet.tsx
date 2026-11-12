// A simple bottom sheet of buttons (instead of the iPhone wheel picker for "⋯" menus).
export interface SheetAction { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }

export function ActionSheet({ title, actions, onClose }: { title?: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet action-sheet" role="dialog" aria-modal="true" aria-label={title ?? 'Options'} onClick={(e) => e.stopPropagation()}>
        {title && <p class="action-title clip">{title}</p>}
        <div class="list card">
          {actions.map((a) => (
            <button key={a.label} class={`row ${a.danger ? 'danger' : ''}`} disabled={a.disabled} onClick={() => { onClose(); a.onClick(); }}>
              <span class="row-text"><span>{a.label}</span>{a.hint && <small class="muted">{a.hint}</small>}</span>
            </button>
          ))}
        </div>
        <button class="btn" style="width:100%" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
