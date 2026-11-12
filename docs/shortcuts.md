# iPhone Shortcuts for Plates

Four shortcuts, built once in Apple's **Shortcuts** app. They use a separate **Shortcuts key**, never your passcode.

## 0. Get your key (once)

1. Plates → gear on Today → **iPhone Shortcuts** → **Make a key** → **Copy**.
2. Keep it somewhere safe (password manager). It's shown only once. If you lose it, tap **Make a new key** and paste the new one into each shortcut.
3. Anyone with the key can log food/weight and read today's totals, nothing else. **Don't share these shortcuts** (they contain the key). If a phone is lost: **Turn off** the key.

In every shortcut below, the server address is `https://plates-api.zwag7913.workers.dev` (also under "Addresses for the Shortcuts" in Settings), and wherever it says **Headers**, add:

| Key | Value |
|---|---|
| Authorization | `Bearer ` + your key (e.g. `Bearer plk_abc…`, with one space after Bearer) |

---

## 1. Weight from Apple Health (every morning, automatic)

Your scale or Health app → Plates, no typing.

1. Shortcuts → **Automation** tab → **+** → **Time of Day** → 9:00 AM, **Daily** → **Run Immediately** → Next → **New Blank Automation**.
2. Add **Find Health Samples**: Type **Weight**, Sort by **Start Date**, Order **Latest First**, Limit **1**.
3. Add **Get Details of Health Samples** → **Value**.
4. Add **Get Contents of URL**:
   - URL: `https://plates-api.zwag7913.workers.dev/shortcut/weight`
   - Method: **POST**
   - Headers: Authorization (see above)
   - Request Body: **JSON** with
     - `weight` (Text) = the **Value** variable from step 3
     - `unit` (Text) = `lb` (or `kg` if Health shows kg)
5. Optional: add **Show Notification** with the **Contents of URL** to see "Logged 172.4 lb."

Same weight twice on one day is ignored, so it's safe to run more than once.

## 2. Quick log with Siri ("Hey Siri, log food")

1. Shortcuts → **+** (new shortcut) → name it **Log food**.
2. Add **Dictate Text** (or **Ask for Input** → Text if you'd rather type).
3. Add **Get Contents of URL**:
   - URL: `https://plates-api.zwag7913.workers.dev/shortcut/log`
   - Method: **POST**, Headers: Authorization
   - Request Body: **JSON** → `text` (Text) = **Dictated Text**
   - Optional `meal` (Text) = `breakfast` / `lunch` / `dinner` / `snack` (otherwise it uses your meal times).
4. Add **Get Dictionary Value** → Key `message` from **Contents of URL**.
5. Add **Speak Text** (or **Show Result**) with the **Dictionary Value**.

Say: "Hey Siri, log food" → "two scrambled eggs and a slice of toast" → Siri answers "Logged egg, toast to Breakfast, about 300 kcal."
Entries are marked **estimate**; fix amounts later in Plates (tap the entry). Uses one small AI request (fraction of a cent) and counts toward your AI cap.

## 3. Evening reminder (9 PM, automatic)

1. **Automation** → **+** → **Time of Day** → 9:00 PM, **Daily** → **Run Immediately** → **New Blank Automation**.
2. Add **Get Contents of URL**:
   - URL: `https://plates-api.zwag7913.workers.dev/shortcut/summary`
   - Method: **GET**, Headers: Authorization
3. Add **Get Dictionary Value** → Key `text`.
4. Add **If** → **Dictionary Value** → **contains** → `not marked complete`.
5. Inside the If: **Show Notification** → title "Plates", body = **Dictionary Value**. (e.g. "1,850 of 2,440 kcal · 590 left · protein 120/191 g. Day not marked complete.")
6. **End If**.

Other fields you can use: `kcal`, `kcal_target`, `kcal_left`, `protein_g`, `items`, `day_complete`.

## 4. Start next workout (Home Screen / Action Button)

1. Shortcuts → **+** → name it **Next workout**.
2. Add **Open URLs** → `https://yzxne.github.io/plates/?start=next`.
3. Add it to your Home Screen (share icon → Add to Home Screen) or set it as the **Action Button** (Settings → Action Button → Shortcut).

It opens Plates on the next routine in your rotation and starts it.
**Limit:** iOS opens links in **Safari**, not the Plates Home Screen app, so log in to Plates in Safari once. A workout started in Safari stays in Safari until you finish it.

---

## Troubleshooting

| Message | Fix |
|---|---|
| "Shortcuts key missing or revoked" | Check the header is `Authorization` = `Bearer plk_…` (one space). Make a new key if you turned it off. |
| "Too many requests" | Wait a minute. |
| Weight off by ~2.2× | Set `unit` to match Health (`lb` or `kg`). |
| "This month's AI cap … is used up" | Log in the app instead, or raise the cap in Settings. |

## 5. Food → Apple Health (every morning, automatic)

Sends **yesterday's** totals from Plates into Apple Health (yesterday, so the day is finished and won't change).

1. **Automation** → **+** → **Time of Day** → 8:00 AM · Daily · **Run Immediately** → **New Blank Automation**.
2. **Get Contents of URL**: `https://plates-api.zwag7913.workers.dev/shortcut/summary?day=yesterday` · Method **GET** · Header `Authorization` = `Bearer plk_…`.
3. Add **Get Dictionary Value** → Key `kcal`.
4. Add **Log Health Sample**: Type **Dietary Energy**, Value = **Dictionary Value**, Unit **kcal**. Tap the date and pick **Yesterday** if it lets you (otherwise it's logged at the run time, which is fine).
5. Repeat steps 3–4 for each one you want (same **Contents of URL** as input each time):

| Key | Health type | Unit |
|---|---|---|
| `protein_g` | Protein | g |
| `carbs_g` | Carbohydrates | g |
| `fat_g` | Total Fat | g |
| `fiber_g` | Fiber | g |
| `sugar_g` | Dietary Sugar | g |
| `sodium_mg` | Sodium | mg |

6. Optional: put the Log Health Sample steps inside **If** `kcal` **is greater than** `0`, so days with nothing logged don't add zeros.

These are day totals (one entry per nutrient per day), not each food.
