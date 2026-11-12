// Front + back body figures; each muscle in today's workout fills with color as you check off its sets.
// Original simple SVG shapes (not taken from any app). Left-side shapes are drawn once and mirrored.

type Progress = Record<string, { planned: number; done: number }>;

interface Shape { m: string; d?: string; e?: [cx: number, cy: number, rx: number, ry: number, rot?: number]; mirror?: boolean }

const FRONT: Shape[] = [
  { m: 'Traps', d: 'M44 29 Q38 32 34 35 L45 35 Z', mirror: true },
  { m: 'Shoulders', e: [29, 42, 6.5, 7.5, -15], mirror: true },
  { m: 'Chest', d: 'M49 37 Q37 35 34 43 Q33 54 40 56.5 Q47 58 49 54 Z', mirror: true },
  { m: 'Biceps', e: [25.5, 59, 4.3, 9.5, 8], mirror: true },
  { m: 'Forearms', e: [21.5, 82, 3.8, 11, 10], mirror: true },
  { m: 'Abs', d: 'M43.5 60 h5.5 v8 h-6 v-6.5 a1.5 1.5 0 0 1 0.5 -1.5 Z M43 70 h6 v8.5 h-6 Z M43 80.5 h6 v8 q0 4 -3 6 q-3 -2 -3 -6 Z', mirror: true },
  { m: 'Abs', d: 'M36 62 Q35 76 38 92 L41 92 L41 62 Z', mirror: true },
  { m: 'Quads', e: [41, 128, 7.5, 20, 3], mirror: true },
  { m: 'Calves', e: [40, 169, 4, 11], mirror: true },
];

const BACK: Shape[] = [
  { m: 'Traps', d: 'M50 24 Q45 30 37 34 Q44 37 47 44 L50 52 L53 44 Q56 37 63 34 Q55 30 50 24 Z' },
  { m: 'Shoulders', e: [29, 42, 6.5, 7.5, 15], mirror: true },
  { m: 'Back', d: 'M38 37 Q44 39 48 46 L48 55 Q42 52 37 47 Z', mirror: true },
  { m: 'Lats', d: 'M36.5 49 Q42 54 48 57 L48 68 L41 78 Q34 64 36.5 49 Z', mirror: true },
  { m: 'Back', d: 'M44 74 h12 v18 q-6 4 -12 0 Z' },
  { m: 'Triceps', e: [25.5, 59, 4.3, 9.5, 8], mirror: true },
  { m: 'Forearms', e: [21.5, 82, 3.8, 11, 10], mirror: true },
  { m: 'Glutes', e: [42.5, 104, 7.5, 7.5], mirror: true },
  { m: 'Hamstrings', e: [41, 131, 7, 16, 3], mirror: true },
  { m: 'Calves', e: [40, 167, 5, 12], mirror: true },
];

/** Plain body outline both views share. */
function Silhouette() {
  const half = (
    <>
      <ellipse cx="25" cy="56" rx="7" ry="16" transform="rotate(8 25 56)" />
      <ellipse cx="21" cy="83" rx="5.5" ry="14" transform="rotate(10 21 83)" />
      <circle cx="18.5" cy="101" r="4" />
      <ellipse cx="41" cy="128" rx="9.5" ry="24" transform="rotate(3 41 128)" />
      <ellipse cx="40" cy="169" rx="6" ry="18" />
      <ellipse cx="39" cy="190" rx="6" ry="3" />
    </>
  );
  return (
    <g class="bm-body">
      <circle cx="50" cy="14" r="9" />
      <rect x="45.5" y="21" width="9" height="10" rx="3" />
      <path d="M30 32 Q50 26 70 32 L72 48 Q68 70 66 96 L68 112 L32 112 L34 96 Q32 70 28 48 Z" />
      {half}
      <g transform="matrix(-1 0 0 1 100 0)">{half}</g>
    </g>
  );
}

function Figure({ shapes, progress, label }: { shapes: Shape[]; progress: Progress; label: string }) {
  const draw = (s: Shape, key: string, flip: boolean) => {
    const p = progress[s.m];
    const frac = p && p.planned > 0 ? Math.min(1, p.done / p.planned) : 0;
    const cls = !p ? 'bm-m' : 'bm-m on';
    const style = p ? { fillOpacity: 0.18 + 0.82 * frac } : undefined;
    const t = flip ? 'matrix(-1 0 0 1 100 0)' : undefined;
    if (s.e) {
      const [cx, cy, rx, ry, rot] = s.e;
      return <g key={key} transform={t}><ellipse class={cls} style={style} cx={cx} cy={cy} rx={rx} ry={ry} transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined} /></g>;
    }
    return <path key={key} class={cls} style={style} d={s.d} transform={t} />;
  };
  return (
    <figure class="bm-fig">
      <svg viewBox="8 2 84 194" role="img" aria-label={`${label} view`}>
        <Silhouette />
        {shapes.flatMap((s, i) => (s.mirror ? [draw(s, `${i}a`, false), draw(s, `${i}b`, true)] : [draw(s, `${i}`, false)]))}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function BodyMap({ progress }: { progress: Progress }) {
  const worked = Object.entries(progress).filter(([m]) => m !== 'Cardio' && m !== 'Full body');
  if (!worked.length) return null;
  const desc = worked
    .sort((a, b) => b[1].planned - a[1].planned)
    .map(([m, p]) => `${m} ${Math.round((p.done / p.planned) * 100)}%`).join(', ');
  return (
    <div class="body-map" aria-label={`Muscles today: ${desc}`}>
      <Figure shapes={FRONT} progress={progress} label="Front" />
      <Figure shapes={BACK} progress={progress} label="Back" />
    </div>
  );
}
