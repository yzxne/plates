// Warm-up, ramp-up sets and cool-down for each PPLUL day.
// Start: ~4–5 min easy cardio + 3–4 dynamic moves for the day's muscles, then ramp-up sets on the first big lift.
// Middle: one light ramp-up set only when a new big movement starts. End: cardio finisher + short stretches.
// Evidence (docs/algorithm.md → Warm-ups): ramp-up sets near working load help strength (Ribeiro et al. 2020);
// general warm-up adds little on its own (systematic review, 2021); static holds under 60 s per muscle barely
// affect strength (Chaabene, Behm et al. 2019), so the longer holds sit at the end.

export interface PrepItem {
  id: string;
  label: string;
  /** e.g. "×15", "4 min", "30 s each side" */
  dose: string;
  /** Hold or timed piece: tapping starts a countdown of this many seconds. */
  seconds?: number;
}

/** Ramp-up sets as % of the first working weight. */
export type Ramp = { pct: number; reps: number }[];
export const RAMP_3: Ramp = [{ pct: 0.5, reps: 8 }, { pct: 0.7, reps: 4 }, { pct: 0.85, reps: 2 }];
export const RAMP_2: Ramp = [{ pct: 0.5, reps: 8 }, { pct: 0.75, reps: 3 }];
export const RAMP_1: Ramp = [{ pct: 0.6, reps: 5 }];

export interface DayPrep {
  warm: PrepItem[];
  cool: PrepItem[];
  /** Exercise-name patterns that get ramp-up sets (first match wins). */
  ramps: { match: RegExp; ramp: Ramp }[];
}

const bike = (min: number): PrepItem => ({ id: 'cardio', label: 'Easy bike or incline walk', dose: `${min} min`, seconds: min * 60 });
const rower = (min: number): PrepItem => ({ id: 'cardio', label: 'Easy rower or bike', dose: `${min} min`, seconds: min * 60 });
const pullAparts: PrepItem = { id: 'pull-aparts', label: 'Band pull-aparts', dose: '×15' };
const scapPush: PrepItem = { id: 'scap-push', label: 'Scap push-ups', dose: '×10' };
const deadHang = (s: number): PrepItem => ({ id: 'hang', label: 'Dead hang', dose: `${s} s`, seconds: s });
const doorChest: PrepItem = { id: 'door-chest', label: 'Doorway chest stretch', dose: '30 s each side', seconds: 60 };
const couch: PrepItem = { id: 'couch', label: 'Couch stretch (hip flexor/quad)', dose: '45 s each side', seconds: 90 };

export const PREP: Record<'push' | 'pull' | 'legs' | 'upper' | 'lower', DayPrep> = {
  push: {
    warm: [bike(4), pullAparts, scapPush, { id: 'wall-slides', label: 'Wall slides', dose: '×10' }],
    cool: [doorChest, { id: 'oh-triceps', label: 'Overhead triceps stretch', dose: '30 s each side', seconds: 60 }],
    ramps: [{ match: /bench press/i, ramp: RAMP_3 }, { match: /shoulder press|overhead press/i, ramp: RAMP_1 }],
  },
  pull: {
    warm: [rower(4), pullAparts, deadHang(25), { id: 'cat-cow', label: 'Cat-cow', dose: '×8' }],
    cool: [deadHang(30), { id: 'lat-stretch', label: 'Lat stretch (hold a rack, sit back)', dose: '30 s each side', seconds: 60 }],
    ramps: [{ match: /pulldown|pull-up/i, ramp: RAMP_2 }],
  },
  legs: {
    warm: [
      bike(5),
      { id: 'leg-swings', label: 'Leg swings, front-back and side-side', dose: '×10 each way' },
      { id: 'pause-squat', label: 'Bodyweight squats, 2 s pause at the bottom', dose: '×10' },
      { id: 'lunge-reach', label: 'Lunge with overhead reach', dose: '×5 each leg' },
      { id: 'ankle-rocks', label: 'Ankle rocks (knee over toes)', dose: '×10 each side' },
    ],
    cool: [couch, { id: '90-90', label: '90/90 hip stretch', dose: '45 s each side', seconds: 90 },
      { id: 'calf-stretch', label: 'Calf stretch on a step', dose: '45 s each side', seconds: 90 }],
    ramps: [{ match: /pendulum|squat/i, ramp: RAMP_3 }],
  },
  upper: {
    warm: [rower(4), pullAparts, scapPush, { id: 'arm-circles', label: 'Arm circles', dose: '×10 each way' }],
    cool: [doorChest, deadHang(30)],
    ramps: [{ match: /incline.*press|chest press|bench/i, ramp: RAMP_2 }, { match: /pulldown/i, ramp: RAMP_1 }],
  },
  lower: {
    warm: [
      bike(5),
      { id: 'leg-swings', label: 'Leg swings, front-back and side-side', dose: '×10 each way' },
      { id: 'goblet-hold', label: 'Goblet squat hold at the bottom', dose: '30 s', seconds: 30 },
      { id: 'bridges', label: 'Glute bridges', dose: '×10' },
    ],
    cool: [couch, { id: 'ham-stretch', label: 'Hamstring stretch', dose: '45 s each side', seconds: 90 },
      { id: 'childs-pose', label: "Child's pose", dose: '45 s', seconds: 45 }],
    ramps: [{ match: /squat/i, ramp: RAMP_3 }, { match: /hip thrust/i, ramp: RAMP_1 }],
  },
};

/** Which day's plan fits a workout name ("Pull", "Tuesday - Pull (PPL x UL)", "Thursday Upper"). */
export function prepFor(workoutName: string): DayPrep | null {
  const n = workoutName.toLowerCase();
  if (/\bupper\b/.test(n)) return PREP.upper;
  if (/\blower\b/.test(n)) return PREP.lower;
  if (/\blegs?\b/.test(n)) return PREP.legs;
  if (/\bpull\b/.test(n)) return PREP.pull;
  if (/\bpush\b/.test(n)) return PREP.push;
  return null;
}

/** Ramp-up sets for an exercise in this plan (only the first exercise matching each pattern gets them). */
export function rampFor(plan: DayPrep, names: string[], index: number): Ramp | null {
  for (const r of plan.ramps) {
    const first = names.findIndex((n) => r.match.test(n));
    if (first === index) return r.ramp;
  }
  return null;
}

/** Round to a loadable weight: 5 lb steps (2.5 under 50 lb). */
export function rampWeight(working: number, pct: number): number {
  const step = working < 50 ? 2.5 : 5;
  return Math.max(step, Math.round((working * pct) / step) * step);
}
