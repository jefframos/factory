# Translation guide

You are translating the UI text of a casual mobile/web game for players of all ages. Translate each English value in
the JSON file into the file's language (its name is the locale code: `pt-br` = Brazilian Portuguese, `zh-cn` =
Simplified Chinese, `no` = Norwegian Bokmål, etc.). Write it the way a native speaker would see it in a polished game,
not word for word.

## Hard rules (a string that breaks one is rejected)

1. **Keep every key exactly as it is.** Only translate the values.
2. **Keep every `{placeholder}` exactly** — same name, same braces, each one exactly once (`{tool}`, `{price}`,
   `{count}`…). Move it wherever the sentence needs it; never translate the word inside the braces.
3. **Return valid JSON** with the same keys, nothing added, nothing removed, no comments.
4. **Never leave a value empty.**

## Style

- **Tone:** light, friendly, energetic. Talk to the player informally (pt-BR "você", es "tú", fr "tu", de "du",
  it "tu"; the casual register in ja/ko/zh). Never formal or corporate.
- **Short.** These are buttons, badges and one-line hints on small screens. Prefer the shortest natural wording.
  Values that are a single English word or are ALL CAPS are buttons/labels: keep them about as short as the English,
  and keep ALL CAPS where the English uses it.
- **Exclamation marks** where the English has them; the game is upbeat.
- **Numbers and money** come in through placeholders (`${price}`, `{count}`): keep the `$` where the English has it.
- If a phrase has no natural equivalent, rewrite it so it sounds natural rather than translating literally.

## Glossary (Dig & Discover) — translate these the same way everywhere

| English | Meaning in the game |
|---|---|
| Dig | breaking rock blocks with a tool |
| Backpack / Bag | what the miner carries ore in (fills up, then sold) |
| Sell | trading the backpack's contents for cash |
| ATM | the machine in the hub where you sell and buy upgrades — keep "ATM" or the local word for a cash machine |
| Hub | the player's home base in the middle of the mine (not an airport/network "hub") |
| Mine | a whole dig site; players open new mines (`Mine #2`) — the place, not the explosive |
| Upgrade / Gear / Boost | better tools and bags / the tools tab / repeatable small bonuses |
| Ore | valuable rock (copper, silver, gold, crystal, amethyst) |
| Artifact / Find / Relic / Treasure | buried collectibles shown in the Trophy Room |
| Collection | the set of artifacts to find in a mine |
| Wardrobe / Look / Hat | the player's cosmetics |
| Achievement / Claim | goals with rewards / taking a reward |
| Tractor / Digger | the ridden digging vehicles (the last two tools) |
| Zone names (Topsoil, Stone Layer, The Deep, Lost Ruins, Obsidian Depths) | places — translate as evocative names |
| Item names (tools, materials, artifacts, hats) | translate naturally; keep proper names (e.g. "Crown") recognisable |

## Key hints

Keys tell you what a string is: `tool_*` tools, `material_*` rocks and ores, `find_*` / artifact names, `achv_*`
achievements (`_goal` = the goal line, `_decor` = a hub decoration), `look_*` wardrobe items, `zone_*` places,
`guide*` short tutorial hints, `*Title` panel titles, `tab*` tab labels.
