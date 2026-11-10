// recorder.js
//
// The recorder page: the game in an iframe (same origin: the project's own dev server) sized to the chosen format, its
// canvases copied each frame into one canvas at the output size (page elements such as the dev GUI aren't canvases, so
// they're never in it), recorded with MediaRecorder and streamed up to the server in chunks. The game's clock is the
// hook's (client/inject.js): pause, step, speed.

const $ = (id) => document.getElementById(id);
const ui = {
    format: $('format'), width: $('width'), height: $('height'), dpr: $('dpr'), logical: $('logical'), query: $('query'),
    reload: $('reload'), swap: $('swap'), pause: $('pause'), step: $('step'), speed: $('speed'), fit: $('fit'), pip: $('pip'),
    fps: $('fps'), bitrate: $('bitrate'), audio: $('audio'), linkPause: $('linkPause'), record: $('record'), recInfo: $('recInfo'),
    layers: $('layers'), recent: $('recent'), stage: $('stage'), frameBox: $('frameBox'), game: $('game'), sizeBadge: $('sizeBadge'),
    pausedBadge: $('pausedBadge'), recBadge: $('recBadge'), pipCanvas: $('pipCanvas'), gameTitle: $('gameTitle'),
};

const STORE = 'recorder.settings';
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; } })();
const persist = () => {
    try {
        localStorage.setItem(STORE, JSON.stringify({
            width: +ui.width.value, height: +ui.height.value, dpr: +ui.dpr.value, query: ui.query.value, fit: ui.fit.checked, pip: ui.pip.checked,
            fps: ui.fps.value, bitrate: ui.bitrate.value, audio: ui.audio.checked, linkPause: ui.linkPause.checked,
        }));
    } catch {
        // Storage blocked: settings last this visit.
    }
};

/** The output size and the faked pixel ratio. */
const format = { width: saved.width || 1080, height: saved.height || 1920, dpr: saved.dpr || 2 };
/** The dpr and query the game was loaded with (a change reloads it). */
let loaded = { dpr: 0, query: null };
/** Layer overrides: a layer's key -> included or not. */
const layerChoice = new Map();
let layers = [];
let layerFrame = 0;

const composite = document.createElement('canvas');
const draw = composite.getContext('2d', { alpha: false });
// In the page (off to the side), so the browser keeps feeding its stream.
composite.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
document.body.append(composite);

const hook = () => {
    try {
        return ui.game.contentWindow?.__recorder ?? null;
    } catch {
        return null;
    }
};

// ------------------------------------------------------------------ format

async function loadPresets() {
    const presets = await fetch('api/presets').then((r) => r.json());
    for (const preset of presets.capture) {
        const option = new Option(preset.name, JSON.stringify(preset));
        ui.format.add(option);
    }
    ui.format.add(new Option('Custom', 'custom'));
    const match = [...ui.format.options].find((o) => o.value !== 'custom' && (({ width, height, dpr }) => width === format.width && height === format.height && dpr === format.dpr)(JSON.parse(o.value)));
    ui.format.value = match ? match.value : 'custom';
}

function showFormat() {
    ui.width.value = format.width;
    ui.height.value = format.height;
    ui.dpr.value = format.dpr;
    const w = format.width / format.dpr;
    const h = format.height / format.dpr;
    ui.logical.textContent = `page ${Math.round(w)}×${Math.round(h)}`;
    ui.sizeBadge.textContent = `${format.width}×${format.height} · scale ${format.dpr}`;
}

/** The game at the format: resized (reloaded if its pixel ratio or params changed), the view laid out. */
function applyFormat() {
    format.width = Math.max(64, Math.round(+ui.width.value / 2) * 2 || 1080);
    format.height = Math.max(64, Math.round(+ui.height.value / 2) * 2 || 1920);
    format.dpr = Math.max(0.5, Math.min(4, +ui.dpr.value || 2));
    composite.width = format.width;
    composite.height = format.height;
    ui.game.style.width = `${format.width / format.dpr}px`;
    ui.game.style.height = `${format.height / format.dpr}px`;
    if (loaded.dpr !== format.dpr || loaded.query !== ui.query.value) loadGame();
    showFormat();
    layout();
    persist();
}

