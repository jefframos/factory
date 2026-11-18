# HYPERCHIP Factory

One repo, many small web games. Every game shares one engine (`core/`), one asset pipeline (`tools/`), one platform
layer (Poki, YouTube Playables, CrazyGames, GameDistribution, GamePix) and one 3D model library
(`library3d/`, a git submodule). A game is just a folder in `games/` — so a new game starts with everything already
there, and exports to every vendor with one command.

```
npm install
git submodule update --init library3d     # the 3D asset library (models, sounds, 2D icons)
# .env:  GAME=restaurant                  # which game the tools and the dev server work on
npm run all                               # build that game's assets (images, fonts, audio, models, json)
npm run dev                               # play it: http://localhost:8000  (?dev=1 for the debug panel)
npm run build-all                         # one build + zip per platform in its platforms.config.json
```

---

## The map

```
_FACTORY/
├── core/                 the shared engine (PIXI 2D + THREE 3D, loop, scenes, sound, platforms, UI, physics …)
├── games/<name>/         one folder per game (the code, its raw assets, its levels, its platforms)
│   └── store.json        which games show on the published store page, and their names
├── public/<name>/        a game's BUILT assets (written by the tools — never edit by hand)
├── tools/                asset pipeline, builds, editors' launcher, i18n, playtests
├── library3d/            git submodule: the 3D model library (+ sounds, 2D icons) games import from
├── recorder/             gameplay recorder + video editor (npm run record)
├── cachedBuilds/         the published site: a store page + a playable build of every game
├── dist/_builds_<game>/  platform builds and their zips (npm run build-all)
├── scripts/              one-off scripts and tests (ts-node)
├── icons/                game icon processing (Photoshop artboards → icons)
├── vite.config.ts        roots Vite at games/$GAME; platform plugins (see Platforms)
└── .env                  GAME=<name> (and API keys for translation)
```

Older / scratch folders: `legacy/` (an old pizza), `WIP/` (PSDs, fonts in progress), `raw/` and `refs/` (source
images and references), `dev/`, `opy/`.

### One game at a time

`GAME=<name>` in `.env` picks the game for everything: `vite.config.ts` roots itself at `games/$GAME` (its
`index.html` is the entry), and every asset tool reads and writes that game's folders. Change the line while
`npm run dev` is running and the dev server restarts into the new game. `npm run all -- --mow` switches `.env` and
rebuilds that game's assets in one go.

Path aliases: `core/…` and `@core/…` both resolve to `core/`.

---

## A game's folder

```
games/<name>/
├── index.html              the page (its backdrop colour, so there's no white flash), loads index.ts
├── index.ts                the game class: extends core/Game, boots the platform, loads assets, registers scenes
├── loader.config.ts        the HTML loading screen's look (core/loader/HtmlLoader)
├── platforms.config.json   which vendors it ships to: their SDK class, game id, ads on/off, asset folder
├── game/                   the game's own code (scenes, world, ui, data, audio …)
├── raw-assets/             SOURCE assets, in tagged folders (see Assets)
├── manifests/              generated: images.json, audio.json, fonts.json, json.json (what to load)
├── registry/               generated: typed registries (e.g. assetsRegistry/modelsRegistry.ts)
├── levels/, settings.json  data (some games: edited by their editor)
├── web/                    optional: the game's own editor (npm run editor → web/server.mjs)
├── tools/                  optional: the game's own build scripts (e.g. build-props.mjs)
├── icon/icon.png           the store tile
└── README.md               how the game plays and where its code is
```

### How a game boots

`index.ts` (see `games/restaurant/index.ts` for a complete one):

1. `new MyGame()` → `core/Game` creates the PIXI `Application` (720 × 1080 design size, scaled to the screen) and
   starts the loop.
2. **Platform**: `PlatformHandler.instance.initialize(await getPlatformInstance(VITE_PLATFORM))` — the vendor SDK
   (or the mock locally), then `startLoad()`.
3. **Save**: the game's own save module reads from the platform first (`platform.getItem`), localStorage as a fallback.
4. **Assets**: fonts, the UI atlas (`PIXI.Assets.load(...)`), sounds (`SoundManager`), the game's manifests
   (paths fixed with `ManifestHelper.patchPaths(manifest, '<folder>/…')` — always build paths from
   `this.folderPath`, which comes from the platform config).
