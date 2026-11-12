# Restaurant

## Description

Run your own little restaurant: take each customer's order, cook it just right at the kitchen bench and keep them happy!

## Controls

- **Build:** tap a bottom bun, the toppings and a top bun to stack the burger on the plate.
- **Cook:** tap the raw patties to put one in the pan; when it's done, tap the pan to put it on the burger.
- **Serve:** tap SERVE to hand it over (TRASH starts the burger again).
- **Shop:** at the supermarket, tap the crates on your shopping list.

---

## How it plays

A day is a few customers (settings.json: 3 the first days, more later). Each walks up to the counter and orders a burger
(one to three toppings, shown in a bubble over them). The camera drops to the benches: a bottom bun, a cooked patty, the
toppings, a top bun, SERVE. The camera swings back: exactly what they asked for and they cheer and pay; anything else and
they're sad. After the day's customers, the day's end: a star per happy customer and a chest of the day's tips. Tap
it: each tap sends one customer's coins into the restaurant's upgrade bar (StageBar). A full bar upgrades the restaurant
(settings.json `stages`: Food Truck, Small Diner, Diner, Restaurant; each a goal of coins). Then the supermarket.
Coins aren't spent anywhere: they're the restaurant's progress.

The supermarket: a floor of produce crates and a shopping list (what the next day's orders use: buns, patties and their
toppings; no quantities). Tap each crate on the list; a crate that isn't on it fails the run (TRY AGAIN, the list
starts over). With the whole list in the basket the next day opens. The first day and the first supermarket visit, a hand points at what to tap next.

The plan grows from here: each stage built bigger (a procedural room: floor, walls, doors), tables, new ingredients,
table service (tap a customer to take the order, tap them again to serve), stations (a pizza oven: a pizza order sends
the cook to the pizza zone), and later a delivery minigame. Debug panel (`?dev=1`): Areas jumps to any area.

## Where things are

- `index.ts`: boot (platform, font, UI atlas, the save), then the scene.
- `game/scenes/RestaurantScene.ts`: a day: customers, the two camera views, the benches' taps, serving, the results.
- `game/scenes/MarketScene.ts` (+ `game/ui/MarketHud.ts`, `game/data/Market.ts`): the supermarket and its list.
- `game/ui/Curtain.ts`: the transition between the two.
- `game/world/Kitchen.ts`: the set (KayKit Restaurant Bits: the bench, stove and pan, plate, toppings; the dining room)
  and the burger being built.
- `game/world/Customers.ts`: the customers (UFO's people and their walk and idle).
- `game/world/Models.ts`: loads the kitchen models and the people, hands out copies.
- `game/data/Recipes.ts`: the ingredients and the orders.
- `settings.json` (read by `game/data/Settings.ts`): the numbers: customers a day, each day's most toppings, the market's goods and prices, cooking
  time, pay, the customers' height and pace. Where everything is (the room, the station, its cameras) is
  `levels/restaurant.json` (the editor); food sizes and tap radii are `LAYOUT` in `game/world/Kitchen.ts`.
- `game/data/RestaurantSave.ts`: the day, where the player is, the coins and the day's orders (through the platform's save, and localStorage).
- `game/audio/RestaurantAudio.ts`: the sounds (from the Ant game's set).
- `game/ui/`: the HUD (coins, the order bubble and ticket, SERVE / TRASH, the day's card), the food pictures (rendered
  from the models) and the UI parts.

Debug panel (`?dev=1`): +100 coins, skip a day, reset.

Assets: `raw-assets/models/kitchen{m}` (from `library3d/files/KayKit_Bits_Bundle1_1.1/Restaurant Bits`),
`raw-assets/models/people{m}` (UFO's), `raw-assets/images/ui{tps}` (the Layer Lab UI pack), `raw-assets/audio`. `npm run models`,
`npm run image`, `npm run font`, `npm run audio` (with `GAME=restaurant` in `.env`).

## The room: levels/restaurant.json (built by core/rooms)

The restaurant round the kitchen is a layout file, `levels/restaurant.json`, in `core/rooms`' format (Dig's hub.json
shape): `floors` (checker rects), `walls` (polylines with `openings`: windows, doors — sliding glass ones open as
customers come and go — and gaps), `props` (model, x, z, rotationY, height / scale, elevation, stretch), `areas`, wall
`setups` and `styles` (walls, floors, doors). Anything can be limited to stages with `from` / `until` (0 Food Truck, 1
Small Diner, 2 Diner, 3 Restaurant): upgrading builds the next stage's room. `customer` is the customers' way in
(outside, just in, the counter). `game/world/RestaurantLayout.ts` reads it. The debug panel's Areas jump to any stage.
`core/rooms/`: Pizza's wall and checker-floor builders and its reactive door, shared (RoomHooks: the bend / occlusion a
curved-world game plugs in), and `Room` (a layout, built at a stage).

## The editor — `npm run editor` (GAME=restaurant)

`web/` (as Dig's editor: server.mjs + public/, three.js from node_modules, no build). One tab, 🏗 Layout: the layout in
3D as the game builds it, with a stage picker (what's there at each stage). Select anything (in the view or the list)
and move / turn / size it with the gizmo (W / E / R) or the inspector: floors, walls (drag the whole wall or a corner;
openings — windows, doors with sliding / double, gaps — as rects), props (from the game's models, or 📚 imported from the
3D library), the burger station (drag its ring to move it all) and its pieces (counters, cooktop, pan, plate, served
spot, customer spot, piles, decor), the customers' way in, and styles (wall colours, floor checkers, doors, wall sizes).
Station cameras: select one, 👁 Look through, frame the shot in the gold 720 x 1080 frame (the game's screen), 📸 Use
this view. Save writes levels/restaurant.json; the running game reloads with it. Imported models: run `npm run models`
before a build.

## Where it's going: stations and the editor (planned)

The restaurant will be laid out in an editor, the way Dig's hub is (`games/dig/levels/hub.json`, edited in its Hub 3D /
Hub 2D tabs): one layout file with the floor, walls and their openings (doors, windows, sliding glass doors, gaps),
props placed by hand (model from the 3D library, position, rotation, height, elevation, stretch), and reveal areas that
open as the restaurant grows (Dig's reveal rules, keyed to the restaurant's stage: the food truck first, then the diner's
rooms, ...). Upgrading reveals areas and cuts gaps in walls — the place visibly grows.

- **Shared room runtime**: done (`core/rooms/`). Pizza, Bandit-controller and Dig still use their own copies; they can
  move onto it (RoomHooks maps to their BendService).
- **Stations** in the layout: a burger station (its pieces: counters, cooktop, pan, plate, the ingredient piles — each
  piece tagged with its role), where the cook stands, the station's camera, which stage unlocks it. Then a pizza station
  (oven: a dish is ready when it comes out), a baking station, ... An order names its dish; the dish names its station;
  the camera goes there. Kitchen.ts is the burger station's runtime, reading its pieces from the layout (done).
- **Dining**: tables and seats, the customers' path (door → counter / table → door) as layout waypoints; table service
  (tap a customer to take the order, tap them to serve) on later stages.
- **Editor**: the Layout tab is in (above). Next: station / dish tabs, settings.json's numbers as a data tab.
- **Delivery minigame (later)**: Mow's / UFO's city (roads, people, their city builder) as the delivery map.
