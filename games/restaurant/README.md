# Restaurant

## Description

Run your own little restaurant: take each customer's order, cook it just right at the kitchen bench and keep them happy!

## Controls

- **Cook:** tap the raw patties to put one on the pan; when it's done, tap the pan to put it on the bun.
- **Build:** tap the toppings (cheese, lettuce, tomato) to stack them on the burger.
- **Serve:** tap SERVE to hand it over (TRASH starts the burger again).
- **Menus:** tap the buttons.

---

## How it plays (the MVP)

A day is three customers. Each walks up to the counter and orders a burger (a patty and one to three toppings, shown in
a bubble over them). The camera drops to the kitchen bench: cook the patty, stack the toppings, SERVE. The camera swings
back: exactly what they asked for and they cheer, pay and tip; anything else and they're sad. After three, the day's
card: stars (customers served right) and coins; NEXT DAY.

The plan grows from here: more customers and tables, more dishes, a supermarket run to buy ingredients with the coins,
and a different minigame for each phase.

## Where things are

- `index.ts`: boot (platform, font, UI atlas, the save), then the scene.
- `game/scenes/RestaurantScene.ts`: a day: customers, the two camera views, the bench's taps, serving, the results.
- `game/world/Kitchen.ts`: the set (KayKit Restaurant Bits: the bench, stove and pan, plate, toppings; the dining room)
  and the burger being built.
- `game/world/Customers.ts`: the customers (UFO's people and their walk and idle).
- `game/data/Recipes.ts`: the ingredients and the orders.
- `game/ui/`: the HUD (coins, the order bubble and ticket, SERVE / TRASH, the day's card) and its parts.

Assets: `raw-assets/models/kitchen{m}` (from `library3d/files/KayKit_Bits_Bundle1_1.1/Restaurant Bits`),
`raw-assets/models/people{m}` (UFO's), `raw-assets/images/ui{tps}` (the Layer Lab UI pack). `npm run models`,
`npm run image`, `npm run font` (with `GAME=restaurant` in `.env`).
