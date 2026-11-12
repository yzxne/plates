import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Food } from '../../../shared/nutrition';
import { errorMessage } from '../api';
import { IconBack } from '../components/Icons';
import { deleteFood, loadFoods } from '../foodData';
import { foodSummary, macroLine, sourceLabel } from '../format';
import { scale } from '../../../shared/nutrition';
import { showToast } from '../toast';
import { SkeletonRows } from '../components/Skeleton';

export function SavedFoods({ onBack }: { onBack: () => void }) {
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    loadFoods(true).then(setFoods).catch((err) => setError(errorMessage(err)));
  }, []);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (foods ?? []).filter((f) => words.every((w) => `${f.name} ${f.brand}`.toLowerCase().includes(w)));
  }, [foods, q]);

  async function remove(f: Food) {
    if (!confirm(`Remove "${f.name}" from saved foods? Past log entries stay as they are.`)) return;
    try {
      await deleteFood(f);
      setFoods((list) => (list ?? []).filter((x) => x.id !== f.id));
      showToast('Removed', 'info');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  return (
    <section>
      <header class="screen-head with-back">
        <button class="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
        <h1>Saved foods</h1>
      </header>
      {error && <p class="error">{error}</p>}
      <input type="search" placeholder="Filter" value={q} onInput={(e) => setQ(e.currentTarget.value)} class="mb" />
      {foods && shown.length === 0 && <p class="muted">No saved foods{q ? ' match' : ' yet'}.</p>}
      {!foods && !error && <SkeletonRows rows={5} />}
      <div class="list card">
        {shown.map((f) => (
          <div key={f.id}>
            <button class="row" onClick={() => setOpen(open === f.id ? null : f.id!)}>
              <span class="row-text">
                <span class="clip">{f.name}</span>
                <small class="muted clip">{[f.brand, sourceLabel(f), foodSummary(f)].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
            {open === f.id && (
              <div class="row-detail">
                <small class="muted">Per 100 g: {Math.round(f.per100.kcal)} kcal · {macroLine(f.per100)}</small>
                {f.grams_per_serving && <small class="muted">Per serving ({f.serving_size}): {macroLine(scale(f.per100, f.grams_per_serving))}</small>}
                {f.barcode && <small class="muted">Barcode {f.barcode}</small>}
                <button class="btn link danger" onClick={() => remove(f)}>Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
