// Water tab: one row per tap. Caloric drinks (regular Monster) also add a FoodLog entry so calories stay right.
import type { Row } from '../../shared/schema';
import { readTabs, uuid, write } from './foodData';

export interface Sip { id: string; date: string; time: string; oz: number; kind: string }

/** Things you can tap. caffeine = mg per item (typical label values); kcal/carbs only for drinks that have them. */
export interface WaterKind { id: string; label: string; oz: number; note: string; caffeine?: number; kcal?: number; carbs?: number }
export const WATER_KINDS: WaterKind[] = [
  { id: 'cup', label: 'Glass', oz: 8, note: '8 oz' },
  { id: 'bottle', label: 'Bottle', oz: 16.9, note: '16.9 oz' },
  { id: 'big', label: 'Big bottle', oz: 32, note: '32 oz' },
  { id: 'sparkling', label: 'Sparkling water', oz: 12, note: '12 oz can' },
  { id: 'diet_soda', label: 'Diet soda', oz: 12, note: '12 oz · 0 kcal', caffeine: 46 },
  { id: 'coffee', label: 'Coffee', oz: 12, note: '12 oz', caffeine: 140 },
  { id: 'monster_zero', label: 'Monster Zero Ultra', oz: 16, note: '16 oz · 10 kcal', caffeine: 150, kcal: 10, carbs: 3 },
  { id: 'monster', label: 'Monster (regular)', oz: 16, note: '16 oz · 210 kcal', caffeine: 160, kcal: 210, carbs: 54 },
];
export const kindOf = (id: string) => WATER_KINDS.find((k) => k.id === id);

const rowToSip = (r: Row): Sip => ({ id: String(r.id), date: String(r.date), time: String(r.time ?? ''), oz: Number(r.oz) || 0, kind: String(r.kind ?? 'cup') });

export async function loadWater(date: string): Promise<Sip[]> {
  try {
    const d = await readTabs(['Water'], { Water: { date } });
    return (d.Water ?? []).filter((r) => !r.deleted_at && String(r.date) === date).map(rowToSip);
  } catch {
    return []; // tab not there yet (Worker not deployed)
  }
}

export async function addSip(date: string, k: WaterKind): Promise<Sip> {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const s: Sip = { id: uuid(), date, time, oz: k.oz, kind: k.id };
  await write('/sheet/append', { tab: 'Water', rows: [{ ...s }] }, `${k.label} ${k.oz} oz`);
  return s;
}

export async function deleteSip(s: Sip): Promise<void> {
  await write('/sheet/update', { tab: 'Water', rows: [{ id: s.id, deleted_at: new Date().toISOString() }] }, 'Remove water');
}

/** Goal: your setting, else half your body weight in ounces (rounded to 8, 64–128 oz). */
export function waterGoal(setting: string | undefined, weightLb: number | null | undefined): number {
  const set = Number(setting);
  if (set > 0) return set;
  if (!weightLb) return 64;
  return Math.min(128, Math.max(64, Math.round(weightLb / 2 / 8) * 8));
}
