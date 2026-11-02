# Dig build and minute-by-minute playtest map

## How to read this map

These are distributions across players, not a script that everyone follows.
The build-to-export mapping is inferred from code history, the game README,
and event signatures. Exact deployed hashes, export windows, platforms, and
audience assignments were not stored with the historical exports.

Two clocks must not be mixed:

- `playtime-min-N-reached`: active time in the current session.
- `time-...-mNN`: accumulated active time in the save, across sessions.

An event count in a time bucket means gameplays reporting that action in that
bucket. Do not sum those counts to infer unique players across buckets.
Power surges can repeat; starts and ends in a bucket are not matched pairs.
Zone entry is not proof the player's permanent tool can mine that zone.

Exports resolve 0-1, 1-2, and 2-3 minutes separately, then 3-5, 5-8, 8-12,
12-20, 20-30, 30-45, 45-60, 60-90, and 90+ minutes. In particular, minute 4
cannot be separated from minute 3 in these reports. Do not invent that split.

## Build changes and evidence

| Snapshot | Source anchors / identifying evidence | Experience and changes |
| --- | --- | --- |
| [Baseline](baseline/) | Morning-style Oct 31 build, `32361e71`; 20-slot first bag, `tutorial-11-collection`, `tutorial-12-build`, no hunt events. This commit is a source anchor, not a verified deployed hash. | Dig, sell, forced tool and bag upgrades, wardrobe/hat, first find, claim via Trophy Room, first hub piece. Temporary Mega Drill surge already exists: 25 seconds, 1.25x swing-speed multiplier, auto-cashing drops. No recurring chest configuration in this anchor. |
| [Regression test](regression-test/) | Afternoon-style Oct 31 changes through `91ff1bee`; hunt, hub-set and Red Tractor events; old tutorial steps remain. | Adds guided relic hunt, hub sets/perks/income, rainbow tractor/star presentation, recurring chests with a 60-second delay. Guide priorities include the first power chest; first room reveal is tied to power chest or Power Drill. These changes were bundled, not isolated experiments. |
| [Latest tested](latest/) | Nov 1 revision `7969fe67`; first bag event is `upgrade-bag-01-30`; build becomes tutorial step 11; new timestamp naming; no hunt events. | Shovel interval 0.26 -> 0.20 seconds; Pickaxe and Steel Pickaxe widened. First paid bag 20 -> 30 slots, still $10. Claim on find banner, with auto-claim; Trophy Room step removed. First room can also reveal after an upgrade following the wardrobe. Guided hunt disabled. Recurring surges wait 180 seconds and require a first build. Adds separate boost machine and full-bag return guidance after two failed digging pushes. |

### Baseline: observed timeline

| Active-play bucket | Tutorial / hub / rewards | Digging / surge / exploration |
| --- | --- | --- |
| 0-1 min | 36 tutorial completions. Intended opening: movement, bag fill/sale, forced Pickaxe, 20-slot bag, hat, first find. Exact upgrade timing is unavailable: old numbered timestamp events were rejected by the SDK. | 107 Mega Drill surge starts, 6 ends. Stone entry 96; Deep 35; Ruins 20. Temporary access to deeper areas is already part of this version. |
| 1-2 min | 107 tutorial completions: the largest completion bucket. Completion includes the collection visit and first build. | 138 surge starts, 215 ends; Stone entries 153, Deep 130. 49 first blocked-Ruins events: some players meet the power-5 material gate in this bucket. |
| 2-3 min | 70 tutorial completions; slower onboarding continues into minute 3. | 17 surge starts, 31 ends; 25 blocked-Ruins events. Transition toward normal dig/sell/upgrade play; no named guided hunt in this version. |
| Minute 3 and minute 4, combined 3-5 | 21 tutorial completions. Cannot distinguish the individual minutes. | 6 surge starts, 10 ends; 32 blocked-Ruins events. Longer play relies on self-directed upgrades, finds and hub purchases. |
| 5-8 min | 5 remaining tutorial completions. | 29 blocked-Ruins events; 22 Ruins entries. Timestamped permanent-tool purchases are unavailable, so their minute cannot be reconstructed. |
| 8+ min | Long-tail upgrading, collecting and new mines; exact purchase timing unavailable. | Session reach: 84 at 8 min, 51 at 12, 25 at 20, 10 at 30, 3 at 45, 2 at 60. These session milestones use a different clock from the rows above. |

### Regression test: observed timeline

