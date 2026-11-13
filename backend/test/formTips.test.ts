import { describe, expect, it } from 'vitest';
import { formTips } from '../../shared/formTips';
import { EXERCISE_LIBRARY } from '../../shared/exerciseLibrary';
import { starterExercises } from '../../shared/training';

// Names as they come from Hevy imports and custom exercises.
const IMPORTED = [
  'Bicep Curl (Cable)', 'Seated Cable Row - Bar Wide Grip', 'Leg Raise Parallel Bars', 'Rear Delt Reverse Fly (Machine)',
  'Lateral Raise (Machine)', 'Chest Dip (Weighted)', 'Shoulder Press (Machine Plates)', 'Chest Fly (Machine)',
  'Chest Supported T Bar Row', 'Kelso Shrugs', 'Lat Pulldown - Close Grip (Cable)', 'Single Arm Triceps Pushdown (Cable)',
  'Incline Chest Press (Machine)', 'Back Extension (Machine)', 'Seated Leg Curl (Machine)', 'Pendulum Squat (Machine)',
  'Cable Core Pallof Press', 'Hip Abduction (Machine)', 'Triceps Extension (Machine)', 'Dead Bug', 'Preacher Curl (Machine)',
  'Reverse Wrist Curl (Dumbbell)', 'Crunch (Machine)', 'Calf Press (Machine)', 'Butterfly (Pec Deck)', 'Hip Adduction (Machine)',
  'Seated Incline Curl (Dumbbell)', 'Iso-Lateral Chest Press (Machine)', 'JM Press (Barbell)', 'T Bar Row', 'Reverse Fly Single Arm (Cable)',
];

const first = (n: string) => formTips(n).tips[0]!;

describe('form tips', () => {
  it('has specific tips for every built-in and imported exercise', () => {
    const names = [...EXERCISE_LIBRARY.map((e) => e.name), ...starterExercises(() => 'x').map((e) => e.name), ...IMPORTED];
    const missing = names.filter((n) => formTips(n).general);
    expect(missing).toEqual([]);
  });

  it('picks the right movement when names overlap', () => {
    expect(first('Seated Leg Curl (Machine)')).toBe(first('Leg Curl'));
    expect(first('Seated Leg Curl (Machine)')).not.toBe(first('Barbell Curl'));
    expect(first('Glute Kickback (Cable)')).not.toBe(first('Triceps Kickback (Cable)'));
    expect(first('Rear Delt Reverse Fly (Machine)')).not.toBe(first('Chest Fly (Machine)'));
    expect(first('Reverse Pec Deck (Machine)')).toBe(first('Rear Delt Fly'));
    expect(first('Romanian Deadlift')).not.toBe(first('Deadlift'));
    expect(first('Wrist Curl')).not.toBe(first('Dumbbell Curl'));
    expect(first('Nordic Curl')).not.toBe(first('Leg Curl'));
    expect(formTips('Underwater basket weaving').general).toBe(true);
  });
});
