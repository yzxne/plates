// Thin wrapper around uPlot (MIT, ~21 KB gzip). Loaded only when a chart is on screen.
// Tap or drag on the chart to read exact values (shown above the chart).
import { useEffect, useRef, useState } from 'preact/hooks';
import type uPlot from 'uplot';

export interface SeriesSpec {
  label: string;
  color: string;
  kind: 'line' | 'points' | 'bars' | 'step';
  unit?: string;
  digits?: number;
}

interface Props {
  x: number[]; // unix seconds
  ys: (number | null)[][];
  series: SeriesSpec[];
  height?: number;
}

// uPlot's default y padding (10%, soft zero).
const Y_RANGE: uPlot.Range.Config = { min: { pad: 0.1, soft: 0, mode: 3 }, max: { pad: 0.1, soft: 0, mode: 3 } };
const AXIS = { stroke: '#9aa3ae', grid: { stroke: '#2a2f37', width: 1 }, ticks: { stroke: '#2a2f37', width: 1 }, font: '11px -apple-system, system-ui, sans-serif' };

export function UChart({ x, ys, series, height = 180 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const [readout, setReadout] = useState('');

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    (async () => {
      const [{ default: U }] = await Promise.all([import('uplot'), import('uplot/dist/uPlot.min.css')]);
      if (cancelled || !box.current) return;
      const width = box.current.clientWidth || 320;
      const opts: uPlot.Options = {
        width,
        height,
        legend: { show: false },
        cursor: { drag: { x: false, y: false }, points: { size: 7 } },
        scales: {
          x: { time: true },
          // A flat line (e.g. trend with no weigh-ins in range) would otherwise get a huge 0–300 axis.
          y: { range: (_u, min, max) => (min === max ? [min - 2, max + 2] : U.rangeNum(min, max, Y_RANGE)) },
        },
        axes: [{ ...AXIS }, { ...AXIS, size: 44 }],
        series: [
          {},
          ...series.map((s): uPlot.Series => ({
            label: s.label,
            stroke: s.kind === 'bars' ? undefined : s.color,
            fill: s.kind === 'bars' ? `${s.color}cc` : undefined,
            width: s.kind === 'points' ? 0 : 2,
            points: { show: s.kind === 'points', size: 5, fill: s.color, stroke: s.color },
            paths: s.kind === 'bars' ? U.paths.bars!({ size: [0.7, 24] }) : s.kind === 'step' ? U.paths.stepped!({ align: 1 }) : undefined,
            spanGaps: s.kind === 'line',
          })),
        ],
        hooks: {
          setCursor: [(u: uPlot) => {
            const i = u.cursor.idx;
            if (i == null) { setReadout(''); return; }
            const date = new Date((u.data[0][i] as number) * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
            const parts = series.map((s, k) => {
              const v = u.data[k + 1]?.[i];
              return v == null ? null : `${s.label} ${(v as number).toLocaleString('en-US', { maximumFractionDigits: s.digits ?? 0 })}${s.unit ? ` ${s.unit}` : ''}`;
            }).filter(Boolean);
            setReadout(`${date} · ${parts.join(' · ')}`);
          }],
        },
      };
      plot.current?.destroy();
      plot.current = new U(opts, [x, ...ys] as uPlot.AlignedData, box.current);
      // Touch: move the cursor where the finger is.
      const over = box.current.querySelector('.u-over') as HTMLElement | null;
      const touch = (e: TouchEvent) => {
        const t = e.touches[0];
        if (!t || !over || !plot.current) return;
        const r = over.getBoundingClientRect();
        plot.current.setCursor({ left: t.clientX - r.left, top: t.clientY - r.top });
      };
      over?.addEventListener('touchstart', touch, { passive: true });
      over?.addEventListener('touchmove', touch, { passive: true });
      ro = new ResizeObserver(() => {
        if (box.current && plot.current) plot.current.setSize({ width: box.current.clientWidth, height });
      });
      ro.observe(box.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [x, ys, series, height]);

  return (
    <div class="uchart">
      <div class="readout muted">{readout || 'Tap the chart for exact values'}</div>
      <div ref={box} />
    </div>
  );
}

/** Tiny inline sparkline (no library). */
export function Sparkline({ values, color = 'var(--link)', dots = false }: { values: (number | null)[]; color?: string; dots?: boolean }) {
  const v = values.filter((n): n is number => n != null);
  if (v.length < 2) return <svg class="spark" viewBox="0 0 100 30" aria-hidden="true" />;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = values.map((n, i) => (n == null ? null : [(i / (values.length - 1)) * 100, 27 - ((n - min) / span) * 24] as const));
  return (
    <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      {dots
        ? pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r="1.8" fill={color} /> : null))
        : <polyline fill="none" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" points={pts.filter(Boolean).map((p) => p!.join(',')).join(' ')} />}
    </svg>
  );
}