| Active-play bucket | Tutorial / hub / rewards | Digging / surge / exploration |
| --- | --- | --- |
| 0-1 min | No tutorial completions. Same 20-slot opening bag. The extra chest/guide dependencies are a candidate for delayed onboarding, not proof of cause. | 105 surge starts, 7 ends; Stone entries 92, Deep 32. |
| 1-2 min | 61 tutorial completions; 5 south-east room-set completions. | 113 surge starts, 184 ends; Deep entries 117, Ruins 65; 47 blocked-Ruins events. |
| 2-3 min | 61 tutorial completions; 21 south-east set completions. Guided hunt provides named relic objectives once its gate is met; exact hunt timing is missing because old numbered timestamp events were rejected. | 35 surge starts, 38 ends; 19 blocked-Ruins events. |
| Minute 3 and minute 4, combined 3-5 | 27 tutorial completions; 8 south-east set completions. | 44 surge starts, 52 ends. Recurring surges are more prominent than in baseline; 19 blocked-Ruins events. |
| 5-8 min | 5 tutorial completions; 11 south-east set completions. | 27 surge starts, 32 ends. More recurrent power does not establish improved sustained engagement. |
| 8+ min | 3 tutorial completions after minute 8. | Session reach: 61 at 8 min, 36 at 12, 15 at 20, 9 at 30, 2 at 45, 1 at 60. |

### Latest tested: observed timeline

| Active-play bucket | Tutorial / hub / rewards | Permanent progression / surge / exploration |
| --- | --- | --- |
| 0-1 min | 270 first-hat purchases; 254 first tutorial claims; 29 tutorial completions. Banner claims can be automatic, so this is not a count of deliberate taps. | Pickaxe purchases 396; Steel Pickaxe 114. Surge starts 206, ends 57. Stone entries 184, Deep 91, Ruins 39: substantially more early exposure to powerful digging and deeper terrain. |
| 1-2 min | 55 first claims; 144 first builds/tutorial completions; 12 south-east set completions. This is the main onboarding-to-open-play handoff. | Steel Pickaxe purchases 136; Power Drill 115; permanent Mega Drill 2. Surge ends 218. 47 blocked-Ruins events. Tutorial completion, surge expiry, and early permanent upgrades overlap here; exports cannot establish their order for an individual. |
| 2-3 min | 7 first claims; 52 first builds/tutorial completions; 10 south-east set completions. After the first build, the guided hunt is off, leaving treasure beams and self-directed play (plus stuck/full-bag guidance). | Power Drill purchases 41; Mega Drill 1. Surge starts 15, ends 22. 20 blocked-Ruins events. Possible handoff problems: returning to hub, choosing the next goal, or losing access to rock at surge expiry. |
| Minute 3 and minute 4, combined 3-5 | 11 tutorial completions; 16 south-east set completions. No separate minute-4 observation exists. | Power Drill purchases 27; Mega Drill 5. Surge starts 18, ends 11; 33 blocked-Ruins events. Recurring chest timing depends on tutorial completion and previous surge, not a fixed session minute. |
| 5-8 min | 3 tutorial completions; 13 south-east set completions. | Mega Drill purchases 28; Power Drill 12; Digger 4. More permanent Mega Drill purchases occur here than before minute 5, so temporary power can precede ownership by several minutes. |
| 8-12 min | 2 remaining tutorial completions. | Mega Drill purchases 15. Session reach at 8 min: 66. |
| 12+ min | Extended hub, collection, vehicle and prestige progression, not a guaranteed minute-by-minute path. | Mega Drill purchases: 9 in 12-20, 1 in 20-30. Session reach: 36 at 12 min, 17 at 20, 3 at 30, 1 at 45; no 60-minute milestone row. |

## What changed in outcomes

| Comparable measure | Baseline | Regression | Latest |
| --- | ---: | ---: | ---: |
| Tutorial complete / tutorial starts | 239/488 (49.0%) | 157/449 (35.0%) | 241/474 (50.8%) |
| First claim / first find tutorial completions | 264/327 (80.7%) | 195/276 (70.7%) | 319/321 (99.4%) |
| First build / first claim tutorial completions | 239/264 (90.5%) | 157/195 (80.5%) | 241/319 (75.5%) |
| Reached 3 min / reached 1 min | 212/320 (66.3%) | 156/279 (55.9%) | 179/343 (52.2%) |
| Reached 5 min / reached 1 min | 142/320 (44.4%) | 103/279 (36.9%) | 113/343 (32.9%) |
| Permanent Power Drill purchases | 168 | 116 | 200 |
| Permanent Mega Drill purchases | 53 | 33 | 60 |

