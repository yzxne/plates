# AI coach (Claude app)

The coach is a normal chat in the **Claude app** (iPhone or claude.ai), not inside Plates and not Claude Code. Plates makes a short summary of your last 4 weeks; you paste it into a Claude project and ask questions. No API key, no AI cost in Plates (it uses your Claude plan), and only the summary leaves your Sheet.

Plan and ideas: [ai-coach-outline.md](ai-coach-outline.md) (local only). Code: `shared/coachSummary.ts` (summary), `shared/coachPrompt.ts` (instructions), `frontend/src/components/CoachCard.tsx` (Settings → AI coach).

## One-time setup (on your phone)

1. Open **Plates → Settings (gear) → AI coach → Copy instructions**.
2. Open the **Claude app** → **Projects** → **+ New project**. Name it **Plates Coach**.
3. In the project, tap **Instructions** (or "Set project instructions"), paste, save.
4. Optional: add this repo's `docs/algorithm.md` as project knowledge (on claude.ai: Project → Files → Add). The instructions already cover the essentials.

## Each time

1. **Plates → Settings → AI coach → Copy summary.**
2. **Claude app → Plates Coach → new chat** → paste → ask, for example:
   - "Weekly review."
   - "Why isn't my weight moving?"
   - "Why has my lat pulldown been stuck?"
   - "What did the weekend do to me?"
   - "Am I hitting protein?"
3. Ask follow-ups in the same chat. Start a new chat with a fresh summary next time so the numbers are current.

Tip: right after Monday's check-in is the best time for a weekly review.

## What's in the summary

Computed in the app (`buildCoachSummary`), roughly 3–5K tokens:

- **profile**: sex, age (not birth date), height, goal and rate, protein g/lb, training days, check-in day, water goal.
- **weight**: trend, 4-week change, last weigh-in, days since, weigh-ins in 14 days, ignored outliers (readings > 10 % off nearby weigh-ins, e.g. a wrong-field Health import).
- **latest_checkin / checkin_history**: expenditure, confidence, targets, the check-in's reason.
- **weeks** (4, starting on check-in day): calories and protein on complete days vs target, protein days hit, share of calories that were guesses, alcohol (drinks, kcal, days), weigh-ins, trend start/end, workouts vs planned, sleep, water.
- **last_7_days**: calories, target, protein, alcohol kcal, workout, sleep, weight per day.
- **lifts**: each lift done in the window: sessions, best est. 1RM now vs before, stalled since.
- **pain_notes_120d / recent_notes**: your workout notes (pain/discomfort ones from 120 days, all from the window).
- **flags**: data problems (no recent weigh-in, partial days marked complete, old imported food, Settings changed after the last check-in, repeated pain notes, no sleep/water yet).

Not included: birth date, email, food names (except as alcohol detection), places, food photos, raw rows.

## Privacy

The summary includes your weight, intake and your own workout notes. Paste it only into your own Claude account. Don't commit real summaries to this public repo.
