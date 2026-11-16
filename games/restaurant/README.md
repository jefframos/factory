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

Seated service (settings.json `stages[].service: "seated"`: the Small Diner, the Diner, the Restaurant): customers go to
a free seat (the layout's `seats`, each on a chair at a table: a plain table with a menu, ketchup and mustard; the Diner
two tables of 3, the Restaurant four of 4); a seat is free once its last plate's been cleared. Eaten, a plate turns
dirty; the hand always points at a dirty plate, and at a finished dish. From the Diner on (`stages[].patience`, seconds)
one customer at a time waits at the door with a patience bar over them: they sit as soon as a seat's free, and the next
comes in once they have; out of patience, they leave annoyed (an unhappy customer). Without `patience` (the Small
Diner) everyone comes in and they wait as long as it takes. When the station's order camera doesn't show every seat,
the dining view frames them all.

Pizza delivery (`game/scenes/DeliveryScene.ts`, settings.json `delivery`): after a day played with the pizza oven, before
the supermarket (cook, deliver, shop). The town round the restaurant (Town in its 'delivery' mode, the level's buildings)
and a city car (`delivery.car`, `world/DeliveryCar.ts`: a customer sat in it as Mow's / Dig's riders sit in their
tractors, the pizza boxes on its roof) waiting outside the restaurant (`delivery.start`). A box hops onto the roof; the
guide arrows (Mow's and Dig's: `world/GuideArrows.ts`, round the buildings on a car-sized walk grid) lead to a house
(a glowing beacon at its door); there the box hops to the door (`delivery.pay` coins); back to the restaurant for the
next — `delivery.deliveries` times, then the card (the coins into the restaurant's bar). Drive: drag anywhere (a
joystick there: up to go, sideways to steer, down to back up) or the arrow keys / WASD. Stand-alone: Debug panel →
Areas → PIZZA DELIVERY (its own panel: JUMP TO THE STOP, FINISH).

The sundae bar (the Diner on: settings.json `stages[].sundae` — share, `maxScoops`, `maxToppings`, and the flavours,
sauces, toppings it uses; `pay.sundae`): scooped ice cream, in a cone or a bowl, beside the soft-serve machine's simple
cones (`game/world/Sundae.ts`, its look `game/world/SundaeLook.ts`). Two props make it: the one with Id `sundaeFreezer`
(any model as big as the freezer: the game — and the editor — draw a freezer there, six tubs set in its top: vanilla,
chocolate, strawberry, mint, blueberry, mango) and the one with Id `sundaeBar` (the cones, the bowls, the spot it's made
on; behind, three sauces and four toppings). Tap a cone or a bowl, a tub per scoop (up to 3), a sauce, the toppings
(sprinkles, cherry, cookie stick, waffle), then the sundae. Right when it's the base, the same scoops (any order), the
sauce and exactly the toppings asked for; the bubble and the ticket show a picture of the sundae ordered.
Debug panel → Minigames → SUNDAE BAR.

Pizza (the Restaurant stage, from its second day: settings.json `stages[].pizza` — its share of the orders, its
`toppings`, `maxToppings` — and `bakeSeconds`, `pay.pizza`): the customer's bubble shows the pizza they want (a picture
built like the real one, then each topping), and it stays on the ticket while it's made. The camera turns to the oven
and its tables (`game/world/Pizza.ts`, its look `game/world/PizzaLook.ts`). Tap the dough (rolled out on the board),
the sauce, the cheese, each topping asked for (pepperoni, mushroom, onion, tomato, pickles; none: a cheese pizza), then
the pizza: the oven door drops, it slides in and bakes (a ring over the oven), and comes back out browned. Tap it (or
SERVE). Right when it's baked with exactly its recipe. The station is a `pizza_oven` prop in the layout (put it on a
counter: `elevation` 1) and the board is the prop whose Id is `pizzaBoard`: a big kitchen table (a cutting board's put on
it) with a second table behind it for the ingredients (two rows of four). Without a `pizzaBoard`, a board appears on the
oven's left. The supermarket's list then asks for dough, tomatoes, cheese and the toppings. Debug panel → Minigames →
PIZZA.

The plan grows from here: each stage built bigger (a procedural room: floor, walls, doors), tables, new ingredients,
table service (tap a customer to take the order, tap them again to serve), more stations, and later a delivery
minigame. Debug panel (`?dev=1`): Areas jumps to any area.

## Where things are

- `index.ts`: boot (platform, font, UI atlas, the save), then the scene.
- `game/scenes/RestaurantScene.ts`: a day: customers, the two camera views, the benches' taps, serving, the results.
- `game/scenes/MarketScene.ts` (+ `game/ui/MarketHud.ts`, `game/data/Market.ts`): the supermarket and its list.
- `game/ui/Curtain.ts`: the transition between the two.
- `game/world/Kitchen.ts`: the set (KayKit Restaurant Bits: the bench, stove and pan, plate, toppings; the dining room)
  and the burger being built.
- `game/world/IceCream.ts`, `game/world/Pizza.ts`: the ice cream machine's and the pizza oven's stations (each found
  from its prop in the layout).
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

City blocks (SimCity-style): a lawn with "Fill with buildings" (the editor's lawn inspector) is a city block — buildings
stand along its sides facing out to the streets round it, picked by its kind (homes, shops / offices, mixed) and its seed
(🎲 for another mix) from settings.json `town.city.buildings` (each at its height), `setback` in from its edge, `gap`
apart, never over its edge or each other. Draw the roads, then each block's outline just inside them. The filling is
`web/public/cityfill.js`, shared by the game (`game/world/CityBlocks.ts`: the buildings are props to the room — the
delivery's houses among them) and the editor's preview. The delivery's streets have no people; the restaurant's few are
round it.

Prefabs (`levels/prefabs.json`, shared by every level): a station or a table set made once — the ice cream machine on
its tables, the pizza station, the sundae bar, round tables of 3 and 4 seats — and placed as often as wanted (the
level's `instances`: which, where, turned how, at which stages; the game unfolds them when it reads the level). In the
editor a placed one shows on a blue ring (its arrow: its front) and moves / turns whole. To change one: Unpack it (a
group again), edit the group, then the group's ◈ Save as prefab (the same name): every one changes. Any group can be saved
as a new prefab, and the outline's Prefabs ＋ Place… puts one in. A station's ingredients aren't in its prefab: they're
the stage's (settings.json — the burger station's `piles` grid: buns, patties and `stages[].toppings`; the pizza's
toppings; the sundae bar's flavours, sauces, toppings), laid out in the station's grids, so the same station shows more
at a bigger stage.

Level: 🛒 Supermarket opens `levels/market.json` (MarketScene's room, same core/rooms format, one stage): its floor,
walls and props (fridges, shelves), the crate grid (`market.crates`: its middle, columns, gaps — drag it; the game
shuffles the crates each visit and frames its camera on the grid) and the cashier (`market.cashier`).

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
