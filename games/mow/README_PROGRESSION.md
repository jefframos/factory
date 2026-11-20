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
  out of reach; tougher grass needs better mowers).

---

## A shop's life

Every shop follows the same pattern; the chicken den is the first and the template.

### 1. Found
Mowed up to (its gate), it opens with its first producer (the first hen).

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
- **Shop 2: Cows.** Milk, cheese, butter. Same pattern: manual first, then belts, machines and helpers automate it.
  Opening it needs **enough level and enough money**.
- **Shop 3+:** in the next areas of the grid, similar pattern, more money again.

---

## The player's level

- XP from mowing, upgrades, finding and opening shops, producing and selling.
- Levels gate what can be bought: producers, automation, shops, and the next area.
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

## Where it stands now (farm test)

Built: mowing with upgrade stations fed by grass, ATMs (grass to money), the bigger starter area, the Chicken Den
(hens laying on the floor, picking eggs up, one packing machine, trays, customers, trucks on their own path, cash
piles), player levels.

Not built yet: the conveyor belt, the gold egg machine, the helpers, passive income, the Cow shop, the grid of
areas.
