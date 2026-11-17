// Front + back body; each muscle in today's workout lights up as you check off its sets.
// Body artwork: MuscleMap by Jsplice (MIT, https://github.com/Jsplice/MuscleMap), @musclemap/assets.
// Paths are drawn for the LEFT side (or CENTER) and mirrored across centerX for the right side.
import { useEffect, useState } from 'preact/hooks';
import type { BodyDiagram } from '@musclemap/assets';
import { getSettings } from '../settingsStore';

type Progress = Record<string, { planned: number; done: number }>;

/** Plates muscle names → MuscleMap groups. */
const GROUPS: Record<string, string[]> = {
  Chest: ['CHEST'],
  Shoulders: ['SHOULDERS_FRONT', 'SHOULDERS_SIDE', 'SHOULDERS_REAR'],
  Back: ['RHOMBOIDS', 'BACK_LOWER', 'BACK_UPPER'],
  Lats: ['LATS'],
  Traps: ['TRAPEZIUS'],
  Biceps: ['BICEPS'],
  Triceps: ['TRICEPS'],
  Forearms: ['FOREARMS'],
  Abs: ['CORE', 'OBLIQUES'],
  Quads: ['QUADS', 'ADDUCTORS'],
  Hamstrings: ['HAMSTRINGS'],
  Glutes: ['GLUTES', 'ABDUCTORS'],
  Calves: ['CALVES'],
};

type Bodies = { front: BodyDiagram; back: BodyDiagram };
let loaded: Promise<Bodies> | null = null;
/** The artwork is ~130 KB of path data, so it loads only when a body map is first shown. */
function loadBodies(female: boolean): Promise<Bodies> {
  loaded ??= import('@musclemap/assets').then((m) => (female ? { front: m.FEMALE_FRONT, back: m.FEMALE_BACK } : { front: m.MALE_FRONT, back: m.MALE_BACK }));
  return loaded;
}

function Figure({ body, level, label }: { body: BodyDiagram; level: Map<string, number>; label: string }) {
  const mirror = `matrix(-1 0 0 1 ${body.centerX * 2} 0)`;
  const both = <T extends { side: string }>(list: T[], draw: (x: T, key: string, t?: string) => preact.JSX.Element) =>
    list.flatMap((x, i) => (x.side === 'CENTER' ? [draw(x, `${i}`)] : [draw(x, `${i}l`), draw(x, `${i}r`, mirror)]));
  return (
    <figure class="bm-fig">
      <svg viewBox={body.viewBox} role="img" aria-label={`${label} view`}>
        <defs>
          <linearGradient id="bm-hot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ff8a6b" />
            <stop offset="1" stop-color="#e2453a" />
          </linearGradient>
          <filter id="bm-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g class="bm-body">{both(body.outline, (o, k, t) => <path key={k} d={o.d} transform={t} />)}</g>
        {both(body.muscles, (m, k, t) => {
          const f = level.get(m.group);
          return f == null
            ? <path key={k} class="bm-m" d={m.d} transform={t} />
            : <path key={k} class="bm-m on" d={m.d} transform={t} style={{ fillOpacity: 0.25 + 0.75 * f }} filter={f >= 1 ? 'url(#bm-glow)' : undefined} />;
        })}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function BodyMap({ progress }: { progress: Progress }) {
  const [bodies, setBodies] = useState<Bodies | null>(null);
  useEffect(() => { void loadBodies(getSettings().sex === 'female').then(setBodies); }, []);
  const worked = Object.entries(progress).filter(([m]) => GROUPS[m]);
  if (!worked.length) return null;

  // Each MuscleMap group gets the best progress of the Plates muscles that map to it.
  const level = new Map<string, number>();
  for (const [m, p] of worked) {
    const f = p.planned > 0 ? Math.min(1, p.done / p.planned) : 0;
    for (const g of GROUPS[m]!) level.set(g, Math.max(level.get(g) ?? 0, f));
  }
  const desc = worked.sort((a, b) => b[1].planned - a[1].planned)
    .map(([m, p]) => `${m} ${Math.round((p.done / Math.max(1, p.planned)) * 100)}%`).join(', ');
  return (
    <div class="body-map" aria-label={`Muscles today: ${desc}`}>
      {bodies ? (
        <>
          <Figure body={bodies.front} level={level} label="Front" />
          <Figure body={bodies.back} level={level} label="Back" />
        </>
      ) : <div class="bm-loading" />}
    </div>
  );
}
