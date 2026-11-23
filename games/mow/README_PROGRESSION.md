# Mow Town — Progression

The game's progression, as designed (not all built yet). The reference for the flow is `refs/m2-res_854p.mp4`.

---

## The shape of it: a grid of areas

The world is a **grid of areas**. Each area is overgrown and holds **shops** hidden in its grass. Mowing reveals and
opens them. Shops make money, and money plus levels open the next area.

```
┌──────────┬──────────┬──────────┐
│  Area 1  │  Area 2  │  Area 3  │ ...
│ 2 shops  │ 1+ shop  │          │
│ (eggs,   │          │          │
│  cows)   │          │          │
└──────────┴──────────┴──────────┘
```

- **Area 1** (the current starter level) has **2 shops**: the Chicken Den (eggs), then the Cow shop (milk, cheese,
  butter).
- **Next area:** open both shops in an area and reach **level X**. The next area of the grid then unlocks, with its
  own grass to mow and its own shop(s).
- **The quest in between:** to open a shop, the player has to **mow the area** around it (the grass is what keeps it
  out of reach; each area's grass is tougher and needs better blades: see "Mowers, blades and grass" below).

---

## Mowers, blades and grass: the mowing progression

Three things grow together, and each one shows on screen:

- **The mower:** how wide it cuts, how fast it goes, how much the bag holds, and how it looks.
- **The blades** under it: the **cutting power**, meaning which grass it can cut.
- **The grass** in each area of the grid: **one type tougher per area**, so every new area asks for better blades.

### The mower: manual → motorized → driven, quickly; then bigger and a new colour

The player gets all three kinds of mower **early and cheaply**. After that, the driven mower keeps **growing and
changing colour**.

| # | Mower | Kind | Grass to unlock | Cut width | Bag |
|---|-------|------|-----------------|-----------|-----|
| 1 | Reel Mower | manual (pushed, no engine) | the start | 0.9 | 100 |
| 2 | Push Mower (red) | motorized (pushed, engine) | 100 (the first full bag) | 1.5 | 300 |
| 3 | Lawn Tractor (green, x0.85) | driven | 250 | 1.8 | 700 |
| 4 | Big Tractor (blue, x1) | driven, bigger | 2,500 | 2.4 | 1,400 |
| 5 | Turbo Tractor (red, x1.15) | driven, bigger | 8,000 | 3.0 | 2,600 |
| 6 | Mega Tractor (gold, x1.3) | driven, bigger | 22,500 | 3.7 | 4,500 |
| 7 | Monster Tractor (purple, x1.45) | driven, bigger | 60,000 | 4.4 | 7,500 |
| 8 | Giant Tractor (teal, x1.6) | driven, bigger | 150,000 | 5.2 | 12,000 |
| 9 | Titan Tractor (black, x1.75) | driven, bigger | 325,000 | 6.0 | 18,000 |
| 10 | Colossus Tractor (white, x1.9) | driven, bigger | 700,000 | 6.8 | 26,000 |
| 11 | Behemoth Tractor (pink, x2.05) | driven, bigger | 1,500,000 | 7.6 | 38,000 |

- The **Push Mower** comes with the **first full bag** (100 grass, the reel's bag): the first upgrade is quick. It's
  faster and cuts much wider.
- The **Lawn Tractor** comes **right after the first zone**: 250 grass, less than one Push Mower bag (300). What's
  left in the bag from the Front Yard plus a short stretch of the park buys it. Riding is the fun part, so it comes
  quickly. It starts small (x0.85, the seated player and the bag on its
  back in proportion), and each tractor after it is bigger.
- From then on every mower is the tractor again, **bigger** (its `rideScale`) and **repainted** (its `tint`).
- **The camera pulls back with the mower** while mowing: further out the wider it cuts (+0.17 of the view per unit of
  cut width past the reel's: the Lawn Tractor about 1.15x, the Monster about 1.6x, the Colossus about 2x; a mower's own
  `cameraZoom` overrides it). Every upgrade shows more of the map being cleared. In a den (or a no-mower area) it
  eases back to the standard view, where there's more to see up close.
- Every mower has the **same base power (2)**. The mower never decides what grass can be cut: the blades do.
- The reel and the push mower keep their blades **hidden**. The blades show from the tractor on, when the Blades
  station comes in.
- **Prices are rounded** to two figures, in half steps (247,430 → 245,000), so incremental prices read well.

### Blades: the cutting power you can see

The blades sit low against the mower's front edge (a reel mower's: in front of its wheels), spinning: steel bars with
red tips, and a faint disc where they sweep. They span the cut, so what you see is what cuts. Each level is **one more
cutting power**:

| Blades level | What's under the mower | Cutting power | Cuts at full speed | Grass to unlock |
|---|---|---|---|---|
| 0 | 1 small blade | 2 | Grass | the start |
| 1 | 1 big blade | 3 | Tall Grass | 75 |
| 2 | 2 blades | 4 | Thick Weeds | 600 |
| 3 | 3 blades | 5 | Brambles | 4,500 |
| 4 | 4 blades | 6 | Thicket | 15,000 |
| 5 | 5 blades | 7 | Dry Grass (orange) | 40,000 |
| 6 | 6 blades | 8 | Fire Brush (red) | 100,000 |
| 7 | 6 blades (2 x 3) | 9 | Bushes, Dense Bushes, Young Trees | 250,000 |
| 8 | 8 blades (2 x 4) | 10 | Trees; Big Trees laboured | 350,000 |
| 9 | 9 blades (3 x 3) | 11 | Big Trees at full speed | 700,000 |
| 10 | 10 blades (2 x 5) | 12 | Giant Trees at full speed; Rocks laboured | 1,100,000 |
| 11 | 12 blades (3 x 4) | 13 | Rocks at full speed; Boulders laboured | 2,000,000 |
| 12 | 15 blades (3 x 5) | 14 | Boulders at full speed | 3,750,000 |

- **Cutting power = the mower's power (2) + the blades level.**
- **A full bag doesn't stop the mower:** it keeps cutting and chewing everything it can (grass, bushes, trees), so it
  never gets boxed in on the way to sell and the area still gets done; what doesn't fit in the bag is lost. Only
  growth two or more powers too tough is a wall, full bag or not.
- Full speed takes power **above** the grass's toughness. Grass exactly as tough as the power is cut, but it labours.
  That's why every mower has power 2: the first area's grass (toughness 1) goes down at full speed from the start.
- Grass **one power too tough** still goes down, but slowly: the mower chews through it (`chewSec`, 1.2 s a cell).
- Grass **two or more powers too tough** is a wall. A **padlock badge showing the blades it takes** floats over it, and
  pushing in says "Thick Weeds needs 2 blades: feed the Blades station".
- When the area being mowed has grass the blades can't handle and the bag holds enough for the next blades, the guide
  arrows lead to the **Blades station**.

### Grass: one type tougher per area

The grid is incremental, so the grass is too. Each area grows **one grass type**, a step tougher than the area before
(its `fill`, capped by its `maxGrass`). Tougher grass is also worth more per cell.

| Area | Grass | Toughness (power needed) | Clippings a cell | Blades it takes |
|------|-------|--------------------------|------------------|-----------------|
| 1. Front Yard | Grass (short: grassScale 0.6) | 1 | 2 (valueScale 2) | 1 small (the start) |
| 2. Starting Park | Grass (full height) | 1 | 1 | 1 small |
| 3. The Wilds (the Chicken Den) | Tall Grass | 2 | 2 | 1 big |
| 4. next area | Thick Weeds | 3 | 4 | 2 |
| 5. next area | Brambles | 4 | 7 | 3 |
| 6. next area | Thicket | 5 | 11 | 4 |
| 7+ | Dry Grass (orange), Fire Brush (red), then more | 6, 7, ... | 16, 24, ... | 5, 6, ... |

**Section 4** (east of the Wilds) is thick weeds with bramble spots, plus an orange Dry Grass field and a red Fire
Brush field: patches only far better blades get through.

**Grass patches** are their own grass all over: they ignore the area's `maxGrass` and get no spots, so a patch
evens out the ground it covers with its grass. The area's own fill is still capped by `maxGrass`.

The first two areas are the same grass (the yard's just shorter): they're where the player gets the three kinds of
mower, before the blades come in. The yard's grass gives **twice the clippings** (its section's `valueScale` 2):
about 450 for clearing it, which pays for the Push Mower (100) and the Lawn Tractor (250), so the player leaves the
first zone riding. From the Wilds on, every area is one grass type tougher.

A new area therefore asks for **the next blades** (and pays for them with its richer grass), while the mower is what
makes clearing it quick. The rhythm per area: arrive, hit the wall of tougher grass, feed the Blades station, see the
new blades on the mower, mow it all.

### After grass: bushes, then trees (built)

Grass is only the start of what the mower clears. The ladder keeps going, so the game stays incremental all the way:

1. **Grass** of every kind, each area's taller and a different colour (the table above).
2. **Bushes:** dense clumps that have to be **dug out**. Much tougher than any grass, they take the higher blades and
   chew slowly at first. A cleared bush leaves a hole of earth and gives far more clippings.
3. **Trees:** the top of the ladder. **Chopped down** by the biggest mowers with the most blades: the tree shakes, falls
   and leaves a stump. Each one pays a lot.

Bushes and trees are **part of the mower progression**, not a separate tool: the same blades and power decide what can
be cleared, and a new area full of bushes (then trees) asks for the next blades just like tougher grass does. Every
step looks different (colour, height, shape), so the player sees the progress on screen.

| Growth | Toughness | Clippings | Where | Clears at full speed with |
|---|---|---|---|---|
| Bush | 6 | 60 | Section 5 | blades 5 (power 7) |
| Dense Bush (darker) | 7 | 110 | Sections 5, 6 | blades 6 |
| Young Tree | 8 | 200 | Sections 6, 7 | blades 7 |
| Tree | 9 | 380 | Section 7 | blades 8 |
| Big Tree (paler, tall) | 10 | 700 | Sections 7, 8 | blades 9 (blades 8 labours) |
| Giant Tree (pale, very tall) | 11 | 1,200 | Sections 8, 9 | blades 10 |
| Rock (breaks into rubble) | 12 | 1,600 | Sections 8, 9 | blades 11 |
| Boulder (big, grey) | 13 | 2,600 | Section 9 | blades 12 |

How they work (`game/world/Growth.ts`):
- **Solid** until cleared: the player walks round them, the mower stops at them.
- **Chewed by power**, like grass: more power than it takes clears it quickly, as much labours, one short chews slowly
  (it shakes, chips fly, the mower's held back), two or more short is a wall and says the blades it takes.
- **Cleared:** a bush squashes into the ground leaving a patch of earth; a tree falls over away from the mower and
  sinks, leaving a stump. Its clippings go into the bag (a full bag still clears them, nothing bagged).
- **Placed per area:** the area's `growth` (a type and how many per square unit), scattered at seeded spots (the same
  every game), off props, pavements, dens and stations, spaced apart. Restoring an area clears what's left of it.
- **In the data:** the types are `growth` in ui/mow.json (models from the KayKit forest pack, a tint each); each area's
  `growth` list is in the level.

Grass per area from section 5 on: section 5 brambles (thicket spots), section 6 thicket (dry grass spots), section 7
dry grass (fire brush spots), sections 8 and 9 fire brush.

Rocks are cleared like the rest: chewed by power; when one goes it jolts, crumbles down and leaves a few bits of
rubble.

### After the last mower: stations pay money, and the power-up cards (planned)

Once the last mower (and the last blades, the biggest bag) is bought, there's nothing left to upgrade with grass:

- **The upgrade stations just give money.** Grass poured into them is paid out as cash, so mowing always pays.
- **A power-up zone** opens: a square to stand on that offers **3 cards**, exactly like the UFO game does. Pick one:
  each card **improves a few attributes** at once (for example: cut width, speed, bag size, money per clipping, chewing
  speed on tough growth). New cards come after a while or for a price, so there's always another boost to chase.

### POWER-UPS: spending the money (built)

The money the dens, the barn and the ATMs earn has its own place to go: a **POWER-UPS** button on the HUD (under the
money and bag pills, with a "!" while one's affordable; it shows from the first mower). It opens a list like an
incremental game's, each row a track with its level, its effect now → next and a BUY button (MAX at the top):

| Power-up | Each level | Levels | First price (x per level) |
|---|---|---|---|
| Speed | +4% walking / driving speed | 25 | $80 (x1.4) |
| Money Gain | +10% money: grass sold and every den / barn payout | 30 | $100 (x1.45) |
| Grass Gain | +10% clippings from every cut (grass and growth) | 30 | $100 (x1.45) |
| Cutting Width | +0.1 cut width | 25 | $120 (x1.45) |
| Sharp Edge | +15% chewing speed on tough grass and growth | 20 | $150 (x1.45) |
| Farm Speed | +8% to the dens: laying, milking, packing, making | 25 | $200 (x1.5) |

The blades stay a grass station (they're the mowing progression); power-ups are all money. The camera zooms out with
the mower, not with Cutting Width. Tuned in ui/mow.json `upgrades` (tab `boosts`).

### Where they're bought: three stations

Upgrades are bought at **stations**: squares on the floor fed with the bag's grass (no money, no menus). A visit's pour
takes time by its size: about 100 grass or less goes in at once (a quarter of a second), more takes longer, never over
1.6 s, so early upgrades happen the moment the player steps on. Each area that has them has three, side by side:

- **Mower:** the next mower on its stand (a driven one: the tractor itself, in its colour).
- **Blades:** the next blades on the stand, spinning.
- **Bag:** a bigger bag, in the next bag's colour. Each bag level has its own colour (tan, green, blue, red, purple,
  orange...), and the player wears it: what the station shows is what they'll carry.

### Opening the next areas: restored OR a level (never stuck)

Finishing the Front Yard (the tutorial) opens the **Park and the Wilds together** (both `part: "after-yard"` in the
level): the player picks where to mow. Stations and the wardrobe tied to the Wilds come out then too.

Every area after that opens on **whichever comes first**:
- the area before it is **restored**, or
- the player reaches its **level** (`sections[].openLevel`, set in the level).

So a player who can't finish an area (grass too tough, a bush wall) still gets the next one by levelling up. Nothing
to pay. When it opens, the camera glides over to show it, and it's said.

Until then a **white fence runs all round it**, with a sign on its side facing the way in saying both ways:
"RESTORE THE WILDS / OR REACH LEVEL 10".

| Area | Opens when | Grows |
|---|---|---|
| Section 4 (east of the Wilds) | the Wilds restored, or level 10 | thick weeds (brambles spots) |
| Section 5 (north of section 4) | section 4 restored, or level 13 | brambles; bushes, dense bushes |
| Section 6 (west, the Wilds' mirror) | section 5 restored, or level 15 | thicket; dense bushes, young trees; **the Cow Barn** |
| Section 7 (north-east) | section 6 restored, or level 17 | dry grass; young trees, trees, big trees |
| Section 8 (end zone, bigger) | section 7 restored, or level 19 | fire brush; trees, big trees, giant trees, rocks |
| Section 9 (the last end zone) | section 8 restored, or level 21 | fire brush; giant trees, rocks, boulders |

The island (its deck and fence) wraps every area. There's no "city complete" any more: the map just carries on, area
after area.

**Never stuck:**
- Everything bought with money pours in a bit at a time, from carried money first and then the den's piles, and stays
  paid between visits. That covers hens, the conveyor, the truck dock and areas.
- The eggs keep making money.
- As costs climb, the cheaper next area becomes the better deal: that's what pushes the player on.

### The order things appear in (the start)

Nothing is offered until the player has something to spend:

1. **The start:** no stations around, easy short grass in the yard, the reel mower.
2. **The bag fills:** the **Mower station** pops up.
3. **The Lawn Tractor is bought** (the second mower): the **Bag station** and the **Blades station** appear (the
   Wilds' tall grass needs the big blade). Until then the only station is the Mower's, so the first two upgrades are
   the focus.
5. **The Wilds open:** the **wardrobe** comes out. The **ATM** (grass to money) waits until the **Chicken Den** is
   found too (`afterDen: "chicken"`). No selling or dressing up before: the start is only mowing and upgrading.
   - **No wardrobe tutorial:** no forced first hat and no arrows to it. It's just there to visit.

Once the Front Yard is done and the player has left it, where they stand is saved every 2 s, but only on clear
ground: nothing solid there and no grass too tough to cut. The next session starts there. A full bag shows a red "! FULL"
badge on the backpack in the world.

In the level: a pad's `appearsWhenFull` (the first station) and `afterTool` (the mower it waits for); the ATM and the
wardrobe's `section` (`wilds`); an ATM's `afterDen` (a den id it waits for). No-mower areas (🚶) are bare ground too,
like a bare patch: no grass grows in them. Station squares (pads, ATMs, wardrobes) are always bare: no grass grows on them.

### In the data

- **Mowers:** `ui/mow.json` → `tools` (`price` in money; a station takes price ÷ `clippingPrice` in grass).
- **Blades:** `ui/mow.json` → `upgrades` → `blades`, with its prices level by level in `prices`. Their look is
  `bladeLevels` (`count` side by side; `size` = how much of the cut each spans).
- **Where the blades and the bag sit on the tractor:** editor → 🚜 Tractor tab.
  - **Blades:** pick a Blades level, then set its blades' position and width on the tractor. Add or remove levels there
    too; the Blades upgrade's levels follow.
  - **Layout of each level:**
    - **Alternate:** blades side by side, neighbours staggered ahead and behind.
    - **Grid:** rows × columns, evenly spaced. 1 × 4 is four in a straight line, 2 × 2 a square.
    - In mow.json this is `bladeLevels[i].layout`, plus `rows` and `cols` for a grid.
  - **Bag:** the Bag section sets where the rucksack rides.
  - **On every tractor:** both are in the tractor's own frame, so they sit the same on every driven mower (each is only
    scaled by its `rideScale`).
  - **In mow.json:** `tractor.blades[level]` and `tractor.bag`. A level that hasn't been placed sits against the
    tractor's front, across the cut.
- **Grass types:** `ui/mow.json` → `grass` (`resistance` = power needed, `value` = clippings a cell).
- **Each area's grass:** the level's `sections` → `fill` / `maxGrass`, set in the editor.
- **Stations:** the level's `farm.pads` (`kind`: `tool`, `blades` or `capacity`). The editor has a button for each.
- **Code:** `game/player/MowerBlades.ts` (the blades), `MowProgress.power` (power = mower + blades), and
  `MowConfig.bladesFor()` (the blades a grass takes).

---

## A shop's life

Every shop follows the same pattern; the chicken den is the first and the template.

### 1. Found
A shop **opens at a player level** (the den's `level`, 6 for the Chicken Den: players reached 5 too early). Players who reach it early got swamped
by it, so until that level:
- its **gate is boarded up**, with a big padlock on the boards;
- its sign says **REACH LEVEL 6**;
- it can't be entered.

At the level the **camera glides over to show it** (the player waits a moment): the padlock flies off spinning, the
boards sink into the ground, the sign pops up without its level, confetti, a fanfare, and "CHICKEN DEN UNLOCKED! MOW
YOUR WAY TO IT". Then the camera glides back and the player has control again. Mowed up to its gate, it opens with its
first producer (the first hen). The level is set in the editor (den: "Opens at level").

### 2. Manual: the player does every step
The loop for eggs:

1. **Hens lay eggs.** They pile up by the hens (a pile with a limit).
2. **The player picks the eggs up** and carries them.
3. **The player drops them into a machine.** There are two machines:
   - the **egg machine**: normal eggs packed;
   - the **gold egg machine**: turns eggs into **gold eggs** (worth much more).
4. **The machines output their goods** (stacked by the machine). The player picks them up.
5. **The player sells:**
   - **customers** walk in on **one side** of the shop (a counter they queue at);
   - **trucks** come in on **the other side** (a road, a dock where they park and load).
6. **Customers and trucks pay**: the cash piles up on the floor by each counter. The player picks it up.

### 3. Automated: upgrades take steps off the player
Bought with money (and levels), one by one:

- **Conveyor belt:** hens to the machine. The eggs ride the belt straight into the egg machine (no picking up eggs).
- **Gold egg automation:** later, the gold egg machine is fed automatically too (at first the player carries eggs
  to it).
- **Helper for the customers:** a hired worker carries the goods from the machines to the customer counter.
- **Helper for the trucks:** a second worker carries the goods to the truck dock.
- (Also: more hens, more machine capacity, etc.)

### 4. Passive
Once a shop is fully automated, it **always generates money**: it keeps working without the player.

---

## Money gets bigger with each shop

- Each shop's income is **incremental**: the next shop gives **much more money** than the one before.
- **Shop 1: Chicken Den.** Eggs, gold eggs.
- **Shop 2: Cows.** Milk, then butter or cheese. Same pattern: manual first, then belts (and later helpers) automate
  it. Opening it needs **enough level**.
- **Shop 3: Crops (planned).** Wheat that grows by itself, sold as wheat or turned into bread. The same pattern again:
  the belt splits the wheat between selling it raw and the bakery; customers and trucks order wheat, bread or both.
- **Shop 4+:** in the next areas of the grid, similar pattern, more money again.

### The Cow Barn (built)

In section 6 (the Wilds' mirror), opening at **level 16**, boarded up until then like the chicken den
(`farm.cowDen` in the level; `game/world/CowDen.ts`):

1. **Cows** (the library cow) stand in stalls along a red barn at the back. Each puts a **milk bottle** on its spot
   every 3 s (8 at most there). The first cow is free; 5 more cost money and a level ($2,000 at 16 up to $15,000 at 20).
2. **Pick the milk up** and choose where it goes:
   - the **butter churn** (west): 2 milk make a block of **butter** ($60);
   - the **cheese press** (east): 3 milk make a **cheese** wheel ($90).
   Each has its own MILK square and its own grid of what it's made.
3. **Customers** come out of the people tunnel and queue at the counter on the barn's **east** side. Each orders
   **butter, cheese or a mix** (their bubble shows each and how many).
4. **Trucks** come along their own path on the **west** side and park by the dock ($15,000, level 18), ordering a big
   mix the same way.
5. Each side pays onto **its own cash pile**.
6. **The conveyor belt** ($25,000, level 20, once every cow's owned): the milk rides it along the stalls, round behind
   the machines, and is **split between the churn and the press**, taking turns (a full one skipped).

The first visit is short, as in the chicken den: the first spot is full of milk, the machines make at once and hand
the goods straight to a player standing at them, and the first customers each want one thing.

In the editor: the barn's yard (move, resize, name, gate, level), its truck dock and its trucks' path points (move;
"They park here"). Its truck road and the customers' walk from the tunnel are placeholder pavements (`road-cows`,
`path-cows`) to be laid properly.

### SELL x2 (from the dig game)

While the bag is full (from the Lawn Tractor on), a **SELL x2** button shows bottom right: a pile of cash on a turning
shine, a video badge. Tapping it sells the whole bag right there at **double** the money. The first two are free (a
FREE tag, the hand on the first); after that each is a rewarded video (a closed or failed video sells nothing).

---

## The player's level

- XP from mowing, upgrades, finding and opening shops, producing and selling.
- Levels gate what can be bought: producers, automation, shops, and the next area.
- **The floor arrows guide only up to level 4** (`farm.levels.guideUntil`). Past it they're gone: by then the player
  knows the loop (mow, fill up, feed the stations), and the arrows would only nag.
- Shown top-left (level badge and XP bar).

---

## Layout of a shop (from the reference video)

```
            back fence: producers (hens in a row)
     ┌──────────────────────────────────────────┐
     │  [hens] → conveyor belt → [egg machine]   │
     │                          [gold machine]   │
     │       output stacks + pickup squares      │
customers  │                                    │  road / trucks
 walk in → │ [customer counter]   [truck dock] │ ← trucks park
 (one side)│   cash pile             cash pile │   (other side)
     └──────────────────────────────────────────┘
               unlock squares (price on the floor)
```

### Placing a shop's parts (the editor)

In the editor's 🏙 Town tab every part of the Chicken Den is a marker you can drag:
- each hen's **egg spot**;
- the **EGGS drop** square, the **packing machine** and its **PACKS out** grid;
- the **sell counter**, the **SELL** square and the **cash** square;
- the **gold machine** with its packs drop and its packs out (planned, in yellow).

Positions are kept from the den's middle (`farm.dens[].parts` in the level), so the parts move with the den. A part
that's never moved stays where the den's own layout puts it. Each marker has "Back to the den's own layout".

The planned gold machine is shown in the editor only. It's there to lay out the line before it's built:
1. Hens' eggs → conveyor → EGGS drop → packing machine → PACKS out.
2. Then drop or sell, or put the packs on the gold machine.
3. The next upgrade links the two machines, so gold packs come out on their own.

The PACKS grid is 2 × 2 with big packs, five high on each slot (`traySlots` 4, `trayLayers` 5: 20 packs).

**No soft locks:**
- Eggs and packs each have their **own carry limit** (`carryMax` 20 each), so a backpack full of eggs can still pick up
  packs.
- The machine holds 60 eggs.
- The eggs from the hens are drawn bigger than carried ones.

**No-mower areas:** in the editor, "🚶 No-mower area" draws a rect where the player walks with the mower parked, as in a
den. Use it over the customers' path, by counters, anywhere mowing over people looks wrong. In the level:
`footAreas`.

**Customers come out of the road tunnel** west of the den (City2 Road Tunnel 001):
- **Spawn:** their spawn area (`spawns`, kind `people`) sits just inside its mouth.
- **Dark cube:** a **shape cube** deeper in the tunnel hides where they pop in.
- **Shape cubes:** editor → ⬛ Shape cube. Plain unlit boxes with a colour, height and lift, turned and sized like
  anything else, not solid. In the level: `shapes`.
- **Fence gaps:** where a pavement runs to the island's edge (the road into the tunnel), the island's fence is cut:
  rails, kerb and posts.

**Conveyor buy square:** it's a den part you can drag, so it doesn't overlap the hens. Without a placement it sits at
the belt's start.

### Trucks

The trucks' path (🚚 Truck path points) has one point marked **"They park here"**:
1. Trucks drive in to it, stop, and load.
2. The next trucks queue behind (`trucks.queue`, 3 on the way at once).
3. Loaded, a truck drives on through the rest of the points and leaves at the last one, not back through the queue.

With no park point, they park at the end and drive back the same way.

The trucks are the small cargo trucks from the library (City2 Car 16 and Car 09, taking turns: `trucks.models`). Later:
container trucks with more cargo and more money, then boats.

### Customers: their way in and out

Customers walk a path in and a path out, like the trucks (`farm.peopleIn`, `farm.peopleOut`; the editor's 🧍
Customers in / out points, blue and purple):
1. They pop in at the first IN point and walk point to point, then to the queue at the den's counter.
2. Served, they walk from the counter along the OUT points and pop out at the last.
3. **The queue runs back along the IN path** from the counter, one place every 1.5 units. Each customer walks the path
   only as far as their own place, facing the one ahead, and moves up along it (round its corners) as the queue
   advances. If the queue is longer than the path, the last places carry on back past the first point.

With fewer than 2 points in either, they use the people spawn area and walk straight up the den's path (as before).
The seeded paths copy that: from the road tunnel to the den and back. Moving them frees the den's west side for an exit
to the boats (coming: boats to fill for big cash).

The order bubble follows the person's head bone, so it stays over the head while they walk and idle.

### The den's first visit: short, one trip each way

Playtests showed the first visit had too much walking back and forth for eggs, and people got bored. Now it's one
pick-up, one drop, one sale:
1. **Lots of eggs are already waiting** on the first hen's spot (`farm.eggs.startEggs`, a full spot by default: 8).
   One walk over them picks them all up.
2. **Drop them on the packer** (its EGGS square). During the lesson it packs **at once** (a pack every 0.15 s) and
   hands the packs **straight into the player's backpack** while they stand by it. No trip to the packs grid.
3. **The first customers each want 1 pack**, as many as the waiting eggs make (8 eggs = 2 packs = 2 customers).
   After them, customers ask for 1–3 as usual.
4. **Take the cash.**

A hand points at the next step all the way, following what's going on so it never gets stuck: the eggs, the EGGS
square, SELL, then the cash square.

Taking that first cash ends the lesson (`den.tutorial`), and only then does the truck dock's buy square pop in. Older
saves that are further along (trucks, belt or a second hen) skip it.

Walking into a den with grass in the bag sells it there and then, as at an ATM. A full bag just says "BAG FULL!",
with a small "!" on the bag itself.

### Den sounds and piles

- The den's sounds (eggs, packs, cash) play only with the player within 10 units of its fence. The den keeps working
  out of earshot. No thump for every pack made.
- **Both piles fill:** with the gold belt, packs ride to the gold machine while the belt has room. Once the gold side's
  backed up (its grid full), new packs go onto the white grid until that's full too.
- Gold eggs are bright yellow (less metal, warmer glow).

### The first conveyor belt (built)

**Unlock:** once every hen is owned, a **CONVEYOR** square appears at the belt's start, with its price and level
(`farm.eggs.belt`: $1200, level 8). The player pays on it like a hen.

**Running:** the belt pops in and runs.
1. Each egg spot sends its eggs onto it, one every `takeSec`, where the belt passes nearest.
2. They ride it at `speed`, `spacing` apart, to its end.
3. At the end they drop into the packing machine.
4. While the machine is full, eggs queue at the end and the spots keep their eggs.

The player still picks up the packs and sells them.

**Path:** drawn in the editor as **belt points** (green post = the start and its buy square, red = the end, by the
EGGS drop).
- A belt point has "+ Point after this" and "− Remove this point".
- "Back to the default path" clears it.
- Without a drawn path, the belt runs from the egg row's far end along its front to over the EGGS drop, then down
  into it.
- In the level: `farm.dens[].parts.belt`.

### The helper, the gold machine and the gold belt (built)

Each is bought on its own square, money poured in, appearing one after another:

1. **Hire helper** (`farm.eggs.helper`: $2,500, level 9). It appears once the conveyor runs.
   - A worker in the den's uniform (blue shirt, dark trousers, no hat) with a blue backpack the packs stack on.
   - Round and round: picks up to 4 packs from the grid with the **most** packs, hands them to the customers at
     SELL, and takes the cash pile to the player (money in the wallet).
   - **Truck helper** (`farm.eggs.truckHelper`: $4,000, level 11): appears once the truck dock's open. Same loop, but
     it carries 6 packs to the parked truck and takes the truck's cash pile.
   - **Everyone takes either kind** (customers, trucks, both helpers); a gold pack just pays more. Helpers go to the
     fuller grid, so once everything's gold the plain grid runs dry and everyone's on the gold one.
   - **Trucks:** four path points. In up one lane, park by the dock, turn, and out down the other lane. The queue and
     the leavers never overlap.
2. **Gold machine** (`farm.eggs.gold`: $5,000, level 10). It appears once the helper's hired.
   - Packs dropped on its **PACKS** square become gold packs (red trays of golden eggs), one every 1.5 s, onto its
     2 × 2 grid.
   - A gold pack sells for $35 (a normal pack: $10). Customers pay per pack, gold or not.
   - Gold packs have their own carry limit.
3. **Gold belt** (`farm.eggs.goldBelt`: $9,000, level 12). It appears once the gold machine's built.
   - Every pack the packing machine makes rides it into the gold machine: everything's gold.
   - The packing grid goes once it's empty, and so does the gold machine's PACKS square.

**In the editor:**
- Every buy square (conveyor, helper, gold machine, gold belt) is a den part you can drag.
- Every square the player stands on (EGGS, SELL, cash, PACKS, the buy squares) has **Width** and **Depth**, so its
  words fit.
- The gold belt's path is drawn like the egg belt's, with yellow posts. Without one, it runs straight from the packs
  grid to the gold PACKS square.

From the video, the things that make it feel good:

- **Everything is physical.** Eggs, boxes and cash are visible stacks that fly between the player, machines, counters
  and trucks. The player's carried stack is tall and shows **MAX** when it's full.
- **Unlocks are squares on the floor** with their price written on them (60, 180, 440…). Standing on one pours the
  money in, and the thing pops into place when it's paid. No menus.
- **Trucks load themselves** from a counter the player keeps stocked, then drive off with the load showing. The next
  one pulls in.
- **Customers queue** at their counter, each with a bubble showing what they want and how many.
- **Workers**, once hired, walk the same routes the player did.
- A **new area** opens with a burst: new floor, new squares to buy.

---

## Analytics: the progression funnel

The farm game's progress export (Poki) holds only the progression, like mob's levels, so it shows time and drop-off
per step:
- `step / <nn>-<name>`: **start** when the step becomes the goal (also at each session's start while it still is),
  **complete** when done. The `lefts` column is where players quit. Steps, in play order (`FARM_STEPS` in
  game/analytics/GameAnalytics.ts): move, first-cut, bag-full, station, mower-01, yard-done, bag-01, mower-02,
  blades-01, park-done, mower-03, den-found, den-egg, den-pack, den-sale, den-lesson, hen-02, trucks, wilds-done,
  mower-04, belt, helper, gold, section-4-bought, truck-helper, gold-belt, mower-05, section-4-done, mower-06.
- `level / <nn>` complete: player levels. `session / new | returning` start: the base.
- Everything else uses non-progress actions and lands in Poki's other exports:
  - trophies: `treasure / <id> / found`
  - the wardrobe: `shop / <item> / bought | equip`
  - playtime: `playtime / min-<n> / reached`
  - upgrade levels and more hens: `bought`
  - panels and tabs: `interact`
- Gameplay (gameplayStart / gameplayStop) starts on the first move, stops while the map or another panel is open, and
  starts again on the next move.
- Save version 7: this layout starts everyone on fresh data.

Read an export with `node games/mow/data/funnel.mjs <progress-events.csv>` (older exports are mapped from their old
event names).

## Where it stands now (farm test)

Built: mowing with upgrade stations fed by grass (mower, blades, bag) appearing one after another, the mower ladder
(reel → push → tractor, then bigger and repainted), visible blades (1 small → 1 big → 2, 3, 4...) as the cutting
power, the grass stepping up per area (yard and park: grass, wilds: tall grass), bag colours per level, the player's
level bar at the top (the 2D library's level slider), ATMs (grass to money), the bigger starter area, the Chicken Den
(hens laying on the floor, picking eggs up, one packing machine, trays, customers, trucks on their own path, cash
piles), player levels.

Also built: the conveyor belt, the gold egg machine and gold belt, both helpers, customer paths in and out, area
unlock squares (level + cash).

**Rewards:** cleaning an area pays its bonus (Front Yard $150, Park $600, Wilds $3,000, section 4 $8,000; it was
$65 / $160 / $500 / $1,250). **Trophies** are scattered under the grass of each area (seeded spots: 1 in the yard,
5 in the park, 4 in the Wilds, 4 in section 4; $40 up to $5,000). Cutting one shows a "TROPHY!" toast and pays at once.
There's no Trophies button in the farm game.

**HUD:** the area's bar sits right under the level bar (clear of its badge), the bar and its reward coin as wide as
the level bar's track.

**Music:** Benjamin Andrews' "Redding Rainbow", low (`music.volume` 0.12 in ui/mow.json).

Also built: the den opening at a level (boarded gate below it), and the short first visit (eggs waiting, instant
packing into the backpack, first customers wanting one pack).

Also built: areas opening when the one before is restored or at a level (fenced with a sign until then), the island
round every area, bushes and trees (sections 5–7), blades 8 and 9, three more tractors, the Cow Barn (butter and
cheese, its belt splitting the milk, customers and trucks ordering a mix), SELL x2.

Also built: the two end zones (sections 8 and 9: giant trees, rocks, boulders), blades 10 to 12, the Behemoth, the
POWER-UPS panel.

Not built yet: passive income, the cows' helpers, the crops shop (wheat, bread), the boats, the grid of areas beyond
section 9, stations paying money after the last mower, the power-up card zone.
