# Data Model (Google Sheet)

Source of truth: `shared/schema.ts`. Schema version **6**. v6 added `FoodLog.group_id`, `group_name` (foods combined into one named item; parts share `group_id`). v5 added `Routines.folder` (optional; rotation stays inside a folder). v4 added the **FoodArchive** tab and the `archive_through` setting (Phase 7 imports). v2 added `Workouts.name`, `Workouts.exercise_notes_json`. v3 added `Foods.favorite`; `FoodLog.food_source`, `place`, `is_estimate`; tabs **Portions** and **SavedMeals**; settings for meal windows, cafeteria and setup.

## Conventions

- One tab per entity. Row 1 = header row (frozen). Columns are matched **by header name**, not position.
- Every row has `id` (UUID v4), `created_at`, `updated_at` (ISO 8601 UTC, e.g. `2026-11-10T18:04:05.123Z`).
- "Day" fields (`date`) are calendar dates `YYYY-MM-DD` in **America/Chicago**.
- Weights in **lb**, food amounts in **g**, sodium in **mg**, energy in **kcal**.
- Values are written with `valueInputOption=RAW`: text that starts with `=` is stored as text, never as a formula.
- Deletes are **soft**: set `deleted_at`. Rows are never removed by the app (row numbers stay stable; Sheet history stays readable).
- Booleans are stored as Sheet booleans (`TRUE`/`FALSE`).
- Nested data that has no tab of its own is stored as a JSON string in a `*_json` column.

## Tabs

### Settings
Key/value pairs. `id, key, value, created_at, updated_at`. All values are text.

| key | Meaning | Default |
|---|---|---|
| sex | `male` / `female` (resting-rate formula only) | — |
| birth_date | YYYY-MM-DD | — |
| height_in | Height in inches | — |
| activity_multiplier | 1.2 – 1.9 | 1.375 |
| goal_type | `lose` / `maintain` / `gain` | maintain |
| goal_rate_lb_per_week | lb/week | 0.5 |
| protein_g_per_lb | g protein per lb body weight | 0.8 |
| fat_min_g | g/day | 50 |
| checkin_weekday | Mon–Sun | Mon |
| training_days | comma list, e.g. `Mon,Wed,Fri` | Mon,Wed,Fri |
| plate_diameter_in | AI scale reference | 10.5 |
| breakfast_window / lunch_window / dinner_window | Meal time windows (HH:MM-HH:MM); anything else is Snack | 04:00-10:59 / 11:00-15:59 / 16:00-20:59 |
| cafeteria_name | Default place for Cafeteria AI estimates | — |
| setup_complete | First-run wizard done | — |
| correction_restaurant / correction_cafeteria / correction_homemade | Optional multiplier for AI-estimated grams of that source (Progress → Estimate accuracy suggests values; never set automatically) | 1 |
| archive_through | v4: last date with imported food in FoodArchive (set by imports). Days on or before it also read FoodArchive. | — |
| ai_monthly_cap_usd | AI spend cap | 1 |
| units | read-only | lb |
| timezone | read-only | America/Chicago |
| schema_version | read-only | 1 |

### Foods
Saved/cached foods. Nutrients both per 100 g and per serving.
`id, name, brand, source (usda|off|label|ai|manual|quick), source_id, barcode, serving_size, serving_unit, grams_per_serving, kcal_100g, protein_g_100g, carbs_g_100g, fat_g_100g, fiber_g_100g, sugar_g_100g, sodium_mg_100g, kcal_serving, protein_g_serving, carbs_g_serving, fat_g_serving, fiber_g_serving, sugar_g_serving, sodium_mg_serving, created_at, updated_at, deleted_at`

### FoodLog
`id, date, meal (breakfast|lunch|dinner|snack), food_id → Foods.id, food_name (copy for readability), grams, servings, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, entry_method (search|barcode|label|ai|paste_ai|quick|manual), notes, created_at, updated_at, deleted_at, food_source, place, is_estimate, group_id, group_name`. Rows with the same `group_id` show in the app as one combined item named `group_name`; each part keeps its own numbers.

