// Gathers what the AI coach summary needs (mostly already-cached app data) and builds it on the phone.
// No Worker route: the Worker's free plan has ~10 ms CPU per request, and the app already has these rows.
import { addDays } from '../../shared/coaching';
import { buildCoachSummary, coachSummaryText, type CoachDay, type CoachFood } from '../../shared/coachSummary';
import { rowToEntry } from '../../shared/nutrition';
import type { Row } from '../../shared/schema';
import { loadCoach } from './coachData';
import { today } from './dates';
import { readTabs } from './foodData';
import { loadSettings } from './settingsStore';
import { loadSleep } from './sleepData';
import { loadExercises, loadHistory } from './trainData';

export async function makeCoachSummary(weeks = 4): Promise<string> {
  const t = today();
  const from = addDays(t, -7 * weeks - 7); // a little extra; the builder picks exact week edges
  const foodP = readTabs(['FoodLog'], { FoodLog: { date__gte: from } }).then((d): Row[] => d.FoodLog ?? []);
  const waterP = readTabs(['Water'], { Water: { date__gte: from } }).then((d): Row[] => d.Water ?? []).catch((): Row[] => []); // tab may not exist yet
  const settings = await loadSettings();
  const coach = await loadCoach(true);
  const exercises = await loadExercises();
  const history = await loadHistory(true); // after exercises (rest times come from them)
  const sleep = await loadSleep(true);
  const food = await foodP;
  const water = await waterP;

  const days: CoachDay[] = coach.intake.map((d) => ({
    date: d.date,
    complete: d.complete,
    kcal: d.kcal,
    protein_g: coach.macros.get(d.date)?.protein_g ?? 0,
    target_kcal: coach.dayTargets.get(d.date)?.kcal ?? null,
    target_protein_g: coach.dayTargets.get(d.date)?.protein_g ?? null,
  }));
  const foodRows: CoachFood[] = food.filter((r) => !r.deleted_at).map(rowToEntry).map((e) => ({
    date: e.date, food_name: e.food_name, entry_method: e.entry_method, servings: e.servings,
    kcal: e.n.kcal ?? 0, protein_g: e.n.protein_g ?? 0, is_estimate: e.is_estimate,
  }));

  const summary = buildCoachSummary({
    today: t,
    settings,
    weights: coach.weights,
    days,
    checkins: coach.checkins,
    workouts: history,
    exerciseNames: new Map(exercises.map((e) => [e.id, e.name])),
    exerciseEquipment: new Map(exercises.map((e) => [e.id, e.equipment])),
    food: foodRows,
    sleep,
    water: water.filter((r) => !r.deleted_at).map((r) => ({ date: String(r.date), oz: Number(r.oz) || 0 })),
    weeks,
  });
  return coachSummaryText(summary);
}