Ratios are aggregate, not linked-session funnels. Tutorial changes also change
what completion means. Cohorts, traffic quality, repeated sessions and sampling
variation are not controlled. No causal or statistical-significance claim is
made here. Average playtime cannot be recovered exactly from milestone counts;
the externally reported original 4:38 average is not present in these CSVs.

### Working interpretation, not a conclusion

- Keep the stronger first upgrade and easier reward delivery: players reach
  permanent upgrades faster and almost every first find now delivers its reward.
- Reward-to-build is now a weaker handoff. Larger bags and auto-cash may reduce
  returns to the hub, where building guidance becomes actionable.
- A surge is not just extra speed: expiry restores bag limits and can remove
  permission to mine the current material. Ancient Bricks require power 5;
  the $600 Power Drill has power 4 and does not solve that gate. The $2,500
  Mega Drill does. Track whether this is where a session stops.
- Disabling guided relic objectives also changes the post-tutorial experience.
  Do not attribute the entire 1-5 minute decline to the tractor alone.

## Next local revision: wide-swing feedback (unreleased, 2026-11-02)

Parent source: `7969fe67` plus the uncommitted revision in this workspace.
No new playtest export exists. Do not interpret `latest/` as measuring this change.

- Preserve all tool power, width/depth, prices, swing intervals, backpack
  capacities, rewards, tutorial gates and surge timings.
- When one swing breaks at least two blocks, show a warm, expanding 0.22-second
  ground pulse at the break. Reuse one mesh; scale is capped, and frequent swings
  restart it rather than allocating a pulse for every block.
- No extra camera shake, hit-stop, movement delay, or resource reward.
- Intended effect: first wide Pickaxe hits read as a more substantial impact;
  feedback remains active for later tools. It has no scheduled minute trigger.
- Before the next retention experiment, keep this feedback identical in both
  variants. Record it as a new build, not as evidence about the tested latest.

Validation: Dig production build passed. Ten browser checks cover activation,
single-block exclusion, expansion/fade, visible WebGL output with the bend shader,
expiry, reuse across 1,000 triggers, capped size, and GPU-resource cleanup. A
normal, non-debug game run with the first Pickaxe and 30-slot bag produced 10
multi-block swings and activated the effect on all 10. Repository-wide typecheck
is blocked by errors outside the modified files; neither changed TypeScript file
has a reported diagnostic. This validates behavior, not a retention improvement.

## Next local revision: optional Deep tractor and readability (unreleased, 2026-11-02)

Includes the wide-swing feedback above. No export measures these changes.
Parent source remains `7969fe67` plus the current uncommitted patch.

| Stage | Intended experience / change from latest tested | Timing evidence |
| --- | --- | --- |
| Opening / before The Deep | No 25-block automatic surge, no roaming power chests. Keep the wide first Pickaxe and shortened tutorial. First paid bag 30 -> 45 slots (still $10); tiers 3-7 raised to 60/75/90/110/130 so each stays a step up. Normal digging must provide the opening satisfaction. | Intended, not measured. Cannot promise how many minutes an individual needs to reach The Deep. |
| First entry to The Deep | Unlock one deterministic tractor spot for the current mine. Reveal the glowing model, green ring/beam and video badge within 16 blocks. The spot does not follow the player. | Progression-gated, not time-gated: deliberately no five-minute minimum. |
| Approaching the fixed spot | Dig a path and step within 1.4 blocks: pause movement/gameplay and show WATCH VIDEO / NOT YET, explaining the temporary power and one-use-per-mine limit. No video starts just from approaching. | New `tractor-rewarded-offer` visible/start/interact/skip events and timed equivalents. |
| After Skip or unsuccessful video | No power, no consumption; step more than 2.4 blocks away and return to reopen. No auto-reopening while standing there. | `skip` or `fail`; no `power-*` start for that attempt. |
| After completed rewarded video | Consume that mine's ride, save it, and grant 30 seconds of tractor power/auto-cash. Restore the owned tool and bag limits at expiry. No recurring offer in this mine; another mine has its own offer. No-ads variants hide the spot. | `complete` followed by existing `power-*` start/complete. Mock video verifies the local flow, not live ad delivery. |
| All minutes / all mines | Gold guide arrows gain a dark outline (rounded corners, pointed tip) and a higher minimum opacity; exposed mine floor colors use 65% of their prior linear-light intensity, preserving zone/theme hues. | Visual revision; no retention result yet. Must remain equal between future experimental arms. |
| All minutes / palette pass | Lighting: cool sky fill + warm sun (was warm fill + white sun). Per-zone fog tints the far view/horizon. Classic theme: stone tinted cool slate, gravel warm sand (first mine reads less flat grey); hub checker contrast softened. Ore decor glows/breathes, copper nuggets 1.3x, all ore twinkles occasionally (was rich veins only). Tractor spot recoloured cyan → video green. Inactive panel tabs (wardrobe COLORS/FACES/HATS, ATM GEAR/BOOSTS) changed from muted dark to gold so other pages read as tappable. Boost rows gained the backpack's segmented level bar (20 segments: owned green, next gold). Wardrobe gifts: red colour and Cool face are free to claim; if still unclaimed on the visit after the first hat, COLORS/FACES tabs and cards show a FREE badge (meant to raise colour/face discovery, which the data showed was low). SELL x2 (phone): first two uses free (first with the pointing hand), then rewarded video. Loader Pong: shadow no longer rotates with the ball nor gets clipped at the field edges. | Visual revision; no retention result yet. Must remain equal between future experimental arms. |