5. **Scenes**: `SceneManager.register(key, SceneClass, …)` then `changeScene(key)`.
6. `platform.loadFinished()`, hide the HTML loader. Gameplay start/stop and ads go through `PlatformHandler`.

---

## The engine: `core/`

| Folder | What's in it |
|---|---|
| `Game.ts` | The app: PIXI application, 720 × 1080 design size and screen fit (`Game.gameScreenData`, `overlayScreenData`), the fixed (60 Hz) and per-frame update loop, layers (`stageContainer`, `uiLayer`, `popupLayer`, `notificationLayer`), `?dev=1` / `?debug` params (`Game.debugParams`), pausing on tab hide (unless the platform forbids it) |
| `scene/` | `SceneManager` (register, change, update, resize), `GameScene` (a PIXI scene: `build → show → update / fixedUpdate → hide → destroy`), `ThreeScene` (a THREE scene + camera rendered on its own canvas behind the PIXI layer), `SetupThree` (the shared THREE renderer) |
| `platforms/` | The vendor layer — see **Platforms** |
| `audio/` | `SoundManager` (Howler): `playSoundById`, unique sounds, background music by layer with fades, master SFX / ambient volume, mute that follows the platform (`setPlatformMuted`); `SoundLoaderManager` |
| `loader/` | `HtmlLoader` (the HTML loading screen, styled per game by `loader.config.ts`), `BundleLoader`, `ManifestHelper` (prefix a manifest's paths with the game's folder), `LoaderScene` |
| `three/` | `GLTFLoaders` (GLTF + Draco / meshopt), `ModelLoaderManager` |
| `services/` | `BendService` (the curved-world vertex bend: `applyBend(material)`, `updateOrigin(pos)`), `RunnerBendService` |
| `rooms/` | Rooms from layout data: `Room` (floors, walls with windows / doors / gaps and their frames, props, by stage), `PolyWallBuilder`, `CheckerFloorBuilder`, `RoomDoor` (sliding / swinging doors that open for people), `RoomHooks` (where a game plugs in its bend and fades) |
| `town/` | A street: `Ground` (roads from cells, lawns), `Traffic` (cars driving the roads), `Crowd` (people wandering areas and paths), `Subdivide` (cut flat meshes so they bend) |
| `roads/` | `RoadGrid`: picks and turns each road tile from its neighbours |
| `physics/`, `phyisics/`, `collision/` | Physics world and rigid bodies; collision system and colliders (Matter.js / SAT based) |
| `ecs/` | Entity / Component / World |
| `io/` | Input: analog stick, keyboard movement, pointer follow, swipe |
| `camera/` | Virtual camera system and its settings |
| `ui/` | Buttons, nine-slice progress bars, currency HUD, sound toggle, confetti, pattern backgrounds |
| `popup/` | Popup manager, base popup, popup blocker |
| `debug/` | `DebugOverlay` (the `?dev=1` panel: games add panels and buttons), persistence, performance diagnostics |
| `tiled/` | Tiled (TMX) maps into PIXI containers |
| `utils/`, `vfx/` | Easing, tweens, observables, number / string / time helpers, debug drawing, colour gradients, confetti |
| `pieces/` | Shared puzzle pieces (the jigsaw games) |

Rendering: 2D games are PIXI only. 3D games put a `ThreeScene` (THREE canvas) **behind** the PIXI canvas — the 3D
world on THREE, the HUD and menus on PIXI. A 3D object's screen point (`worldToScreen`) places a PIXI element over it.

---

## Platforms (Poki, YouTube Playables, …)

```
games/<name>/platforms.config.json          core/platforms/
{                                           IPlatformConnection.ts   the contract every vendor implements
  "poki":    { gameId, enableAds,           PlatformFactory.ts       VITE_PLATFORM → which class
               folderPath, … },             PlatformHandler.ts       the one the game talks to (singleton)
  "youtube": { gameId, enableAds,           PokiPlatform.ts
               folderPath,                  YouTubePlayablePlatform.ts
               "apiScript": "https://www.   CrazyGamesPlatform.ts, GameDistributionPlatform.ts,
                 youtube.com/game_api/v1" } GamePixPlatform.ts, FacebookInstantAPI.ts
}                                           MockPlatform.ts          local / dev: no SDK, every call logged, ads simulated
```