function loadGame() {
    loaded = { dpr: format.dpr, query: ui.query.value };
    const params = new URLSearchParams(ui.query.value.replace(/^\?/, ''));
    params.set('__rec_dpr', String(format.dpr));
    ui.game.src = `/?${params}`;
}

function layout() {
    const w = format.width / format.dpr;
    const h = format.height / format.dpr;
    const box = ui.stage.getBoundingClientRect();
    const scale = ui.fit.checked ? Math.min((box.width - 40) / w, (box.height - 40) / h) : 1;
    ui.game.style.transform = `scale(${scale})`;
    ui.frameBox.style.width = `${w * scale}px`;
    ui.frameBox.style.height = `${h * scale}px`;
    ui.frameBox.style.left = `${Math.max(20, (box.width - w * scale) / 2)}px`;
    ui.frameBox.style.top = `${Math.max(20, (box.height - h * scale) / 2)}px`;
}

// ------------------------------------------------------------------ layers and the composite

const layerKey = (layer) => `${layer.order}:${layer.canvas.id || layer.canvas.className || ''}`;

function included(layer) {
    const key = layerKey(layer);
    if (layerChoice.has(key)) return layerChoice.get(key);
    // By default: the visible ones covering a good part of the page (not a stats panel's or a widget's).
    const page = (format.width / format.dpr) * (format.height / format.dpr);
    return layer.shown && (layer.rect.width * layer.rect.height) / page > 0.3;
}

function refreshLayers() {
    const game = hook();
    layers = game ? game.canvases() : [];
    ui.layers.replaceChildren(...layers.map((layer) => {
        const row = document.createElement('label');
        row.className = 'item layer';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = included(layer);
        box.onchange = () => layerChoice.set(layerKey(layer), box.checked);
        const name = document.createElement('span');
        name.className = 'name';
        const { canvas, rect } = layer;
        name.textContent = `${canvas.id ? `#${canvas.id}` : `canvas ${layer.order + 1}`} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
        const info = document.createElement('span');
        // Rendering under the output size (a game capping its pixel ratio): it's scaled up in the recording.
        const wanted = rect.width * format.dpr;
        const short = canvas.width < wanted * 0.98;
        info.className = `hint ${short ? 'warn' : ''}`;
        info.textContent = `${canvas.width}×${canvas.height}${short ? ' ↑ scaled up' : ''}`;
        row.append(box, name, info);
        return row;
    }));
    if (!layers.length) ui.layers.innerHTML = '<span class="hint">Waiting for the game…</span>';
}

/** The game's included canvases copied into the composite, at the output size. */
function compose() {
    const game = hook();
    if (!game) return;
    if (++layerFrame % 30 === 0) layers = game.canvases();
    draw.fillStyle = '#000';
    draw.fillRect(0, 0, composite.width, composite.height);
    const s = format.dpr;
    for (const layer of layers) {
        if (!included(layer)) continue;
        const { canvas } = layer;
        const rect = canvas.getBoundingClientRect();
        if (!canvas.width || !canvas.height) continue;
        try {
            draw.drawImage(canvas, rect.x * s, rect.y * s, rect.width * s, rect.height * s);
        } catch {
            // A canvas not ready yet.
        }
    }
}

