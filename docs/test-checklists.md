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
