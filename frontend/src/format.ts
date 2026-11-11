import type { Food, LogEntry, Nutrients } from '../../shared/nutrition';

export const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const macroLine = (n: Nutrients) => `P ${fmt(n.protein_g)} · C ${fmt(n.carbs_g)} · F ${fmt(n.fat_g)}`;

export function amountLine(e: LogEntry): string {
  const parts: string[] = [];
  if (e.servings != null && e.grams != null) parts.push(`${fmt(e.servings, 2)} serving${e.servings === 1 ? '' : 's'}`);
  else if (e.servings != null && e.grams == null) parts.push(`${fmt(e.servings, 2)} × quick add`);
  if (e.grams != null) parts.push(`${fmt(e.grams, 1)} g`);
  return parts.join(' · ');
}

export function sourceLabel(f: Food): string {
  switch (f.source) {
    case 'usda': return 'USDA';
    case 'off': return 'Open Food Facts';
    case 'label': return 'Label';
    case 'ai': return 'AI estimate';
    case 'quick': return 'Quick add';
    default: return 'Saved';
  }
}

/** Short summary for search results: per serving when known, else per 100 g. */
export function foodSummary(f: Food): string {
  if (f.grams_per_serving) {
    const k = (f.per100.kcal * f.grams_per_serving) / 100;
    return `${fmt(k)} kcal per ${f.serving_size || `${fmt(f.grams_per_serving)} g`}`;
  }
  return `${fmt(f.per100.kcal)} kcal per 100 g`;
}