function frame() {
    if (recording || ui.pip.checked) compose();
    if (ui.pip.checked) {
        const pip = ui.pipCanvas;
        const max = 360;
        const k = Math.min(1, max / Math.max(composite.width, composite.height));
        if (pip.width !== Math.round(composite.width * k)) {
            pip.width = Math.round(composite.width * k);
            pip.height = Math.round(composite.height * k);
        }
        pip.getContext('2d').drawImage(composite, 0, 0, pip.width, pip.height);
    }
    if (recording) showRecording();
    requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ the game's clock

function setPaused(paused) {
    const game = hook();
    if (!game) return;
    if (paused) game.pause();
    else game.resume();
    ui.pause.textContent = paused ? '▶ Play' : '⏸ Pause';
    ui.pause.classList.toggle('on', paused);
    ui.step.disabled = !paused;
    ui.pausedBadge.hidden = !paused;
    if (recording && ui.linkPause.checked) {
        if (paused && recorder.state === 'recording') recorder.pause();
        if (!paused && recorder.state === 'paused') recorder.resume();
    }
}

const togglePause = () => setPaused(!hook()?.paused);
const step = () => hook()?.step();

// ------------------------------------------------------------------ recording

let recorder = null;
let recording = null;

function pickMime() {
    const types = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

async function startRecording() {
    const game = hook();
    if (!game || recording) return;
    compose();
    const fps = +ui.fps.value;
    const mime = pickMime();
    const stream = composite.captureStream(fps);
    const tracks = ui.audio.checked ? game.audioTracks() : [];
    tracks.forEach((track) => stream.addTrack(track));
    const { id } = await fetch('api/start', { method: 'POST', body: JSON.stringify({ width: format.width, height: format.height, fps, mime, game: ui.gameTitle.textContent }) }).then((r) => r.json());
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: +ui.bitrate.value * 1e6, audioBitsPerSecond: 192000 });
    recording = { id, bytes: 0, uploaded: 0, chain: Promise.resolve(), started: performance.now(), pausedFor: 0, pausedAt: 0, sound: tracks.length > 0, failed: '' };
    recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        const take = recording;
        take.bytes += event.data.size;
        take.chain = take.chain.then(() => fetch(`api/chunk?id=${id}`, { method: 'POST', body: event.data })).then((r) => {
            if (!r.ok) throw new Error('upload failed');
            take.uploaded += event.data.size;
        }).catch((error) => { take.failed = String(error.message ?? error); });
    };
    recorder.onpause = () => { recording.pausedAt = performance.now(); };
    recorder.onresume = () => { recording.pausedFor += performance.now() - recording.pausedAt; recording.pausedAt = 0; };
    recorder.start(1000);
    if (hook()?.paused && ui.linkPause.checked) recorder.pause();
    ui.record.textContent = '■ Stop';
    ui.record.classList.add('on');
    ui.recBadge.hidden = false;
    for (const input of [ui.width, ui.height, ui.dpr, ui.format, ui.fps, ui.bitrate, ui.audio, ui.reload, ui.swap, ui.query]) input.disabled = true;
}

async function stopRecording() {
    if (!recording || !recorder) return;
    const take = recording;
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.stop();
    await stopped;
    recording = null;
    ui.record.textContent = '● Record';
    ui.record.classList.remove('on');
    ui.record.disabled = true;
    ui.recBadge.hidden = true;
    ui.recInfo.textContent = 'Saving…';
    await take.chain;
    if (take.failed) ui.recInfo.textContent = `Upload failed: ${take.failed}`;
    try {
        const meta = await fetch(`api/finish?id=${take.id}`, { method: 'POST' }).then((r) => r.json());
        if (meta.error) throw new Error(meta.error);
        ui.recInfo.innerHTML = `Saved <b>${meta.duration.toFixed(1)} s</b> (${mb(meta.bytes)}). <a href="editor?id=${meta.id}" target="_blank">Open in the editor</a>`;
        window.open(`editor?id=${meta.id}`, '_blank');
    } catch (error) {
        ui.recInfo.textContent = `Couldn't finish the recording: ${error.message}`;
    }
    ui.record.disabled = false;
    for (const input of [ui.width, ui.height, ui.dpr, ui.format, ui.fps, ui.bitrate, ui.audio, ui.reload, ui.swap, ui.query]) input.disabled = false;
    void showRecent();
}

const toggleRecording = () => (recording ? stopRecording() : startRecording());

