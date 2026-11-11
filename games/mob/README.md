# Mob

## Description

Fire a crowd from your cannon, multiply it through gates and smash the enemy base. Then build a card deck and battle in versus mode!

## Controls

- **Aim:** drag across the screen (or move the mouse); the cannon follows and fires on its own.
- **Big units:** send your crowd into a house to fill it; it makes a giant, a bomb or a vehicle.
- **Cards:** tap a charged card at the bottom of the screen to send its unit out of the cannon.
- **Menus:** tap the buttons and tabs (levels, upgrades, cards, versus).

---

Aim a cannon, multiply your crowd through gates, and overrun the enemy base before its crowd breaks through. Based on Mob Control; the brief and references are in `refs/mob/` (`mob_control_gameplay_and_web_mvp.pdf`). This is its MVP: one arena, three presets, one upgrade.

- **Control:** drag across the screen (or move the mouse) and the cannon follows. It fires blue mobs all the time. The battle starts on the first touch.
- **Gates:** a blue mob crossing a gate becomes `value` mobs. Each mob remembers the gates it has crossed, so a gate never multiplies the same crowd twice.
- **Enemy:** the red base sends red mobs down in waves, faster as the battle goes on. Each red heads for its own lane, so they come down the sides too. A blue and a red that touch both go.
- **Win:** blues reaching the base take its HP down to 0. **Lose:** a red crosses the red line in front of the cannon.
- **Between battles:** coins for a win, spent on the cannon's fire rate (levels 1–5). A loss keeps everything. Battles go through the three presets, then repeat a little harder each loop.

## Running it

Set `GAME=mob` in `.env`, then `npm run dev`. After a fresh clone, or when `raw-assets` changes, run `npm run font` and `npm run models`.

`?dev=1` shows the debug panel: WIN / LOSE / RESTART, coins, reset the save, the camera (pitch, field of view, aim, zoom or distance, bend) and the battle's tuning. Press the panel's Apply to keep your settings; "Log camera" prints the camera's values to put in the code.
**The upgrades** (what the houses make: giant, truck, UFO, car) are set in the editor's **Units** tab (`npm run
editor`, saved to `ui/units.json`): each one's colours (the giant's body; a tint over the giant's building or the
vehicle; the plain houses' walls and roofs), its charge (blues into its house to make one — a level's house can set its
own in the Levels tab, else it uses this), its hp (the car's 0: nothing stops it) and the most it takes off the enemy's
building (the UFO: its crash). And how its house is drawn: its building (a model), the plain house made in the game, or a coloured
pad on the floor. In the **Zones** tab, *plain forts* draws a zone's enemy forts as the plain ones made in the game
instead of the red barracks and tower models. The debug panel's **Colours** folder picks the upgrades' colours live: the giant's body, a tint over the giant's building and each
vehicle (truck, UFO, car), and the truck / UFO / car houses' walls and roofs. "Log colours" prints them for
`UNIT_COLORS` in `game/data/MobConfig.ts`.

## Where things are

- `LEVEL_GUIDE.md`: every element a level can use (what it does, its settings, its editor tool) and tips for building
  and checking levels.
- `game/data/MobConfig.ts`: every number: the arena, speeds, sizes, the three presets (gates, red rates, base HP, reward), the upgrade's costs, the colours.
- `game/battle/Battle.ts`: the rules, with no drawing: a 2D simulation in typed arrays, a spatial grid for pushing apart and fights, gate crossings, base hits, win and lose.
- `game/battle/CrowdView.ts`: draws the mobs. The run cycle is baked at load into 10 poses, each one instanced mesh, coloured per mob by team.
- `game/battle/Arena.ts`: the field, hedges, cannon, gates, base, sea and effects. Built from plain shapes for now.
- `game/services/Bend.ts`, `Water.ts`: the world bending away from the cannon, and the sea (both from UFO).
- `game/scenes/MobScene.ts`: a battle: input, camera, the flow from waiting to playing to the end card, the debug panel.
- `game/ui/MobHud.ts`: the HUD and the end card.
- `tools/build-mob.mjs`: builds the mob model from the library's characters Fun kit (the plain body plus a face) and copies UFO's animations. Run it, then `npm run models`.
- `tools/sim-battle.ts`: plays battles with no drawing, with different ways of aiming, and prints how each went. Run it with `npx ts-node --transpile-only games/mob/tools/sim-battle.ts` after changing the numbers.
