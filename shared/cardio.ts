// Cardio finisher suggested at the bottom of each workout: what, how long, roughly how many calories, and a reason.
// Calories use METs: kcal/min = MET × 3.5 × kg / 200 (standard ACSM equation). MET values are typical, not exact.

export interface CardioPick { title: string; minutes: number; how: string; met: number; why: string }

const LEGS = new Set(['Quads', 'Hamstrings', 'Glutes', 'Calves']);

const UPPER: CardioPick[] = [
  { title: 'Incline walk', minutes: 20, how: '3.0 mph at 8–10% incline', met: 6, why: 'Burns about as much as a slow jog with almost no pounding on your knees.' },
  { title: 'Easy bike', minutes: 20, how: 'Steady pace where you can still talk', met: 5.5, why: 'Zone 2 pace: builds your engine without eating into tomorrow’s lift.' },
  { title: 'Rower', minutes: 12, how: 'Moderate, about 22 strokes a minute', met: 7, why: 'Short and full-body; finishes the day in under 15 minutes.' },
  { title: 'Stair climber', minutes: 12, how: 'Slow, steady steps, hands off the rails', met: 8.5, why: 'Highest burn per minute here, so the shortest session.' },
];
const LEG_DAY: CardioPick[] = [
  { title: 'Easy bike', minutes: 10, how: 'Light resistance, spin easy', met: 4.5, why: 'Legs are tired, so keep it light: it moves blood through them and may ease soreness tomorrow.' },
  { title: 'Flat walk', minutes: 15, how: '3.0 mph, no incline', met: 3.5, why: 'Low effort after leg day; still adds steps and calories.' },
];

export const CARDIO_FACTS = [
  'Working muscles pull sugar out of your blood on their own, without extra insulin. A walk after lifting or eating helps.',
  'In a large Cleveland Clinic study, people with the lowest cardio fitness had a higher risk of death than smokers did.',
  'Easy cardio barely affects strength gains. The interference people worry about mostly comes from long, hard running.',
  'Zone 2 cardio makes your muscles build more mitochondria, which helps you recover faster between sets.',
  'A 20-minute walk is about 2,000 steps: an easy way to close a step gap without thinking about it.',
  'Cardio on lifting days keeps rest days actually restful, which helps recovery.',
  'Burning 150 kcal a day adds up to about a pound of fat every 3 weeks without eating any less.',
  'Your resting heart rate usually drops a few beats within weeks of regular easy cardio, a sign your heart pumps more per beat.',
];

/** Today's suggestion: lighter after leg-heavy workouts; otherwise it rotates through the week so it isn't the same every day. */
export function cardioFor(primaryMuscles: string[], date: string): CardioPick {
  const legSets = primaryMuscles.filter((m) => LEGS.has(m)).length;
  const legDay = primaryMuscles.length > 0 && legSets / primaryMuscles.length >= 0.5;
  const day = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 86400000);
  const pool = legDay ? LEG_DAY : UPPER;
  return pool[day % pool.length]!;
}

export const cardioKcal = (p: CardioPick, weightLb: number) => Math.round((p.met * 3.5 * (weightLb / 2.2046226218)) / 200 * p.minutes);

export function cardioFact(date: string): string {
  const day = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 86400000);
  return CARDIO_FACTS[day % CARDIO_FACTS.length]!;
}