**The contract** (`IPlatformConnection`): `initialize`, `startLoad` / `firstFrameReady` / `loadFinished`,
`gameplayStart` / `gameplayStop`, `showCommercialBreak`, `showRewardedVideo(id) → boolean`, `setPlayerScore`,
banners, `happyTime`, save (`setItem` / `getItem` / `removeItem`), and optional `getLanguage`, `measure` (analytics),
`getPlayerName`, `onPause` / `onResume` / `onAudioChanged`, `usesPageVisibilityApi`. A game never calls a vendor SDK
directly: it calls `PlatformHandler.instance.platform.…` (or `PlatformHandler.instance.measure(…)`), so the same code
runs on every vendor.

**How a platform build is made**:

1. `npm run build-all` (`tools/build/build-platforms.mjs`) reads the game's `platforms.config.json` and, for each
   platform key, runs `vite build` with `VITE_PLATFORM=<key>`, then zips the result:
   `dist/_builds_<game>/<platform>/` and `dist/_builds_<game>/<platform>.zip` — the zip is what you upload.
2. In each build:
   - `PlatformFactory` folds to that one platform (Vite inlines `VITE_PLATFORM`), so a Poki build carries only the
     Poki SDK module — no other vendor's code, no mock.
   - `trimPlatformConfig` (vite.config.ts) keeps only that platform's entry of `platforms.config.json` (no other
     vendor's ids or scripts ship).
   - `injectPlatformApiScript` puts the platform's `apiScript` (YouTube's `game_api`) as the first tag in `<head>`.
   - `keepOnlyGameAssets` removes other games' `public/` folders from the build — only `public/<game>` (and any
     `folderPath` the config names) ships.
3. `npm run build` alone builds `VITE_PLATFORM` unset: the `default` build (mock platform), used for the cached /
   published builds.

**Vendor notes** (already handled in the classes):

- **Poki**: `PokiSDK.init`, `gameLoadingFinished`, `gameplayStart` / `gameplayStop` around play, commercial and
  rewarded breaks, `measure`.
- **YouTube Playables**: the `game_api` script must load first (`apiScript`); `firstFrameReady` and `gameReady`;
  saves go through `ytgame.game.saveData` / `loadData` (one JSON blob); pause / resume / audio come **only** from
  `ytgame.system` (`usesPageVisibilityApi: false` — certification), no outbound links.
- **CrazyGames** (with and without ads: two keys, same class), **GameDistribution**, **GamePix**: the same contract.
- **Facebook Instant**: the class exists (`FacebookInstantAPI.ts`) but isn't wired into `PlatformFactory` yet — add
  its `if` there before shipping to Facebook.

**Shipping a game to a new vendor**: add its key to the game's `platforms.config.json` (copy one, set `gameId`,
`enableAds`, `folderPath`), then `npm run build-all`. A brand-new vendor: one class implementing
`IPlatformConnection` in `core/platforms/`, and one `if` in `PlatformFactory`.

---

## Assets

```
games/<name>/raw-assets/           →  tools  →   public/<name>/            + games/<name>/manifests/*.json
├── images/<folder>{tps}/   (atlas)    npm run image   images/  (webp atlases)       images.json
├── non-preload/            (loaded later)               images/non-preload/
├── fonts/<Font>{wf}.ttf    (web font) npm run font    fonts/   (woff2)              fonts.json
├── audio/                  (sfx, music) npm run audio  audio/   (compressed)         audio.json
├── models/<pack>{m}/       (3D)       npm run models  models/  (+ texture cap)      registry/assetsRegistry/modelsRegistry.ts
└── json/                   (data)     npm run json    json/                         json.json
```

