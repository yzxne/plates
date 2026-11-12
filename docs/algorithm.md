# Algorithms and Formulas

Every formula and constant Plates uses, with its source. Code: `shared/coaching.ts` (tested in `backend/test/coaching.test.ts`).

## Coaching (Phase 5)

All constants are Settings (gear → Profile → **Advanced coaching**). Defaults marked [Assumption] should be tuned after a few weeks of real data.

| Constant | Setting key | Default |
|---|---|---|
| Trend smoothing α | `trend_alpha` | 0.1 per day [Assumption, from the brief] |
| Energy per lb of weight change | `energy_per_lb` | 2,700 kcal/lb [Assumption] |
| Expenditure window | `expenditure_window_days` | 21 days |
| Max change between check-ins | `max_target_change` | ±150 kcal/day [Assumption, from the brief] |
| Training-day extra | `training_day_shift_pct` | +10 % [Assumption] |
| Fat share | `fat_pct` | 25 % of calories, never below the fat minimum [Assumption] |
| Calorie floor | `min_calories` | 1,200 kcal/day [Assumption] |

### 1. Starting expenditure
Mifflin–St Jeor resting energy × activity multiplier:
- Men: `10·kg + 6.25·cm − 5·age + 5`; women: `… − 161`. Source: Mifflin MD, St Jeor ST et al. (1990), *Am J Clin Nutr* 51:241–247.
- Activity multipliers 1.2 / 1.375 / 1.55 / 1.725 / 1.9 — the widely used set (e.g. McArdle, Katch & Katch, *Exercise Physiology*). [Assumption] These are population averages.
- Weight = your current trend weight; kg = lb ÷ 2.2046; cm = in × 2.54.

### 2. Trend weight
Exponentially weighted moving average of daily scale weight (several weigh-ins on one day are averaged). For a gap of *g* days since the last weigh-in: `trend += (1 − (1 − α)^g) · (scale − trend)`, so missing days neither stall nor overshoot. Days without a weigh-in keep the previous trend. Starts at the first weigh-in.

### 3. Expenditure
For the window ending yesterday:
- `data = average intake on complete days − (trend slope in lb/day × energy per lb)`
- Needs ≥ 7 complete days and weigh-ins spanning ≥ 7 days; else only the prior is used. Bounded to 1,000–6,000 kcal.
- Blend: `estimate = w·data + (1 − w)·prior`, `w = min(1, complete days ÷ 14) × min(1, weigh-in days ÷ 10)`. Prior = last check-in's expenditure (or the starting estimate).
- Confidence: *low data* (w < 0.34), *settling* (< 0.8), *stable*.
- **Energy per lb:** not the old 3,500 kcal/lb rule. Hall (2008, *Int J Obes* 32:573–576, "What is the energy content of weight loss?") shows the energy density of weight change depends on the fat/lean mix and changes over time; measured values during weight loss are roughly 2,200–3,000 kcal/lb. 2,700 is a middle value. [Assumption] The same value is used for gain.
- **Known effect:** the trend lags real change for the first ~1–2 weeks, so early data estimates read low during a loss. Blending with the prior covers this; the test with synthetic data reaches the true value within 5 % by week 6.

### 4. Weekly check-in
Runs automatically on your check-in weekday (or the first time you open Plates after it), and once right away the first time.
1. Daily average target = expenditure + goal adjustment, where goal adjustment = `±rate (lb/week) × energy per lb ÷ 7` (lose −, gain +, maintain 0).
2. Limited to ±150 kcal/day from the previous check-in's average (not on the first one), and never below the calorie floor.
3. Spread over the week: training days = average × (1 + 10 %); other days share the rest so the **weekly total stays the same**. Rounded to 10 kcal.
4. Macros per day: protein = g/lb × trend weight; fat = max(fat minimum, 25 % of calories ÷ 9); carbs = what's left ÷ 4 (if there isn't room, carbs go to 0 and fat drops toward its minimum).
5. Saved to **CheckIns** with the reason in plain words. Targets for any date = the most recent check-in on or before it; they're also written to that day's **Days** row.

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

## Estimate accuracy (Phase 8 add-on, brief §6A)

Code: `shared/accuracy.ts`, tests `backend/test/accuracy.test.ts`. Shown in Progress → Estimate accuracy. **Read-only:** it never changes your data or targets; a correction is used only when you tap "Use".

1. Split history into back-to-back **28-day stretches** ending today. Keep a stretch if it has ≥ 14 complete days and ≥ 2 weigh-ins.
2. For each stretch: `logged` = average kcal on complete days; `estimated` = average kcal from estimated entries (by source: restaurant, cafeteria, homemade, other AI, Cal AI import); `storage` = trend-weight slope × energy per lb (kcal/day going into or out of body stores).
3. If the log were exact, burn = `logged − storage`. If estimated food is really `k ×` what was logged, then `logged − storage = burn − (k − 1) × estimated`.
4. **Regression** (normal case): weighted least squares of `logged − storage` on `estimated` across stretches (weights = days). Intercept = your burn; `k = 1 − slope`. Needs ≥ 3 stretches, estimated food ≤ 70 % of intake, and ≥ 150 kcal/day difference in estimated food between stretches.
5. **Formula fallback** (almost everything estimated, e.g. Cal AI history): burn = resting-rate formula × activity. `k = 1 + Σ(burn + storage − logged)·days / Σ estimated·days`. Labelled "rough".
6. Per source: same regression using only that source's kcal. Factors are clamped to 0.5–2 and rounded to 0.05.
7. Confidence: "fair" = regression with ≥ 6 stretches and ≥ 300 kcal/day spread; otherwise "rough".

**Using a correction:** Settings → Advanced → *Restaurant / Cafeteria / Homemade estimate correction* (default 1 = off). It multiplies the grams the AI suggests for that source in new estimates (shown on the review screen; still editable). Usual portions you saved are never corrected.

**Caveats:** water weight, sparse weigh-ins, unlogged snacks and days not marked complete all land in the same gap, so treat the factor as a nudge. [Assumption] 28-day stretches and the 150 kcal/day spread threshold are starting values.
