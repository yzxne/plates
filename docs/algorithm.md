# Algorithms and Formulas

Every formula and constant Plates uses, with its source. Coaching (trend weight, expenditure, check-ins) is added in Phase 5.

## Nutrition math (Phase 2)

- Foods are stored **per 100 g**; per-serving values are derived: `value × grams ÷ 100`.
- Label values per serving → per 100 g: `value × 100 ÷ serving grams`.
- Rounding for display/storage: kcal and sodium to whole numbers, grams to 0.1.
- Missing optional nutrients (fiber, sugar, sodium) stay **blank**, never 0.
- Label sanity check: if `4·protein + 4·carbs + 9·fat` differs from listed calories by more than 25 %, Plates warns (Atwater general factors: 4/4/9 kcal per g).
- Salt → sodium (EU labels): `sodium = salt × 0.4` (sodium is ~39.3 % of salt by mass).
- kJ → kcal: `÷ 4.184`.

## Training (Phase 4)

| Quantity | Definition | Notes |
|---|---|---|
| Working set | A **completed** set whose type is Normal (N) or Failure (F) | Warm-ups (W) are excluded |
| Volume | Σ weight (lb) × reps over working sets | Bodyweight exercises with weight blank count 0 |
| Sets per muscle | Working sets counted once for **each primary muscle** of the exercise | Secondary muscles are not counted. [Assumption] Simple and transparent; can switch to fractional counting later |
| Estimated 1RM | **Epley**: `weight × (1 + reps ÷ 30)`; 1 rep = the weight itself | Epley, B. (1985). *Poundage Chart*. Less accurate above ~10 reps |
| Best set | Working set with the highest estimated 1RM | Shown per exercise and as "New best" after a workout |
| Previous | Completed sets of the most recent finished workout containing that exercise, matched by set position | Tap to copy into the current set |
| Duration | `end_time − start_time` | |

Finishing a workout keeps only **checked** sets; exercises with no checked sets are left out (you're told how many before confirming).

Rest timer: starts when a set is checked, using the exercise's rest time (routine value, else the exercise default). Based on an end timestamp, so it stays correct if the phone sleeps. Beeps via Web Audio when done (iPhone needs a tap first — checking a set counts).
