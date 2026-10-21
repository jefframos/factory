# Playtest bot & session report

Plays (or watches you play) the real game in the browser, then shows a report of where it felt bad:
clients walking out and why, empty shelves, garbage, cashier waits, slow levels, dead time.

## Run it from the terminal (report saved to a file)

`tools/playtest/run-playtest.mjs` drives a browser with Playwright, waits for the run to end and
saves everything to `games/pizza/reports/playtests/<stamp>/` (gitignored), plus a copy of the
report at `games/pizza/reports/playtests/latest.md`:

| Command | What happens |
|---|---|
| `npm run playtest` | **Headless**: starts its own dev server on a free port (9100+), bot at 5x from a fresh save, ~8 min real for a full demo |
| `npm run playtest:watch` | Same in a **visible window** (real GPU) — use the panel as usual; the window stays open after the report |
| `npm run playtest -- --minutes 20 --speed 5 --style casual --label tomato` | Options (all optional) |
| `npm run playtest -- --url http://localhost:9001` | Use the dev server you already have running |

Each run folder has `report.md` (the text report + a Runner section: real vs game time, achieved
speed, browser console errors including boot), `data.json`, `console.log` and screenshots at every
store level-up, every 60 real seconds (`--shots N`, 0 = off) and at the end. `--timeout N` (real
minutes, default 30) cuts a run that hangs and reports what it has.

Browser: an installed Playwright Chromium (`npx playwright install chromium` if there's none, or
point `PLAYTEST_CHROME` at any Chrome). Headless uses software WebGL: 5x is reached comfortably; at 10x the frame rate drops and per-unit
transfers (paying, depositing) become frame-bound, which skews the numbers — compare runs at the same speed.

## Run it in your browser

`npm run dev` (with `GAME=pizza`), then open one of:

| URL | What happens |
|---|---|
| `localhost:9001/?bot&fresh` | Bot plays from a **wiped save**, at 8x, for 40 game minutes or until the demo ends |
| `?bot=casual&fresh` | Same with a distracted-human style: slower decisions, smaller restocks, random pauses |
| `?bot&fresh&speed=12&minutes=60` | Faster, longer (the panel shows the speed actually reached) |
| `?bot` | Bot continues **your current save** (it will change it) |
| `?record` / `?record&fresh` | No bot: records **you** playing; press **Report** on the top-right panel when done |

`fresh` wipes the save on every page load while it's in the URL. The panel shows game time, money,
store level and what the bot is doing; **Report** ends the run early. From the console:
`__pizzaPlaytest.report()`, `__pizzaPlaytest.data()`, `copy(__pizzaPlaytest.text())` (text report so far),
`__pizzaPlaytest.state()` / `.result()` (what the terminal runner polls).

The report opens over the game with **Copy report (text)** (paste it into a chat), **Download report
(.html)** and **Download data (.json)**. Panel buttons: **1x/2x/5x/10x** speed (remembered), **Stop/Resume**
the bot, **Free cam**.

## Files

| File | Job |
|---|---|
| `PlaytestSession.ts` | URL flags, status panel, end conditions, shows the report |
| `PlaytestBot.ts` | The player: picks a goal every think (priorities in its header), walks there, stands in the zone |
| `WorldNavGrid.ts` | Whole-map A* grid (reuses `StoreNavGrid`), rebuilt when solids change or a zone opens |
| `PlaytestRecorder.ts` | Wraps `GameAnalytics` + notifications, tracks every client, samples the stores every second |
| `PlaytestAnalysis.ts` | Data -> findings (pure, no game imports — re-run on a saved .json) |
| `PlaytestReport.ts` | Findings + charts + tables as one self-contained HTML page; the same as compact markdown text (Copy button / runner) |
| `tools/playtest/run-playtest.mjs` | Terminal runner (Playwright) — see "Run it from the terminal" |

Game-side hooks it relies on (all read-only except the input and the two tap equivalents):
`PlayerMovementController.setScriptedInput()`, `Store.getPlaytestSnapshot()`,
`StoreClient.getWants()/getCurrentWantType()`, `ZoneTutorialController.getActiveStep()`,
`UpgradeNotificationManager.isAwaitingTap()/tapToContinue()`, `PopupManager.getCurrent()`,
`hireStoreWorker()/upgradeStoreWorker()` (HireWorkersPopup), and id/cost getters on the zone
entities (`StorageZone`, `StoragePurchaseZone`, `FarmZone`, `BuildingZone`, `HireDeskZone`, `MixStation`).

## What the bot does — and doesn't

It does: follow the zone tutorials; restock by demand (farms, egg/milk boxes, mix-station products);
serve at the cashier; collect money; buy every storage/farm/building level/station as soon as it's
affordable (cheapest first); chop/mine for resource costs; carry garbage to the trash; hire
cashier -> 2 restockers -> cleaner -> baker (once a mix station is built); spend spare money (what's left
after the priciest thing for sale) on the cheapest staff / farm-manager / animal-keeper upgrade.

It doesn't (yet): the mart, crafting-table popups, gates
outside a tutorial step. A goal it can't finish (stuck, unreachable, missing tool, nothing happening
in a zone) is dropped for 25 s and logged under **Reachability** in the report — those are often
real problems too.

Read the results as "an attentive player at speed X". A bot never gets confused, so the report shows
economy, pacing and bottlenecks, not whether the UI is clear. Compare `?bot` with `?bot=casual`
to see how much slack the tuning leaves.
