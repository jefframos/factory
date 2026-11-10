# Game Recorder

Records gameplay from any Vite game project, then edits and exports it for stores, portals and social posts. It runs
around the game, not in it: nothing in the game's code changes.

```bash
npm run record          # this repo: the GAME in .env, on http://localhost:9300/__recorder/
```

From another project (any Vite project), run it from that project's root:

```bash
node <path to>/recorder/record.mjs [--port 9300] [--config vite.config.ts] [--out recordings] [--no-open]
```

It starts the project's own Vite dev server (its own config, aliases and plugins) on another port, so the normal dev
server can keep running. Recordings go to `recordings/` in the project (keep it in `.gitignore`).

Needs Chrome or Edge (for MediaRecorder), and ffmpeg for exports: ffmpeg on the PATH, `FFMPEG_PATH`, or
`npm i -D @ffmpeg-installer/ffmpeg` in the project.

## Recording

- **Screen format:** pick a preset (phone 9:16, tall phone, App Store preview, tablet, square, 4:5, 16:9) or type a
  size. **UI scale** is the pixel ratio the game is told it has: the game's page is *size ÷ scale* CSS pixels, drawn at
  the full size. A bigger scale makes the UI bigger on screen. Changing the scale reloads the game.
- **Only the game's canvases are recorded.** Page elements (the dev GUI, HTML overlays) are never in the video. The
  **Layers** list shows each canvas. Small ones (stats panels) are left out by default, and you can tick any on or off.
  A layer marked **↑ scaled up** renders below the output size (the game caps its pixel ratio), so it'll be softer.
- **Pause / step / speed:** <kbd>F9</kbd> pauses the whole game (its clock, animations and sound),
  <kbd>F7</kbd> steps one frame while paused, and the speed menu plays it slower or faster. Pausing also pauses the
  recording, so you can line up a shot (turn that off to record a frozen frame).
- **Record:** <kbd>F8</kbd> or the button. The keys work while the game has focus too. The recording streams to disk
  while it runs. When it stops, it's made seekable and the editor opens.
- **Sound:** the game's Web Audio is recorded. (Sound that plays through `<audio>` elements isn't.)

## Editing and exporting

- **Timeline:** drag to select, then **Keep only selection** (trim), **Cut selection**, or **Speed selection**
  (0.5× to 8×). "Play as edited" previews it with the cuts skipped and the speeds applied. Undo with Ctrl+Z.
- **Crop:** tick Crop and drag the box or its corners. The shape can be free, a ratio, or the output's shape.
- **Output:** a preset or by hand: format (MP4 H.264, WebM VP9, GIF), size, fit (fill and cut edges / black bars /
  stretch), frame rate, sound.
- **Compression:** by quality (a slider), or by **target file size** (it's encoded again, smaller, if it comes out
  over). The **estimated size** updates as you change things: a few seconds of the edit are encoded with the real
  settings and scaled up to its length.
- **Platform limits:** max size and min/max length (filled in by presets) show a warning when the export would break
  them.
- **Frame:** saves the current frame (cropped) as a PNG.

Keys: Space play/pause, ←/→ frame, I/O selection start/end, K keep, X or Delete cut, S speed, Esc clear selection.

## Presets

`presets.json` holds the screen formats (`capture`) and output presets (`export`). A project can add its own in a
`recorder.presets.json` at its root (same shape, listed first). Platform rules change, so check the current ones
before uploading. Only the App Store preview's limits (15 to 30 s, 30 fps, at most 500 MB) are filled in.

## How it works

- `record.mjs` starts the project's Vite with `lib/plugin.mjs`. The plugin puts `client/inject.js` first in the game's
  page and serves the recorder under `/__recorder` (same origin as the game, so the recorder can read its canvases).
- `client/inject.js` wraps browser APIs:
  - `requestAnimationFrame`, `performance.now` and `Date.now` run on a clock the recorder can pause, step and scale;
  - WebGL keeps its drawing buffer, so its canvas can be copied;
  - `devicePixelRatio` is faked (`?__rec_dpr=`);
  - each AudioContext's output is also routed to a recordable stream.
- `ui/recorder.js` copies the game's canvases each frame into one canvas at the output size and records it with
  MediaRecorder (H.264 or VP9 WebM, high bitrate), uploading 1 s chunks.
- `lib/api.mjs` stores recordings, remuxes them so they can be seeked, and runs ffmpeg for estimates, exports and
  frames (`lib/ffmpeg.mjs` builds the filter graph: trim/speed per segment, concat, crop, fps, scale, encode).
