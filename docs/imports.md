# Imports and exports (Phase 7)

Settings (gear on Today) → **Import & export**. Everything is read and built on your device; the only thing sent anywhere is the rows written to your own Google Sheet after you tap **Import**.

## Supported files

Formats were checked against real exports (2026-11-11). If an app changes its export, the preview will say it doesn't recognise the file rather than guess.

### Hevy — `workout_data.csv`
Hevy app → Profile → Settings → Export & Import Data → Export Workouts.

| Hevy column | Plates |
|---|---|
| `title` + `start_time` | One workout (`Workouts`), id `hevy-<hash of start + title>` |
| `start_time`, `end_time` (`10 Nov 2026, 15:31`) | ISO times. [Assumption] Hevy times are America/Chicago local time. |
| `description` | Workout notes |
| `exercise_title` | Matched to your exercises by exact name, or by base name when the equipment in brackets matches (`Lat Pulldown (Cable)` → `Lat Pulldown`, Cable). Otherwise a new exercise with the Hevy name; muscle group and equipment are guessed from the name (edit them in Train). |
| `exercise_notes` (`\n` = new line) | Exercise note on that workout |
| `set_type` warmup / normal / failure / dropset | W / N / F / N |
| `weight_lbs`, `reps`, `rpe` | Same. Blank weight (bodyweight) stays blank. |
| `distance_miles`, `duration_seconds` | Not stored (Plates sets are weight × reps). Sets with only distance/time are skipped and counted in the preview. |
| `superset_id` | Ignored |

All imported sets are marked completed. Workouts starting within 10 minutes of one you already logged in Plates are skipped.

### Hevy — `measurement_data.csv`
`date`, `weight_lbs`, `fat_percent` → Weights (one per day). Other body measurements are ignored.

### Cal AI — "Summary Report" PDF
Cal AI → Profile/Settings → export report (PDF). Read on the device with pdf.js.

- **Weight History** table → Weights.
- Each day's **Foods** table → one FoodArchive entry per food: name, calories, protein, carbs, fat, fiber, sugar, sodium, and the time logged (kept in `notes`). Meal is set from the time using your meal-time windows.
- No gram amounts exist in the report, so entries can't be resized; you can edit their numbers or delete them.
- Days where fiber/sugar/sodium are 0 for every item (older Cal AI versions) store those as blank ("not tracked"), not 0.
- Each day's parsed foods are checked against the report's **TOTAL Calories eaten**; days that don't match are listed in the preview.
- Each imported day gets a **Days** row (totals, marked complete) so coaching and charts use it.
- Exercise rows and weekly summaries in the report are not imported.
- Days you already logged in Plates are left alone.

## Duplicates and re-running

Ids come from the source data, so importing the same file again skips everything already there (including rows you imported then deleted). If an import stops part-way (lost connection), run it again: it continues where it stopped.

## Exports

- **Excel (.xlsx)** — every tab of the Sheet (deleted rows left out), one worksheet per tab, header row frozen. Built with write-excel-file. On iPhone it opens the share sheet (Save to Files); on a computer it downloads.
- **Weekly summary (.md)** — pick a Mon–Sun week. Daily calories/macros vs target, averages, biggest calorie sources, weigh-ins and trend change, workouts with volume, sets per muscle, and that week's check-in. Has front matter (`week`, `tags`) for Obsidian.

## Backups

Google Sheets keeps version history (File → Version history). Export to Excel now and then for a copy outside Google.