- **Folder tags** (AssetPack's): `{tps}` packs the folder into a texture atlas, `{wf}` makes a web font, `{m}` makes
  a model bundle. Image file names are sanitised before packing.
- **`npm run all`** builds everything for the game in `.env` (and any game script that builds models into `public/`,
  e.g. `games/<game>/tools/build-props.mjs`). Each step has a `watch:` variant (`npm run watch:image` …).
- **Models**: `build-models.mjs` copies the game's model folders to `public/<game>/models`, writes the typed
  registry, then `shrink-textures.mjs` caps embedded textures (default 512 px; a game can set its own in
  `models-optimize.json`). `models:uncompress` skips the compression.
- **Never edit `public/<game>`**: it's rebuilt from `raw-assets`. A model imported by an editor goes into
  `raw-assets/models/library{m}/` *and* `public/` at once, so it works straight away and survives the next build.

---

## The 3D library: `library3d/` (git submodule)

`library3d` is its own repository (`https://github.com/jefframos/library3d.git`), checked out here as a submodule:

```
git submodule update --init library3d     # first time
git submodule update --remote library3d   # pull the library's latest
```

What's in it:

- `files/` — the model packs (CC0: KayKit Bits / City Builder / Forest / Mixed Bag, Kenney kits, Quaternius,
  City2, characters, furniture, casino …), each in its own original layout.
- `library/index.json` + `library/thumbs/` — every asset grouped across its formats (gltf / glb / fbx / obj), with a
  thumbnail: rebuilt by the library's `npm run scan`.
- `server/` — the library's viewer (`npm start` inside `library3d/`, browse and preview every asset) and `deps.mjs`
  (a model's dependent files: its .bin, textures).
- `sounds/`, `2d/`, `animations/`, `packs-characters/` — music and ambient sounds, 2D icon sets, animation clips,
  character packs.

**How games use it**: a game's editor (e.g. the restaurant's 📚 Library picker) lists `library/index.json`, and
importing an asset copies it — with everything `deps.mjs` finds — into the game's `raw-assets/models/library{m}/`
and its published folder. Games can also copy kit models straight into their own `raw-assets/models/<pack>{m}/`
(the restaurant's kitchen models are KayKit Restaurant Bits). The game then loads them by name like any model.

---

## Tools

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server for `$GAME` on :8000 (`?dev=1`: the debug panel) |
| `npm run editor` | The game's own editor, if it has one (`games/$GAME/web/server.mjs`: levels, layouts, data) |
| `npm run record` | Gameplay recorder + video editor around the game, on :9300 (`recorder/`) |
| `npm run build` / `build-all` | The default build / one build + zip per platform |
| `npm run build:cached`, `pages`, `store` | The published site: a cached build of each game (`cachedBuilds/<game>`), the store page (`cachedBuilds/index.html`, from `games/store.json` and each game's `icon/icon.png`), served locally like GitHub Pages |
| `npm run all` / `image` / `font` / `audio` / `models` / `json` | The asset pipeline (above) |
| `npm run translate:i18n` (+ `:new`, `:update`), `i18n:*` | Translations (Anthropic or MyMemory keys in `.env`) |
| `npm run playtest` | Bot playtests in a browser, saving reports (pizza) |
| `npm test` | Engine tests (physics, ECS, actions …) |

`deploy.bat` builds and copies `dist/` to a sibling `play/` site; `autopush.bat` commits and pushes with a counter.

---

## Making a new game

1. **Copy a game** that's closest to what you want (a 2D PIXI one, or a 3D one like `restaurant`, `mow`, `dig`)
   into `games/<new>`, and rename its game class, `index.html` title and `folderPath`s.
2. **`.env`**: `GAME=<new>`.
3. **`platforms.config.json`**: the vendors it ships to — `poki`, `youtube`, … each with its `gameId`, `enableAds`,
   `folderPath: "<new>"` (and YouTube's `apiScript`).
4. **Assets**: put them in `raw-assets/` with the right folder tags, `npm run all`.
5. **Play**: `npm run dev`. Use `PlatformHandler` for gameplay start / stop, ads and saves — never a vendor SDK.
6. **Ship**: `npm run build-all` → upload `dist/_builds_<new>/<platform>.zip` to each vendor.
7. **Store** (optional): `games/<new>/icon/icon.png`, add it to `games/store.json`, `npm run build:cached`.

Each game's own `README.md` explains how it plays and where its code is; `CLAUDE.md` has the conventions for working
in this repo with Claude Code.
