# Proposal: swipe between tabs (Today ↔ Progress ↔ Train)

**Built** (frontend/src/swipeTabs.ts). On by default; off switch in Settings → Advanced → Swipe between tabs.

## Gestures that already use horizontal swipes

| Existing gesture | Where | How the tab swipe avoids it |
|---|---|---|
| Change day | Swipe on the **Today header** (date) | Tab swipe ignores touches that start in the header. |
| Edit / delete entry | Swipe on a **food entry row** | Ignores touches that start on a swipeable row. |
| Chart readout | Drag on a **chart** (Progress) | Ignores touches that start on a chart. |
| Week grid, chips, sliders, inputs | Today / Settings | Ignores touches on buttons, inputs and horizontally scrollable strips. |
| iOS edge gestures | First/last ~24 px of the screen | Ignores touches that start within 24 px of either edge. |
| Sheets, overlays, workout logger | Full-screen layers | Tab swipe is off while any overlay is open. |

So a tab swipe only starts on **empty space or card backgrounds** in the middle of the screen.

## Rules

- Counts only if the finger moves **≥ 80 px sideways** and at least **2× more sideways than up/down** (so normal scrolling never switches tabs).
- Left → next tab, right → previous; order Today → Progress → Train (the **+** button isn't a tab). No wrap-around.
- Short slide animation on release; tabs still work exactly as now (taps remain the main navigation).
- Settings → Advanced → **Swipe between tabs** turns it off if it gets in the way.

## Effort

About 1–2 hours plus an iPhone test. Risk: accidental tab changes while scrolling — that's what the 80 px / 2× rule and the setting are for.
