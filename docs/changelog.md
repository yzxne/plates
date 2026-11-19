# Plates changelog (after the 8 phases)

Everything built after Brief v2 and Phases 1–8. The brief (`Plates Development Brief.md`) and `Plates Brief Changes.md` describe the original plan; this note is what changed since. Newest first. Schema changes need a Worker deploy (`cd backend; npx wrangler deploy`) before the app uses them.

## 2026-11-18 — Gym change and weigh-in fixes
- **Lift records start** setting (set to 2026-08-01): records, PR pop-ups, stalls and bests ignore machine/cable/barbell sets from the old gym; dumbbell lifts keep all history. Nothing deleted.
- **Weigh-ins:** the latest one each day counts (was the average). Progress → Weight → **Recent weigh-ins** lists the last 14 with Delete (Undo available).
- Settings changed in the Sheet: activity level 1.375 → 1.55; the mistyped 185 lb weigh-in (Nov 18) soft-deleted.

## 2026-11-18 — Smarter food search
- **Best** tab merges FatSecret and USDA into one ranked list (`shared/searchRank.ts`): every typed word should match name or brand (plurals and word starts count; a whole word beats a prefix, so "eggs" ≠ eggplant); plain foods first unless you typed a brand; foods you've saved or logged get a boost; duplicates (same name + brand, calories within 5 %) and impossible entries (over 902 kcal/100 g, macros 50 % off the calories) are dropped; when 5+ results match every word, partial matches are hidden. Top 8 shown, "Show more" for the rest. FatSecret now returns 15 candidates (~16 of the 5,000 daily calls per search).

## 2026-11-18 — FatSecret without an IP list
- FatSecret search now signs each request with OAuth 1.0 (same Client ID / Secret). OAuth 2.0 only works from whitelisted IPs, and the free plan can't whitelist every address, which a Cloudflare Worker needs.

## 2026-11-17 — Routine weights follow what you saved
- After a workout, each checked-off set's weight becomes the routine's planned weight, **up or down** (it used to keep the heavier one forever). Unchecked sets change nothing; new exercises only take weights from checked-off sets.
- Removed a 3-minute test "Push" workout from 2026-11-11 (Bench 225×12 ×2, 205×12), soft-deleted in the Sheet.

## 2026-11-17 — AI coach (Claude app)
- **Settings → AI coach**: *Copy summary* builds a compact JSON of the last 4 weeks on the phone (calories/protein vs targets on complete days, partial-looking days left out, alcohol, weigh-ins and trend, check-ins, workouts vs planned, lifts with best est. 1RM vs before, stalls, pain notes, sleep, water, data flags). Paste it into a "Plates Coach" project in the Claude app; *Copy instructions* gives the project's instructions. No API cost, no new tab or Worker route. Setup: docs/coach-prompt.md. Code: `shared/coachSummary.ts`, `shared/coachPrompt.ts`.
- **Weight outliers**: weigh-ins more than 10 % from the median of nearby weigh-ins (±21 days, needs 2+) no longer move the trend weight or check-ins.

## 2026-11-16 — Fixes pt 2
- **Water** (schema v8, `Water` tab): meter on Today toward a goal (setting `water_goal_oz`, default half body weight in oz). Glass / bottle / big bottle, plus diet soda, sparkling water, coffee, Monster Zero Ultra, regular Monster (adds 210 kcal to Snack). Caffeine total shown.
- **Cardio finisher** card at the bottom of every workout: lighter after leg days, rotates by day, ~kcal from METs, a reason and a fact.
- **Reorder exercises** by dragging (sheet with ≡ handles) during a workout.
- **Protein minimum** tag on Today (g/lb × latest weigh-in), even before the first check-in.
- **1RM** now averages Epley and Brzycki and ignores sets over 10 reps.
- **Smith / free-weight pairs** added to the exercise library; "+ Create custom exercise" button in the picker.
- **Rest timer** sits above the keyboard; page shift after the keyboard closes is reset (iOS scroll bugs).
- Sleep endpoint says what it received when nothing is logged.

## 2026-11-14
- **Amount slider** replaces ½ / 1 / 1½ chips (logging, editing, combos, AI estimates).
- **Sleep** (schema v7, `Sleep` tab): `POST /shortcut/sleep` from an Apple Health Shortcut (docs/shortcuts.md §6); shown on Today, Progress → Sleep, and a short-sleep note in the workout logger.
- **Weigh-in reminder**: web push at a chosen time, repeating (default 8:45, up to 3×, every 45 min) until a weigh-in is logged. 15-minute cron.
- **Whole-meal portion**: scale a combo or an AI estimate.

## 2026-11-12
- **Combos** (schema v6, FoodLog `group_id`/`group_name`): combine foods into one named item; edit any part; AI photo meals auto-combine.
- **Drinks tab** (standard alcohol pours, counted); opens by itself Fri–Sun after 9 PM Central.
- **Form tips** on every exercise page (own wording, by movement pattern).
- Edit food page redesigned to match Add food; USDA search improvements; workout fixes (decimal entry, swipe-delete sets, body map); weights suggested from recent best.

## 2026-11-11 (after Phase 8)
- Serving-first amounts; routine folders; exercise library (~130 lifts); Day complete button; motion; Settings hub; swipe between tabs; progression suggestions, records, stall/deload, plate calculator; PR pop-ups; weekly Excel backups; archive tool; timeline view; iPhone Shortcuts (weight, quick log, summary, food → Health).
