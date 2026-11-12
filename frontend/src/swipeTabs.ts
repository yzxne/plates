// Swipe between tabs (docs/swipe-tabs-proposal.md). Only starts on empty space so it never fights other gestures.
import type { TabId } from './components/TabBar';

export const TAB_ORDER: TabId[] = ['today', 'progress', 'train'];

// Touches starting on these keep their own behavior (day swipe, entry swipe, charts, controls, sheets).
const IGNORE = [
  '.swipe-wrap', '.today-head', '.uchart', '.chart', '.radar', '.wk', '.stack', '.habit',
  'input', 'select', 'textarea', 'button', 'a', 'label', '.chips', '.seg', '[data-noswipe]',
].join(',');
const EDGE = 24; // px from either screen edge (iOS edge gestures)
const MIN_DX = 80;

/** Returns the tab to go to for a finished touch, or null. Pure, for tests. */
export function swipeTarget(current: TabId, dx: number, dy: number, ms: number): TabId | null {
  if (Math.abs(dx) < MIN_DX || Math.abs(dx) < 2 * Math.abs(dy) || ms > 800) return null;
  const i = TAB_ORDER.indexOf(current) + (dx < 0 ? 1 : -1);
  return TAB_ORDER[i] ?? null; // no wrap-around
}

export function swipeHandlers(getTab: () => TabId, go: (t: TabId, dir: 1 | -1) => void, enabled: () => boolean) {
  let start: { x: number; y: number; t: number } | null = null;
  return {
    onTouchStart(e: TouchEvent) {
      start = null;
      if (!enabled() || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
      if ((e.target as Element | null)?.closest?.(IGNORE)) return;
      if (document.querySelector('.overlay, .sheet-backdrop')) return;
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    },
    onTouchEnd(e: TouchEvent) {
      if (!start) return;
      const t = e.changedTouches[0];
      const s = start;
      start = null;
      if (!t) return;
      const target = swipeTarget(getTab(), t.clientX - s.x, t.clientY - s.y, Date.now() - s.t);
      if (target) go(target, t.clientX - s.x < 0 ? 1 : -1);
    },
  };
}