### FoodArchive (v4)
Imported food history (Cal AI). **Same columns as FoodLog.** `entry_method` starts with `import_` (e.g. `import_calai`), `food_id` and `grams` are blank (the report has totals only), ids are `calai-<hash>` so re-importing skips them. Kept out of FoodLog so everyday reads of FoodLog stay small (the Worker's free plan allows ~10 ms CPU per request; parsing ~3,500 extra rows took 7–10 ms). The app reads it only for dates ≤ `archive_through`; edits/deletes of imported entries go to this tab.

### Days
One row per date. `id, date, day_complete (bool), total_kcal, total_protein_g, total_carbs_g, total_fat_g, target_kcal, target_protein_g, target_carbs_g, target_fat_g, created_at, updated_at`. Totals are derived from FoodLog.

### Weights
`id, date, time (HH:MM, Chicago), weight_lb, body_fat_pct, notes, created_at, updated_at, deleted_at`

### Exercises
`id, name, primary_muscles (comma list), secondary_muscles, equipment, default_rest_sec, notes, created_at, updated_at, deleted_at`

### Routines
`id, name, notes, sort_order, created_at, updated_at, deleted_at`

### RoutineExercises
Ordered exercises within a routine. `id, routine_id → Routines.id, exercise_id → Exercises.id, position, rest_sec, planned_sets_json, notes, created_at, updated_at, deleted_at`

`planned_sets_json` example:
```json
[{"type":"W","weight_lb":95,"rep_min":8,"rep_max":10},{"type":"N","weight_lb":135,"rep_min":6,"rep_max":8}]
```

### Workouts
`id, routine_id (optional), date, start_time, end_time (ISO), duration_sec, notes, created_at, updated_at, deleted_at, name, exercise_notes_json`

`exercise_notes_json`: `{"<exercise_id>": "note"}` for notes written during the workout. Only checked sets are saved.

### Sets
One row per set. `id, workout_id → Workouts.id, exercise_id → Exercises.id, exercise_order, set_order, set_type (W|N|F), weight_lb, reps, rep_min, rep_max, completed (bool), rpe, note, created_at, updated_at, deleted_at`

### CheckIns
`id, date, trend_weight_lb, expenditure_kcal, confidence (low data|settling|stable), weekly_budget_kcal, day_targets_json, reason, created_at, updated_at`

### Portions (v3)
Your usual portion sizes for AI estimates (Phase 6). `id, source (restaurant|cafeteria|homemade), place, label, grams, measured (TRUE = weighed, FALSE = saved from an AI estimate), created_at, updated_at, deleted_at`

### SavedMeals (v3)
Several foods logged together with one tap. `id, name, items_json, created_at, updated_at, deleted_at`. `items_json`: `[{"food_id":"…","grams":60}]`. **Not in the brief's tab list** — added for the brief's "Saved meals" feature.

### AIUsage
`id, date, request_id, model, input_tokens, output_tokens, cost_usd, created_at, updated_at` — one row per API estimate (Paste AI is free and not logged). The backend sums `cost_usd` for the current Chicago month and refuses calls once it reaches Settings → `ai_monthly_cap_usd`.

## Changes from the brief

- **SavedMeals** tab (brief lists the feature but no tab).
- Workout rotation order = **Routines.sort_order** (reorder with ↑ ↓ on Train) rather than a separate Settings key.
- `FoodLog.food_source` is set to `packaged` automatically for barcode / Open Food Facts / USDA branded foods.

- **RoutineExercises** tab added (brief had routines' exercise lists nested in Routines). Keeps each tab flat so it maps 1:1 to database tables later.
- `deleted_at` soft-delete column on editable tabs.
- `food_name` copied into FoodLog so the sheet is readable on its own.
- **FoodArchive** tab (v4) for imported food history, separate from FoodLog for speed.
- Imported rows: Hevy workouts `hevy-<hash>` (sets `<workout id>-<exercise #>-<set #>`), weigh-ins `import-w-<date>`, Cal AI food `calai-<hash>`. Imports never touch rows they didn't create.

## Schema changes over time

The backend checks headers on setup and the first time it uses the Sheet after an app update (once per server instance). If a tab's header row is an exact **prefix** of the current schema (older version), the missing column names are added to the right — no data moves. Any other mismatch is reported, never auto-fixed.
