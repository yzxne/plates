// Built-in exercise library (generic names, our own list). Shown in exercise search; an exercise is only written to
// your Sheet when you pick it. Format: name | equipment | main muscle | also works | default rest (sec).
import type { Exercise } from './training';

const L = `
Bench Press (Dumbbell)|Dumbbell|Chest|Triceps, Shoulders|120
Bench Press (Smith Machine)|Machine|Chest|Triceps, Shoulders|120
Incline Bench Press (Smith Machine)|Machine|Chest|Shoulders, Triceps|120
Decline Bench Press (Barbell)|Barbell|Chest|Triceps|120
Decline Bench Press (Dumbbell)|Dumbbell|Chest|Triceps|120
Close Grip Bench Press (Barbell)|Barbell|Triceps|Chest|120
Floor Press (Barbell)|Barbell|Chest|Triceps|120
Decline Chest Press (Machine)|Machine|Chest|Triceps|90
Chest Fly (Dumbbell)|Dumbbell|Chest|Shoulders|75
Incline Chest Fly (Dumbbell)|Dumbbell|Chest|Shoulders|75
Cable Crossover|Cable|Chest|Shoulders|75
Low to High Cable Fly|Cable|Chest|Shoulders|75
High to Low Cable Fly|Cable|Chest|Shoulders|75
Push-up (Weighted)|Bodyweight|Chest|Triceps, Shoulders|90
Incline Push-up|Bodyweight|Chest|Triceps|60
Diamond Push-up|Bodyweight|Triceps|Chest|60
Pullover (Dumbbell)|Dumbbell|Lats|Chest|75
Pullover (Cable)|Cable|Lats|Chest|75
Pull-up (Weighted)|Bodyweight|Lats|Biceps, Back|120
Pull-up (Assisted)|Machine|Lats|Biceps|90
Chin-up (Weighted)|Bodyweight|Lats|Biceps|120
Lat Pulldown - Wide Grip (Cable)|Cable|Lats|Biceps, Back|90
Lat Pulldown - Underhand (Cable)|Cable|Lats|Biceps|90
Single Arm Lat Pulldown (Cable)|Cable|Lats|Biceps|75
Lat Pulldown (Machine)|Machine|Lats|Biceps, Back|90
Straight Arm Pulldown (Cable)|Cable|Lats|Back|75
Pendlay Row (Barbell)|Barbell|Back|Lats, Biceps|120
Bent Over Row (Dumbbell)|Dumbbell|Back|Lats, Biceps|90
Seal Row (Barbell)|Barbell|Back|Lats|90
Chest Supported Row (Machine)|Machine|Back|Lats, Biceps|90
Iso-Lateral Row (Machine)|Machine|Back|Lats, Biceps|90
Low Row (Machine)|Machine|Back|Lats|90
High Row (Machine)|Machine|Lats|Back|90
Meadows Row|Barbell|Back|Lats|90
Inverted Row|Bodyweight|Back|Biceps|90
Rack Pull (Barbell)|Barbell|Back|Traps, Glutes|150
Deadlift (Trap Bar)|Barbell|Glutes|Hamstrings, Back, Quads|180
Sumo Deadlift (Barbell)|Barbell|Glutes|Hamstrings, Quads, Back|180
Good Morning (Barbell)|Barbell|Hamstrings|Back, Glutes|120
Back Extension (Bodyweight)|Bodyweight|Back|Glutes, Hamstrings|75
Seated Overhead Press (Barbell)|Barbell|Shoulders|Triceps|120
Shoulder Press (Smith Machine)|Machine|Shoulders|Triceps|120
Arnold Press (Dumbbell)|Dumbbell|Shoulders|Triceps|90
Push Press (Barbell)|Barbell|Shoulders|Triceps, Quads|150
Landmine Press|Barbell|Shoulders|Chest, Triceps|90
Single Arm Lateral Raise (Cable)|Cable|Shoulders||60
Front Raise (Dumbbell)|Dumbbell|Shoulders||60
Front Raise (Cable)|Cable|Shoulders||60
Front Raise (Plate)|Other|Shoulders||60
Reverse Pec Deck (Machine)|Machine|Shoulders|Back|60
Upright Row (Barbell)|Barbell|Shoulders|Traps|90
Upright Row (Cable)|Cable|Shoulders|Traps|75
Y-Raise (Dumbbell)|Dumbbell|Shoulders|Traps|60
Shrug (Barbell)|Barbell|Traps||60
Shrug (Smith Machine)|Machine|Traps||60
Farmer's Carry|Dumbbell|Forearms|Traps, Abs|90
EZ Bar Curl|Barbell|Biceps|Forearms|75
Preacher Curl (EZ Bar)|Barbell|Biceps||75
Concentration Curl (Dumbbell)|Dumbbell|Biceps||60
Spider Curl (Dumbbell)|Dumbbell|Biceps||60
Hammer Curl (Cable)|Cable|Biceps|Forearms|60
Cable Curl (Bar)|Cable|Biceps|Forearms|60
Bayesian Curl (Cable)|Cable|Biceps||60
Reverse Curl (EZ Bar)|Barbell|Forearms|Biceps|60
Drag Curl (Barbell)|Barbell|Biceps||60
Zottman Curl (Dumbbell)|Dumbbell|Biceps|Forearms|60
Triceps Pushdown (Rope)|Cable|Triceps||60
Triceps Pushdown (Bar)|Cable|Triceps||60
Overhead Triceps Extension (Dumbbell)|Dumbbell|Triceps||60
Skull Crusher (EZ Bar)|Barbell|Triceps||75
Skull Crusher (Dumbbell)|Dumbbell|Triceps||75
Triceps Kickback (Dumbbell)|Dumbbell|Triceps||60
Triceps Kickback (Cable)|Cable|Triceps||60
Cross Body Triceps Extension (Cable)|Cable|Triceps||60
Bench Dip|Bodyweight|Triceps|Chest|60
Triceps Dip (Machine)|Machine|Triceps|Chest|75
Hack Squat (Machine)|Machine|Quads|Glutes|150
Goblet Squat (Dumbbell)|Dumbbell|Quads|Glutes|90
Box Squat (Barbell)|Barbell|Quads|Glutes, Hamstrings|150
Belt Squat (Machine)|Machine|Quads|Glutes|120
Single Leg Press (Machine)|Machine|Quads|Glutes|90
Sissy Squat|Bodyweight|Quads||60
Lunge (Dumbbell)|Dumbbell|Quads|Glutes|90
Reverse Lunge (Dumbbell)|Dumbbell|Quads|Glutes|90
Lunge (Barbell)|Barbell|Quads|Glutes|90
Split Squat (Smith Machine)|Machine|Quads|Glutes|90
Step-up (Dumbbell)|Dumbbell|Quads|Glutes|75
Single Leg Extension (Machine)|Machine|Quads||60
Lying Leg Curl (Machine)|Machine|Hamstrings||75
Standing Leg Curl (Machine)|Machine|Hamstrings||60
Romanian Deadlift (Dumbbell)|Dumbbell|Hamstrings|Glutes, Back|120
Single Leg Romanian Deadlift (Dumbbell)|Dumbbell|Hamstrings|Glutes|90
Stiff Leg Deadlift (Barbell)|Barbell|Hamstrings|Glutes, Back|120
Nordic Curl|Bodyweight|Hamstrings||90
Glute Ham Raise|Bodyweight|Hamstrings|Glutes|90
Hip Thrust (Machine)|Machine|Glutes|Hamstrings|90
Hip Thrust (Smith Machine)|Machine|Glutes|Hamstrings|90
Glute Bridge (Barbell)|Barbell|Glutes|Hamstrings|90
Glute Kickback (Cable)|Cable|Glutes||60
Glute Kickback (Machine)|Machine|Glutes||60
Calf Raise (Smith Machine)|Machine|Calves||60
Single Leg Calf Raise (Dumbbell)|Dumbbell|Calves||60
Donkey Calf Raise (Machine)|Machine|Calves||60
Crunch|Bodyweight|Abs||45
Decline Crunch|Bodyweight|Abs||45
Ab Wheel Rollout|Other|Abs||60
Hanging Knee Raise|Bodyweight|Abs||60
Lying Leg Raise|Bodyweight|Abs||45
Russian Twist|Bodyweight|Abs||45
Side Plank|Bodyweight|Abs||45
Cable Woodchop|Cable|Abs||60
Bicycle Crunch|Bodyweight|Abs||45
Sit-up (Weighted)|Bodyweight|Abs||60
Hollow Hold|Bodyweight|Abs||45
Wrist Curl (Barbell)|Barbell|Forearms||45
Dead Hang|Bodyweight|Forearms|Lats|60
Plate Pinch|Other|Forearms||60
Power Clean (Barbell)|Barbell|Full body|Glutes, Hamstrings, Traps|180
Thruster (Barbell)|Barbell|Full body|Quads, Shoulders|150
Kettlebell Goblet Squat|Kettlebell|Quads|Glutes|90
Kettlebell Press|Kettlebell|Shoulders|Triceps|90
Sled Push|Other|Quads|Glutes, Calves|120
`;

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Library entries (no ids yet — one is made when you pick it). */
export const EXERCISE_LIBRARY: Omit<Exercise, 'id'>[] = L.trim().split('\n').map((line) => {
  const [name, equipment, primary, secondary, rest] = line.split('|');
  return { name: name!.trim(), equipment: equipment!.trim(), primary: list(primary!), secondary: list(secondary ?? ''), rest_sec: Number(rest) || 90, notes: '' };
});