This is a bundled design revision, not the previously proposed isolated
surge-on/off experiment. Keep that distinction in the next comparison.

### What to read from this build's export

Every new change in this revision has an event, so the next export can answer it.
Read rates per player who reached the step, not raw counts.

| Question | Events (category / what / action) | Compare with |
| --- | --- | --- |
| Is the 45-slot first bag reached and bought sooner? | `upgrade / bag-02-45 / complete` and `time / upgrade-bag-02-m.. / complete`; `bag / full-45` | `bag-02-30` in earlier builds |
| Do the later bag tiers still sell? | `upgrade / bag-03-60` ... `bag-07-130` | earlier `bag-03` ... `bag-07` |
| Do gold tabs get colours/faces/boosts found? | `tab / wardrobe-colors \| wardrobe-faces \| atm-boosts / interact` (once per player), `shop / color-.. \| face-.. / bought` | the share of players with any colour/face bought in the previous builds (no tab events existed) |
| Do the wardrobe gifts work? | `gift / colors \| faces / visible`, then `gift / <kind>-badge / complete` (claimed after the badge) vs `<kind>-unbadged` (found on their own) | badge claims ÷ badge views |
| Does SELL x2 become a habit after the free uses? | `phone / sell-x2-free / visible, complete` then `phone / sell-x2 / visible, interact, complete, fail` | video tap rate in earlier builds (phone sell-x2 interact ÷ visible) |
| Is the Deep tractor taken? | `tractor / rewarded-offer / visible, start, interact, skip, complete, fail` | new: no baseline |
| Retention overall | `playtime / min-n`, `tutorial / nn-step`, `session / returning` | the previous build's curve |

Boost level bars and the palette, loader and arrow changes have no event of
their own. Read them through boost purchases (`boost / <id>-nn`) and retention only.

### Visual assessment

The chunky low-poly miner, recognizable tools, bright action affordances and
clear resource HUD fit familiar casual web-mining conventions. That is a genre
fit, not proof of competitive market performance. The original gold-on-tan
arrows and some similarly valued rock/floor surfaces weakened navigation and
excavation readability. Outlines and darker exposed paths target those issues
without changing the game's palette or progression. The game still needs
small-screen/color-vision checks, player observations and fresh retention/CTR
data before claiming accessibility compliance or market readiness.

## Required record for every future playtest build

Store this alongside that build's exports before interpreting results:

1. Immutable build label, source commit, uncommitted patch if any, deploy time,
   platform, experiment arm and traffic assignment.
2. Export window/time zone, dashboard session denominator and its definition,
   new/returning split, sample size, and whether incomplete sessions are included.
3. Changes from the previous build: tutorial/guide gates, tools and bags, economy,
   map/relic placement, surge power/duration/recurrence, audiovisual feedback,
   loading and analytics schema. Explicitly say what did not change.
4. Intended and observed rows for 0-1, 1-2, 2-3, 3-4, 4-5, 5-8 and later play:
   current objective, tool/bag, expected reward, return-to-hub reason, likely gate,
   and event evidence. Mark unmeasured minutes rather than estimating them.
5. Session-relative surge start/end and 30/60-second continuation, with owned
   tool, bag state and blocked material; next sale, upgrade and build after
   expiry. Existing `power-*` start/complete events are available, but historical
   exports lack session-linked paths and those post-expiry measurements.
6. Predeclared outcome and guardrails. For a surge-on/off experiment, keep the
   shorter tutorial, stronger first upgrade and all feedback equal between arms.
   Capture actual session duration for the >5-minute average-playtime target.

To distinguish minute 3 from minute 4, future analytics must add that resolution
within the SDK's event-name constraints. This revision documents the gap; it does
not change the analytics schema or claim historical precision that does not exist.
