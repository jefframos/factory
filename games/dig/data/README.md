# Dig analytics snapshots

See [Build and minute-by-minute playtest map](BUILD_TIMELINE.md) for each build's
changes, observed timing, comparison caveats and the required future build record.

The CSV exports are grouped by build comparison, not filename suffix or file
modification time:

| Folder | Original export names | Build interpretation |
| --- | --- | --- |
| `baseline/` | Unsuffixed reports previously in this directory | Oct 31 morning-style build: 20-slot first bag, Trophy Room tutorial step, temporary Mega Drill power surge, no guided relic hunt. |
| `regression-test/` | Reports previously suffixed `(1)` in this directory | Oct 31 afternoon-style experiment: guided relic hunt, hub sets, recurring power surges; documented tutorial regression. |
| `latest/` | Newest imports, including `progress-events (1).csv` | Nov 1-style revision: 30-slot first bag, wider early tools, on-the-spot relic claims, no Trophy Room tutorial step, guided hunt disabled, less frequent recurring surges. |

Each snapshot contains `progress-events.csv`, `interaction-events.csv`, and
`other-events.csv`. File contents are unchanged.

Build interpretations follow the event signatures, the game's README, and
changes in commits `32361e71` through `7969fe67`. The CSVs do not embed a build ID,
reporting window, audience, or experiment assignment, so these are inferred
mappings, not verified deployment metadata.

## Comparing reports

- Compare the same action column, not just `gameplays`: an event can include
  starts, completions, visibility, or failures. `total_*` counts repeated events.
- Tutorial completion is `tutorial-campaign.completes / starts`. The endpoint
  changed: baseline and regression have `tutorial-12-build`, whereas latest has
  `tutorial-11-build`. Latest claims can happen automatically on the find banner.
- Playtime milestones measure active time within a session, not day-over-day
  retention. Conditional milestone reach (for example, 5-minute gameplays divided
  by 1-minute gameplays) avoids assuming a dashboard session denominator.
- If normalizing to sessions that emitted a start event, sum
  `session-new.starts + session-returning.starts`: baseline 497, regression 467,
  latest 503. These are not new-player-only cohorts; the CSVs cannot separate
  their playtime outcomes.
- Time buckets use accumulated active play across sessions, not session-relative
  timestamps. Baseline/regression use `m00-01`, `m01-02`, etc.; latest uses `m00`,
  `m01`, etc. Old numbered time events were dropped by the SDK's digit limit;
  their absence is not evidence that the underlying action did not happen.
- Temporary power surges already existed in the baseline. The checked-in configs
  specify 25 seconds, not 20. Surges auto-cash new drops and bypass backpack
  limits; expiry restores both the owned tool and the normal dig/sell loop.