const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 2 : 1)} MB`;
const clock = (ms) => {
    const s = Math.max(0, ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

function showRecording() {
    const paused = recorder?.state === 'paused';
    const length = performance.now() - recording.started - recording.pausedFor - (paused ? performance.now() - recording.pausedAt : 0);
    ui.recBadge.textContent = `${paused ? '❚❚' : '●'} REC ${clock(length)} · ${mb(recording.bytes)}`;
    ui.recInfo.textContent = `${paused ? 'Paused with the game. ' : ''}${recording.sound ? 'With sound.' : 'No sound (none playing yet, or off).'} Uploaded ${mb(recording.uploaded)}.${recording.failed ? ` ${recording.failed}` : ''}`;
}

// ------------------------------------------------------------------ recent

async function showRecent() {
    const list = await fetch('api/list').then((r) => r.json()).catch(() => []);
    ui.recent.replaceChildren(...list.slice(0, 8).map((rec) => {
        const row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = `<span class="name">${rec.id}</span><span class="hint">${(rec.duration ?? 0).toFixed(1)}s</span><a href="editor?id=${rec.id}" target="_blank">Edit</a>`;
        return row;
    }));
    if (!list.length) ui.recent.innerHTML = '<span class="hint">None yet.</span>';
}

// ------------------------------------------------------------------ wiring

window.__recorderKey = (key) => {
    if (key === 'F9') togglePause();
    else if (key === 'F7') step();
    else if (key === 'F8') void toggleRecording();
};
window.addEventListener('keydown', (event) => {
    if (!['F7', 'F8', 'F9'].includes(event.key)) return;
    event.preventDefault();
    window.__recorderKey(event.key);
});

ui.format.onchange = () => {
    if (ui.format.value !== 'custom') {
        const preset = JSON.parse(ui.format.value);
        ui.width.value = preset.width;
        ui.height.value = preset.height;
        ui.dpr.value = preset.dpr;
    }
    applyFormat();
};
for (const input of [ui.width, ui.height, ui.dpr]) input.onchange = () => { ui.format.value = 'custom'; applyFormat(); };
ui.query.onchange = applyFormat;
ui.swap.onclick = () => {
    [ui.width.value, ui.height.value] = [ui.height.value, ui.width.value];
    ui.format.value = 'custom';
    applyFormat();
};
ui.reload.onclick = loadGame;
ui.fit.onchange = () => { layout(); persist(); };
ui.pip.onchange = () => { ui.pipCanvas.hidden = !ui.pip.checked; persist(); };
ui.pause.onclick = togglePause;
ui.step.onclick = step;
ui.speed.onchange = () => hook()?.setSpeed(+ui.speed.value);
ui.record.onclick = toggleRecording;
for (const input of [ui.fps, ui.bitrate, ui.audio, ui.linkPause]) input.addEventListener('change', persist);
ui.game.addEventListener('load', () => {
    setPaused(false);
    hook()?.setSpeed(+ui.speed.value);
    try {
        ui.gameTitle.textContent = ui.game.contentDocument?.title ?? '';
    } catch {
        // Not the same origin.
    }
    setTimeout(refreshLayers, 800);
});
window.addEventListener('resize', layout);
new ResizeObserver(layout).observe(ui.stage);
setInterval(() => { if (!recording) refreshLayers(); }, 2000);

ui.query.value = saved.query ?? '';
ui.fit.checked = saved.fit ?? true;
ui.pip.checked = !!saved.pip;
ui.pipCanvas.hidden = !ui.pip.checked;
if (saved.fps) ui.fps.value = saved.fps;
if (saved.bitrate) ui.bitrate.value = saved.bitrate;
ui.audio.checked = saved.audio ?? true;
ui.linkPause.checked = saved.linkPause ?? true;
if (!('MediaRecorder' in window)) ui.recInfo.textContent = 'This browser can\'t record (no MediaRecorder): use Chrome or Edge.';

await loadPresets();
showFormat();
applyFormat();
void showRecent();
requestAnimationFrame(frame);
