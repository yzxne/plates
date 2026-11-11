# Brief v2 (2026-11-11) — Impact on Finished Work

Compared `PLATES_DEV_PROMPT_2.md` + `PLATES_CHANGES.md` against what's built (Phases 0–4).
Nothing already built is wasted: the backend, Sheet, search, barcode, label parser, logger and math all stay. Most changes are **layout and shortcuts** on top.

## Phase 0 — new items to verify

| Item | Status |
|---|---|
| Charting library (Chart.js vs uPlot) — size, license, iPhone performance | To check. I built small custom SVG charts (0 KB library). I'll compare and recommend. |
| Web push for Home Screen apps on current iOS (optional reminders) | To check |
| US chain calorie-posting rule (Restaurant source) | To check (Phase 6 use) |
| Text-estimate cost on Haiku 5.5 | To compute (Phase 6 use) |
| `user-scalable=no` ignored by iOS; `overscroll-behavior` on iOS; Home Screen full-screen tags | To check |

## Phase 1 — needs rework

| Change | Now | Needed |
|---|---|---|
| Navigation | Dashboard · Food Log · + · Train · More | **Today · Progress · + · Train**; Settings behind a **gear on Today** |
| First-run setup wizard | none | New: profile, current weight, goals, training days, meal windows, cafeteria, plate size |
| Settings keys | — | Add: cafeteria name, meal time windows, workout rotation order |
| Native-app feel | Safe areas, 16 px inputs (mostly), Home Screen tags done | Add `touch-action: manipulation`, no callouts/selection on controls, overscroll control; fix two 15 px inputs |

## Phase 2 — needs rework (biggest)

| Change | Now | Needed |
|---|---|---|
| Add screen | Menu → Search / Paste label / Quick add | **One screen**: search bar with camera, barcode, AI buttons; **Recent + Favorites** before typing |
| Re-log | Open food → amount → Log | **One tap** logs with last-used amount + **Undo** banner; long-press to change amount |
| Meal choice | Guess by fixed hours | **Time windows from Settings** (defaults 4:00–10:59 / 11:00–15:59 / 16:00–20:59), meal chip to change |
| Today log | Tap to edit | **Swipe left = delete with Undo**, swipe right/tap = edit |
| Per meal | — | **Copy from yesterday**, **Log saved meal** |
| Saved meals | — | New (needs a new **SavedMeals** tab — not in the brief's tab list; I'll propose its columns) |
| Favorites | — | New (adds a `favorite` column to Foods) |
| FoodLog columns | — | Add `food_source`, `place`, `is_estimate` |
| Portions tab | — | New tab (used in Phase 6) |
| Today screen | Food Log only | Macro bars, weekly grid (Consumed/Remaining), trend cards, quick weigh-in, Start next workout, day's log — **targets/trends arrive with Phase 5** |

## Phase 3 — small change

- Barcode match **logs immediately** with last-used/default serving + Undo/Edit banner (now it opens the amount screen).

## Phase 4 — small changes

- **Workout rotation** + **Start next workout** (on Today and top of Train).
- Weight **and reps pre-filled** from last session in the boxes (now shown as hints; checking an empty set already fills them).
- Charts: add **weekly volume** and **workout frequency**; tap charts for exact values.

## Proposed order

1. Short Phase 0 check of the new items above.
2. **Rework batch** (Phases 1–4 items above), shipped in two deploys: (a) navigation + Today + settings + wizard + native feel, (b) add-screen shortcuts + swipe/Undo + saved meals + rotation + charts.
3. Then continue with **Phase 5** (weight & coaching, Progress tab).

## Status (2026-11-11)

Done: Phase 0 checks; 4-tab layout + gear Settings; Today (macro bars, weekly grid, quick weigh-in, start next workout, swipe edit/delete with Undo, copy from yesterday, saved meals); first-run wizard; meal time windows; one-screen add with Recent/Favorites, one-tap re-log with Undo, long-press for amount; barcode match logs immediately with Undo/Edit; Train rotation + pre-filled weight/reps + weekly volume/frequency charts; rest-timer push notifications; native-feel CSS. Waiting on: Progress charts (Phase 5), AI features (Phase 6).
