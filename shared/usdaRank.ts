// Making USDA "everyday foods" (FNDDS) results usable: tidy names, pick a real portion, and rank plain matches first.

/** "Rice, white, cooked, NS as to fat" → "Rice, white, cooked". */
export function tidyUsdaName(s: string): string {
  return s.replace(/,\s*NS as to [^,]+/gi, '').replace(/,\s*NFS\b/g, '').replace(/\s+/g, ' ').trim();
}

export interface UsdaMeasure { disseminationText?: string; gramWeight?: number }

/** A real household portion ("1 cup", "1 medium") from FNDDS measures, else its typical portion. */
export function pickPortion(measures: UsdaMeasure[] | undefined): { label: string; grams: number } | null {
  const ok = (measures ?? []).filter((m) => m.gramWeight && m.gramWeight > 0 && m.disseminationText);
  const real = ok.filter((m) => !/quantity not specified/i.test(m.disseminationText!));
  const pref = real.find((m) => /^1\s/.test(m.disseminationText!)) ?? real[0];
  if (pref) return { label: pref.disseminationText!.trim(), grams: Math.round(pref.gramWeight! * 10) / 10 };
  const typical = ok[0];
  return typical ? { label: 'typical portion', grams: Math.round(typical.gramWeight! * 10) / 10 } : null;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const PENALTY = /\b(baby|toddler|infant|formula)\b/i;

/** Higher = better. Plain foods whose first part matches the query beat dishes that merely contain it. */
export function usdaScore(name: string, query: string): number {
  const q = words(query);
  const all = words(name);
  const hit = (x: string, w: string) => x.startsWith(w) || (w.endsWith('s') && x.startsWith(w.slice(0, -1)));
  const has = (list: string[], w: string) => list.some((x) => hit(x, w));
  const matched = q.filter((w) => has(all, w)).length;
  let s = matched * 10 - (q.length - matched) * 15;
  // USDA names lead with the food itself ("Rice, white, cooked"); dishes lead with something else ("Beans and white rice").
  if (all[0] && q.some((w) => hit(all[0]!, w))) s += 8;
  // How soon all your words have appeared: "Rice, white" (2 words) beats "Beans and white rice" (4).
  let cover = all.length;
  for (let i = 0; i < all.length; i++) if (q.every((w) => all.slice(0, i + 1).some((x) => hit(x, w)))) { cover = i + 1; break; }
  if (matched === q.length) s -= (cover - q.length) * 2;
  s -= Math.max(0, all.length - q.length) * 0.6; // fewer extra words = more basic food
  if (/\b(raw|cooked|plain|no added fat)\b/i.test(name)) s += 1.5;
  if (PENALTY.test(name)) s -= 12;
  return s;
}

export function rankUsda<T extends { name: string }>(foods: T[], query: string): T[] {
  return foods.map((f, i) => ({ f, i, s: usdaScore(f.name, query) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.f);
}
