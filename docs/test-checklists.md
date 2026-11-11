# iPhone Test Checklists

## Phase 2 — Food logging

Open https://yzxne.github.io/plates/ (Safari or Home Screen icon). Pull down / reopen if it shows the old version.

**Search + log**
- [ ] Food Log tab shows Today, totals at 0, four meals.
- [ ] Tap **+** → **Search foods** → type `banana` → **Search**. USDA results appear.
- [ ] Tap a result → set **150 g** → **Log to …**. You land on Food Log; the entry and totals appear.
- [ ] Open your Google Sheet: **FoodLog** has the row, **Foods** has the banana, **Days** has today's totals.
- [ ] **+** → Search → type `ban` (don't press Search). The banana appears under **Your saved foods**.
- [ ] Search something branded (e.g. `cheerios`) → a result with servings → switch **g / serving** → numbers update.
- [ ] After a USDA search, tap **Search Open Food Facts too** → results show with the ODbL note.

**Meals, edit, delete**
- [ ] Tap **+** next to Dinner → log something → it lands under Dinner.
- [ ] Tap an entry → change amount and meal → **Save** → list and totals update.
- [ ] Tap an entry → **Delete entry** → confirm → it disappears (in the Sheet, `deleted_at` is filled, row kept).

**Paste label (Live Text)**
- [ ] Photograph a nutrition label → open the photo → press and hold the text → **Select All** → **Copy**.
- [ ] Plates: **+** → **Paste label text** → paste → **Read label**. Check every number against the label; fix any that are off.
- [ ] Add a name → **Save food** → set amount → **Log**. Tell me any label that parsed wrong (paste me the copied text).

**Quick add + day complete**
- [ ] **+** → **Quick add** → 250 kcal → **Log**. Shows as "Quick add".
- [ ] Tick **Day complete** → Sheet **Days** row shows TRUE. Untick → FALSE.
- [ ] Use ‹ › to go to yesterday and back; tap the date to pick another day.

**Saved foods**
- [ ] More → **Saved foods** → filter → tap a food → details → **Remove** works.

**Failure handling**
- [ ] Turn on Airplane Mode → log a quick add → you see "Not saved yet". Turn Airplane Mode off → More → **Not saved yet** card → **Retry now** → it saves.

## Phase 3 — Barcode

Test in **Safari** first, then again from the **Home Screen icon** (iOS treats them differently). Have 3–4 packaged foods ready.

**Live scan**
- [ ] **+** → **Scan barcode**. iPhone asks for camera permission → **Allow**.
- [ ] The preview is the back camera, not black, not full-screen, not sideways.
- [ ] Hold a barcode inside the green box. Within ~2 s it reads and shows the food with numbers → set amount → **Log**.
- [ ] Scan the same product again → it's found instantly (from your saved foods).
- [ ] If your phone shows a **Light** button, it turns the flashlight on/off.

**Fallbacks**
- [ ] **Use a photo** → take a photo of a barcode → it reads it.
- [ ] **Type number** → type the digits under a barcode → **Look up** works. Change one digit → it says the check digit is wrong.

**Not found**
- [ ] Scan something obscure (store-brand, local bakery). You see **Not found** with: Paste or scan the label / Enter manually / Scan again.
- [ ] **Enter manually** → fill name, serving size and numbers → **Save food** → **Log**. Scan it again → found instantly.

**Home Screen app**
- [ ] Repeat the live scan from the Home Screen icon. Tell me if the preview is sideways, black, or it keeps asking for permission (known iOS issues).

Report back: which items failed, and your iOS version (Settings → General → About).

## Phase 4 — Workouts

**Set up**
- [ ] Train tab → **Add starter exercises** (one time). Exercises list fills in; Sheet **Exercises** tab has ~42 rows.
- [ ] **+ New** routine → name it → **+ Add exercise** (try the search and muscle filter) → add 2–3 exercises → adjust sets (W/N/F, weight, rep range), rest → **Save**.

**Live workout**
- [ ] Open the routine → **Start routine**. Sets show your planned weights; reps show the range as a hint.
- [ ] Type weight/reps → tap **✓**. Row turns green; rest timer bar appears at the bottom with −15 / +15 / Skip.
- [ ] Let the timer finish: you hear a beep (phone not on silent) and the bar flashes.
- [ ] Tap the **W/1/F** box on a set → change type, or **Delete set**. **+ Add set** works.
- [ ] **⋯** on an exercise → change rest time, move up/down, add a note, remove.
- [ ] **+ Add exercise** mid-workout. Try **New** to create a custom exercise.
- [ ] Tap **X** (top left) to minimise → a green "in progress" bar shows above the tabs → tap it to resume.
- [ ] **Close Safari completely**, reopen Plates → the workout is still there.
- [ ] **Finish** → summary with duration, volume, sets, "New bests", sets per muscle → **Done**.
- [ ] Sheet: **Workouts** has 1 row (with name), **Sets** has one row per checked set.

**Next session**
- [ ] Start the same routine again → **Previous** column shows last time's weight × reps; tapping it copies them; checking an empty set fills from previous.

**History & progress**
- [ ] Train → **History** → open the workout → sets, est. 1RM, sets per muscle; **Delete workout** works (try on a test one).
- [ ] Routine page → chart with **Volume / Reps / Duration** and **1M / 3M / 1Y / All**.
- [ ] Train → **Exercises** → an exercise → best set, est. 1RM chart, history; **Edit** works.
- [ ] Train home → **Last 7 days** sets per muscle updates.

## Brief v2 rework

**Layout**
- [ ] Tabs are **Today · Progress · + · Train**. Gear (top right of Today) opens Settings; back arrow closes it.
- [ ] Double-tap buttons/lists: no zoom. Focus every input: no zoom. Long-press a button: no copy menu.

**Today**
- [ ] Swipe the date header left/right → next/previous day. ‹ › and tapping the date still work.
- [ ] Weekly grid shows Mon–Sun; tap a day to jump to it.
- [ ] **Weigh in** → number pre-filled with last weight → Save → Undo banner.
- [ ] Swipe an entry **left** → deleted + Undo (tap Undo → it's back). Swipe **right** or tap → edit.
- [ ] A meal's **⋯** → Copy from yesterday · Log saved meal · Save as a meal.
- [ ] **Start next workout** card shows your next routine (once you have routines).

**Add (+)**
- [ ] The meal chip matches the time of day. Change it with one tap.
- [ ] **Recent** shows foods with your last amount → one tap logs it + Undo/Edit banner; the screen stays open for more.
- [ ] Press and hold a recent food → amount screen. Star (☆) there → it appears under **Favorites**.
- [ ] Barcode button (in the search bar) → scan a food you've logged before → logs instantly with Undo/Edit.
- [ ] Type in the search bar → your foods first → **Search USDA** → Open Food Facts.

**First run**
- [ ] The setup wizard shows once (4 steps). Everything is editable later: gear → Profile, goals & meal times.

**Train**
- [ ] **Start next workout** at the top; routines show ↑ ↓ to set the rotation order; the "next" tag moves after you finish a workout.
- [ ] Starting a routine fills weight **and** reps from last time; ✓ accepts them.
- [ ] **Weekly volume / Workouts per week** chart.

**Rest-timer notifications** (Home Screen app only)
- [ ] Gear → Rest-timer notifications → **Turn on** → Allow → **Send test** → lock the phone → the notification arrives.
- [ ] In a workout, check a set, lock the phone → "Rest done" arrives when the timer ends. Music keeps playing.

## Phase 5 — Weight & coaching

- [ ] Settings (gear) → Profile: sex, birth date and height are filled in (the wizard asked for them).
- [ ] Today → **Weigh in**. Within a moment a toast says "Check-in done · new targets average … kcal/day" (first time only).
- [ ] Today's macro bars now show "X of target" with a marker; the weekly grid's **Remaining** toggle works.
- [ ] Three cards on Today: **Expenditure**, **Weight trend**, **Scale weight** with mini charts → tapping one opens Progress at that chart.
- [ ] Progress: switch 1W / 1M / 3M / 6M / 1Y / All. Tap and drag on a chart → exact values appear above it.
- [ ] Progress → **Strategy** shows your weekly plan (training days marked ●) and days until the next check-in.
- [ ] Sheet: **CheckIns** has a row with the reason; **Days** rows get target columns as you log.
- [ ] After a week: on your check-in day the targets update by themselves (no button). Expenditure goes "low data" → "settling" → "stable" over 2–4 weeks if you mark days complete and weigh in most days.

## Phase 6 — AI estimates

Setup first: Guide 5 in `docs/setup-guides.md` (credit, `Plates` workspace with a spend limit, key, then `npm.cmd run setup-secrets -w backend -- --anthropic`).

- [ ] Settings → **AI estimates** card shows $0.00 of $1.00 and no "Not set up yet" warning.
- [ ] Add food → camera button → add a **top-down** photo (camera or library) → Estimate. Items appear with grams, a range, confidence and a matched food.
- [ ] Add a **side** photo too → estimate again; grams look at least as sensible.
- [ ] Edit grams on an item → its kcal and the total update. Untick an item → it isn't logged.
- [ ] Tap **Change** on an item → search → pick a different food → kcal changes.
- [ ] Log → entries show on Today; in the Sheet, FoodLog rows have `is_estimate` TRUE, `food_source` and `place` set, `entry_method` ai_photo.
- [ ] Describe: type "chicken fried steak" with **Restaurant** + a chain name → menu matches show first (if USDA has them) → "Not listed — estimate with AI" works.
- [ ] **Cafeteria**: place fills from Settings. Tick "Save as my usual portion" on an item, log. Next estimate there uses that grams ("Your usual portion here").
- [ ] **Homemade**: list two ingredients, give grams for one → the AI keeps your grams and only fills the blank.
- [ ] Source and place are remembered the next time you open AI.
- [ ] **Paste AI**: Copy prompt → paste into the Claude app with a photo → copy its answer → paste → Read answer → review → log (no API cost; `entry_method` ai_paste).
- [ ] Set Settings → AI monthly cap to 0 → Estimate shows "cap is used up" with **Use Paste AI instead**. Set it back.
- [ ] The Sheet's **AIUsage** tab gets one row per API estimate, with a cost well under 1¢.

## Phase 7 — Imports & exports

Do these on your **computer** first (bigger screen for the preview), then try one export on the iPhone. Details: `docs/imports.md`.

- [ ] Settings → **Import & export** → Choose files → pick the Cal AI PDF **and** both Hevy CSVs at once.
- [ ] Preview shows: ~3,900 food entries over ~513 days, 66 workouts / 1,004 sets, ~38 weigh-ins, the exercises it matched and the new ones it will add. Nothing is in the Sheet yet.
- [ ] Tap **Import** → progress counts up → "Imported …". The Sheet has a new **FoodArchive** tab; Workouts, Sets, Exercises, Weights and Days have the new rows.
- [ ] Choose the same files again → preview says **Nothing new to import**.
- [ ] Today → go back to an old day (e.g. swipe back a week before you started Plates) → Cal AI foods show with their calories. Edit one entry's meal or delete one → it changes in FoodArchive (not FoodLog). Undo restores it.
- [ ] Progress → **All** → weight chart starts June 2025; calorie chart shows the old months.
- [ ] Train → History lists the Hevy workouts with sets and volume; tap one → exercises and notes look right. Check a few new exercises' muscle groups (Train → Exercises) and fix any wrong guesses.
- [ ] **Export to Excel** → file opens in Excel/Numbers with one sheet per tab.
- [ ] **Export weekly summary** for last week → open the .md in Obsidian: nutrition table, weight, workouts.
- [ ] On iPhone: Export to Excel → share sheet → Save to Files works.
