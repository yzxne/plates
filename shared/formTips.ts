// Short form cues per movement pattern, written for Plates (standard coaching cues, not copied from any source).
// Matched by exercise name, most specific pattern first, so "Incline Chest Press (Machine)" and
// "Seated Cable Row - V Grip" both find tips. Falls back to a general cue for the main muscle.

type Rule = [pattern: RegExp, tips: string[]];

const RULES: Rule[] = [
  // ---- Rear delts (before "fly" / "pec deck") ----
  [/rear delt|reverse fly|reverse pec/i, [
    'Slight bend in the elbows; lead with the back of the hands.',
    'Move the arms out to the sides, not back toward the spine.',
    'Light weight, slow tempo; stop when your arms are in line with your body.',
  ]],

  // ---- Chest ----
  [/pec deck|butterfly|fly|crossover/i, [
    'Keep a slight, fixed bend in the elbows; the shoulders do the moving, not the elbows.',
    'Bring the hands together in a hugging arc and squeeze the chest for a beat.',
    'Stop the stretch where your shoulders still feel stable; don\'t let the arms drop behind you.',
  ]],
  [/pullover/i, [
    'Keep elbows slightly bent and fixed; move only at the shoulders.',
    'Lower until you feel a stretch in the lats and chest, ribs staying down.',
    'Pull back over the chest under control; don\'t turn it into a triceps extension.',
  ]],
  [/close grip bench|jm press/i, [
    'Hands about shoulder-width; elbows stay tucked close to your sides.',
    'Lower to the lower chest (JM press: toward the chin with elbows forward) under control.',
    'Press by straightening the elbows; keep wrists stacked over the elbows.',
  ]],
  [/floor press/i, [
    'Lie with knees bent, shoulder blades pinched together.',
    'Lower until the upper arms touch the floor softly, then pause.',
    'Press straight up, elbows about 45° from your body.',
  ]],
  [/incline.*(press|bench)|landmine press/i, [
    'Bench at about 30°; higher turns it into a shoulder press.',
    'Shoulder blades back and down, slight arch, feet planted.',
    'Lower to the upper chest with elbows ~45° from the body, then press up and slightly back.',
  ]],
  [/decline.*(press|bench)/i, [
    'Lock your legs in and keep shoulder blades pinched back.',
    'Lower to the lower chest with control; elbows ~45° from the body.',
    'Press up over the shoulders without bouncing off the chest.',
  ]],
  [/bench press|chest press|iso.?lateral chest/i, [
    'Shoulder blades squeezed back and down, slight arch, feet flat and pushing into the floor.',
    'Lower with control to mid-chest; elbows about 45° from your body, not flared straight out.',
    'Press up and slightly back over the shoulders; keep wrists stacked over elbows.',
  ]],
  [/push.?up/i, [
    'Body in one straight line: squeeze glutes and brace abs.',
    'Hands just outside shoulders; elbows angle back about 45°.',
    'Lower until your chest nearly touches the floor, then push the floor away.',
  ]],
  [/bench dip/i, [
    'Hands on the bench beside your hips, shoulders back and down.',
    'Lower until upper arms are about parallel to the floor; don\'t sink deeper if shoulders complain.',
    'Press up by straightening the elbows, keeping your back close to the bench.',
  ]],
  [/dip/i, [
    'Start tall with shoulders pushed down away from the ears.',
    'Lean forward slightly for chest, stay upright for triceps.',
    'Lower until upper arms are about parallel to the floor, then press up without swinging.',
  ]],

  // ---- Back ----
  [/rack pull/i, [
    'Bar starts at or just below the knee; set your back flat before pulling.',
    'Drive hips forward to stand tall; don\'t lean back at the top.',
    'Lower under control to the pins, keeping the bar against your legs.',
  ]],
  [/romanian|rdl|stiff leg|good morning/i, [
    'Soft knees, then push your hips straight back like closing a car door with your butt.',
    'Keep the back flat and the weight close to your legs the whole way.',
    'Go down until you feel a strong hamstring stretch (usually mid-shin), then drive hips forward to stand.',
  ]],
  [/deadlift/i, [
    'Bar over mid-foot, shins close; grip just outside the legs.',
    'Brace hard, pull the slack out of the bar, back flat, then push the floor away.',
    'Keep the bar against your legs; finish standing tall with glutes, not by leaning back.',
  ]],
  [/back extension|glute ham/i, [
    'Hinge at the hips with a neutral spine; don\'t round to get lower.',
    'Rise until your body is in a straight line; don\'t hyperextend at the top.',
    'Squeeze glutes and hamstrings to lift, slow on the way down.',
  ]],
  [/pull.?up|chin.?up/i, [
    'Start from a full hang, then pull shoulder blades down before bending the arms.',
    'Drive elbows toward your ribs and get your chin over the bar.',
    'Lower all the way under control; no kipping or swinging.',
  ]],
  [/straight arm pulldown/i, [
    'Slight bend in the elbows that stays fixed; hinge forward a little.',
    'Sweep the bar down to your thighs by pulling with the lats.',
    'Let it rise slowly until you feel the lats stretch.',
  ]],
  [/pulldown/i, [
    'Thighs locked under the pad, chest up, slight lean back.',
    'Pull elbows down toward your ribs, bringing the bar to the upper chest.',
    'Control it back up to a full stretch; don\'t yank with your body.',
  ]],
  [/upright row/i, [
    'Grip about shoulder-width or wider to keep shoulders happy.',
    'Lead with the elbows and lift to about chest height, not chin.',
    'Lower slowly; stop short if you feel pinching in the shoulder.',
  ]],
  [/inverted row/i, [
    'Body straight from heels to head, glutes squeezed.',
    'Pull your chest to the bar, squeezing shoulder blades together.',
    'Lower to straight arms with control.',
  ]],
  [/row/i, [
    'Brace with a flat back (or chest on the pad); don\'t let your torso swing.',
    'Pull elbows back toward your hips and squeeze the shoulder blades together.',
    'Let the weight go forward to a full stretch before the next rep.',
  ]],
  [/face pull/i, [
    'Rope at about face height, use an overhand grip with thumbs pointing back.',
    'Pull toward your forehead while spreading the rope apart, elbows high.',
    'Finish with hands beside your ears, squeeze the upper back, return slowly.',
  ]],
  [/shrug/i, [
    'Stand tall, arms straight; weight hangs at your sides or in front.',
    'Lift shoulders straight up toward the ears and hold a beat.',
    'Lower all the way; don\'t roll the shoulders.',
  ]],

  // ---- Shoulders ----
  [/lateral raise|y.?raise/i, [
    'Slight bend in the elbows, lean a touch forward.',
    'Raise out to the sides to shoulder height, leading with the elbows.',
    'Lower slowly; keep traps relaxed and don\'t swing.',
  ]],
  [/front raise/i, [
    'Stand tall with abs braced; slight bend in the elbows.',
    'Raise to about eye level in front of you without leaning back.',
    'Lower with control.',
  ]],
  [/arnold press/i, [
    'Start with palms facing you at chin height.',
    'Rotate palms forward as you press overhead.',
    'Reverse the rotation on the way down; keep the ribs down.',
  ]],
  [/push press|thruster/i, [
    'Dip a few inches at the knees with torso upright.',
    'Drive hard with the legs and use that momentum to press the bar overhead.',
    'Finish with the bar over mid-foot, head through the arms.',
  ]],
  [/overhead press|shoulder press|military|kettlebell press/i, [
    'Brace abs and squeeze glutes so your lower back doesn\'t arch.',
    'Press straight up, moving your head back slightly to let the bar pass.',
    'Lock out with the weight over your mid-foot, then lower to about chin level.',
  ]],

  // ---- Arms ----
  [/^(?!.*(leg|nordic|wrist)).*hammer curl/i, [
    'Palms face each other the whole time.',
    'Keep elbows pinned at your sides; curl without swinging.',
    'Lower slowly to straight arms.',
  ]],
  [/reverse curl|zottman/i, [
    'Overhand grip (Zottman: curl palms up, lower palms down).',
    'Elbows stay at your sides; wrists stay straight.',
    'Use lighter weight than normal curls and control the lowering.',
  ]],
  [/preacher|spider|concentration/i, [
    'Arm braced against the pad or thigh so the shoulder can\'t help.',
    'Curl up and squeeze; don\'t lift your elbow off the pad.',
    'Lower almost to straight, slowly; the bottom is where people get hurt.',
  ]],
  [/^(?!.*(leg|nordic|wrist)).*curl/i, [
    'Elbows stay pinned at your sides; only the forearms move.',
    'Curl up and squeeze the biceps without leaning back.',
    'Lower slowly to fully straight arms each rep.',
  ]],
  [/pushdown/i, [
    'Elbows tucked at your sides and stay there.',
    'Push down until arms are fully straight; spread the rope at the bottom.',
    'Let it come up only until forearms pass parallel, then repeat.',
  ]],
  [/skull crusher/i, [
    'Upper arms point straight up (or slightly back) and stay still.',
    'Lower the weight toward your forehead or just behind your head by bending the elbows.',
    'Extend back up; keep elbows from flaring wide.',
  ]],
  [/tricep.*kickback/i, [
    'Hinge forward, upper arm tight against your side and parallel to the floor.',
    'Straighten the elbow fully and squeeze the triceps.',
    'Only the forearm moves; use a light weight.',
  ]],
  [/triceps|tricep/i, [
    'Keep upper arms still; only the elbows bend.',
    'Get a full stretch at the bottom and fully straighten at the top.',
    'Keep the ribs down so your lower back doesn\'t arch.',
  ]],
  [/wrist curl/i, [
    'Forearms rest on your thighs or a bench, wrists just past the edge.',
    'Move only at the wrist through the full range.',
    'Slow and controlled; light weight, higher reps.',
  ]],
  [/farmer|dead hang|plate pinch/i, [
    'Stand or hang tall with shoulders pulled down and back.',
    'Grip as hard as you can; don\'t let the shoulders shrug up.',
    'Breathe steadily and brace your abs.',
  ]],

  // ---- Legs ----
  [/leg press/i, [
    'Feet about shoulder-width in the middle of the platform.',
    'Lower until knees are near 90° or as deep as you can without your lower back lifting off the pad.',
    'Push through the whole foot; don\'t lock the knees hard at the top.',
  ]],
  [/hack squat|pendulum|belt squat|sissy/i, [
    'Back flat against the pad, feet planted, knees tracking over the toes.',
    'Sink as deep as you can control while heels stay down.',
    'Drive up through mid-foot without slamming into lockout.',
  ]],
  [/split squat|lunge|step.?up/i, [
    'Torso tall; most of the weight on the front foot.',
    'Lower straight down until the back knee nearly touches the floor.',
    'Push through the front heel to stand; knee tracks over the toes.',
  ]],
  [/squat/i, [
    'Feet about shoulder-width, toes slightly out; brace your abs before each rep.',
    'Sit down between your hips with knees following the toes; keep heels down.',
    'Go as deep as you can with a neutral back, then drive up, chest and hips rising together.',
  ]],
  [/leg extension/i, [
    'Line your knee up with the machine\'s pivot point; back against the pad.',
    'Straighten your legs fully and squeeze the quads for a beat.',
    'Lower slowly; don\'t let the weight stack slam.',
  ]],
  [/nordic/i, [
    'Knees padded, ankles locked in; body straight from knees to head.',
    'Lower forward as slowly as you can using your hamstrings.',
    'Catch yourself with your hands and push back up; use a band if needed.',
  ]],
  [/leg curl/i, [
    'Line your knee up with the pivot; hips stay pressed into the pad.',
    'Curl all the way and squeeze the hamstrings.',
    'Lower slowly to almost straight.',
  ]],
  [/hip thrust|glute bridge/i, [
    'Upper back on the bench (or floor for bridges), feet flat about hip-width.',
    'Tuck your chin and ribs, then drive through the heels until hips are fully extended.',
    'Squeeze the glutes hard at the top; don\'t arch the lower back.',
  ]],
  [/kickback|abduction/i, [
    'Brace your abs and keep the hips square.',
    'Move from the hip and squeeze the glute at the end of the range.',
    'Control the return; no swinging.',
  ]],
  [/adduction/i, [
    'Sit tall with your back against the pad.',
    'Squeeze the legs together and hold a beat.',
    'Open slowly to a comfortable stretch.',
  ]],
  [/calf/i, [
    'Balls of the feet on the edge; let heels drop for a full stretch.',
    'Pause at the bottom to kill the bounce, then rise as high as you can.',
    'Squeeze at the top for a second; knees stay still.',
  ]],
  [/swing/i, [
    'Hinge at the hips, not a squat; back flat.',
    'Snap the hips forward to float the bell to chest height; arms just guide it.',
    'Stand tall at the top with glutes squeezed.',
  ]],
  [/clean/i, [
    'Start like a deadlift: back flat, bar close.',
    'Explode by extending hips and knees, then pull yourself under the bar.',
    'Catch on your shoulders with elbows high; learn it light.',
  ]],
  [/sled/i, [
    'Lean in with arms straight and body in a line.',
    'Drive with short, powerful steps through the balls of your feet.',
    'Keep the hips low and back flat.',
  ]],

  // ---- Core ----
  [/side plank/i, [
    'Elbow under the shoulder, body in a straight line.',
    'Push the hips up and keep them from sagging.',
    'Breathe steadily.',
  ]],
  [/plank|hollow/i, [
    'Body in a straight line; squeeze glutes and tuck the ribs down.',
    'Press the floor away and don\'t let the hips sag.',
    'Breathe steadily; stop when the form breaks.',
  ]],
  [/leg raise|knee raise/i, [
    'Start still; no swinging.',
    'Curl your pelvis up as you raise the legs, rather than just lifting from the hips.',
    'Lower slowly with control.',
  ]],
  [/rollout/i, [
    'Start on your knees with abs braced and ribs tucked.',
    'Roll out only as far as you can without your lower back arching.',
    'Pull back with the abs, not the hips.',
  ]],
  [/pallof|woodchop|twist/i, [
    'Brace your abs and keep your hips square.',
    'Resist the rotation (Pallof) or rotate through the upper back (woodchop and twist).',
    'Move slowly; don\'t let the weight pull you around.',
  ]],
  [/dead bug/i, [
    'Lower back pressed into the floor the whole time.',
    'Slowly extend the opposite arm and leg without letting your back arch.',
    'Breathe out as you extend; return and switch sides.',
  ]],
  [/crunch|sit.?up/i, [
    'Curl your ribs toward your hips; think about rounding the spine, not pulling the neck.',
    'Exhale and squeeze at the top.',
    'Lower slowly.',
  ]],
];

const FALLBACK: Record<string, string[]> = {
  default: [
    'Use a weight you can control for every rep, through a full range of motion.',
    'Brace your abs before each rep and keep a neutral spine.',
    'Lower the weight slower than you lift it.',
  ],
};

/** Form cues for an exercise name. `general` is true when no specific pattern matched. */
export function formTips(name: string): { tips: string[]; general: boolean } {
  const hit = RULES.find(([re]) => re.test(name));
  return hit ? { tips: hit[1], general: false } : { tips: FALLBACK.default!, general: true };
}
