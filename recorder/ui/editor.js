// editor.js
//
// The recording editor: the recording (its seekable source) with the edit over it: which parts are kept, each at its
// speed (segments of the source's time), and an optional crop (in the source's pixels). The output settings (a preset,
// or by hand) go to the server for an estimate of the file's size (a few seconds of it encoded) and for the export.

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((el) => [el.id, el]));

const params = new URLSearchParams(location.search);
let meta = null;
let presets = [];
/** The edit: kept segments of the source ({ start, end, speed }, in order, apart), and the crop (or null). */
let segments = [];
let crop = null;
let selection = null;
const history = [];
const FRAME = () => 1 / (meta?.fps || 60);

const api = (route, body) => fetch(`api/${route}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error ?? r.statusText), { status: r.status });
    return data;
});
const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 2 : 1)} MB`;
const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// ------------------------------------------------------------------ loading

async function start() {
    presets = (await api('presets')).export;
    ui.preset.replaceChildren(...presets.map((preset, i) => new Option(preset.name, String(i))), new Option('Custom', 'custom'));
    const list = await api('list');
    ui.pick.replaceChildren(...list.map((rec) => new Option(`${rec.id} · ${(rec.duration ?? 0).toFixed(1)}s`, rec.id)));
    const id = params.get('id') ?? list[0]?.id;
    if (!id) {
        ui.app.innerHTML = '<div class="empty">No recordings yet. Record one in the <a href="./">recorder</a>.</div>';
        return;
    }
    ui.pick.value = id;
    meta = await api(`meta?id=${encodeURIComponent(id)}`);
    if (!meta.finished) {
        ui.app.innerHTML = '<div class="empty">This recording didn\'t finish saving.</div>';
        return;
    }
    document.title = `Edit · ${id}`;
    ui.facts.textContent = `${meta.width}×${meta.height} · ${meta.fps} fps · ${meta.duration.toFixed(1)} s · ${mb(meta.bytes)}${meta.audio ? ' · sound' : ''}`;
    ui.video.src = `files/${id}/${meta.source}`;
    ui.name.value = id;
    resetEdit(false);
    applyPreset(0);
    showExports(meta.exports);
    await new Promise((resolve) => ui.video.addEventListener('loadedmetadata', resolve, { once: true }));
    // The browser's figure is the one it seeks by.
    if (Number.isFinite(ui.video.duration) && Math.abs(ui.video.duration - meta.duration) > 0.05) meta.duration = ui.video.duration;
    resetEdit(false);
    edited();
    tick();
}

// ------------------------------------------------------------------ the edit

const snapshot = () => JSON.stringify({ segments, crop });
function remember() {
    history.push(snapshot());
    if (history.length > 100) history.shift();
}
function undo() {
    const last = history.pop();
    if (!last) return;
    ({ segments, crop } = JSON.parse(last));
    ui.cropOn.checked = !!crop;
    edited();
}

function resetEdit(save = true) {
    if (save) remember();
    segments = [{ start: 0, end: meta.duration, speed: 1 }];
    selection = null;
    if (save) edited();
}

/** Segments with `fn` applied over [a, b] (each segment split there): fn(part) gives the part, or null to drop it. */
function over(a, b, fn) {
    const next = [];
    for (const s of segments) {
        const parts = [];
        if (s.start < a) parts.push({ ...s, end: Math.min(s.end, a), inside: false });
        const lo = Math.max(s.start, a);
        const hi = Math.min(s.end, b);
        if (hi > lo) parts.push({ ...s, start: lo, end: hi, inside: true });
        if (s.end > b) parts.push({ ...s, start: Math.max(s.start, b), inside: false });
        for (const part of parts) {
            const { inside, ...plain } = part;
            const result = inside ? fn(plain) : plain;
            if (result && result.end - result.start > 0.01) next.push(result);
        }
    }
    // Neighbours at the same speed, end to end: one segment again.
    const merged = [];
    for (const s of next) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.end - s.start) < 1e-3 && last.speed === s.speed) last.end = s.end;
        else merged.push({ ...s });
    }
    return merged;
}

function cutSelection() {
    if (!selection) return;
    remember();
    segments = over(selection[0], selection[1], () => null);
    selection = null;
    edited();
}

function keepSelection() {
    if (!selection) return;
    remember();
    const [a, b] = selection;
    segments = over(0, a, () => null);
    segments = over(b, meta.duration + 1, () => null);
    selection = null;
    ui.video.currentTime = a;
    edited();
}

function speedSelection() {
    if (!selection) return;
    remember();
    const speed = +ui.speedPick.value;
    segments = over(selection[0], selection[1], (part) => ({ ...part, speed }));
    edited();
}

const editLength = () => segments.reduce((sum, s) => sum + (s.end - s.start) / s.speed, 0);

// ------------------------------------------------------------------ timeline

function drawTimeline() {
    const el = ui.timeline;
    const width = el.clientWidth;
    const x = (t) => (t / meta.duration) * width;
    const parts = segments.map((s) => {
        const div = document.createElement('div');
        div.className = `seg ${s.speed > 1 ? 'fast' : s.speed < 1 ? 'slow' : ''}`;
        div.style.left = `${x(s.start)}px`;
        div.style.width = `${Math.max(1, x(s.end) - x(s.start))}px`;
        if (s.speed !== 1) div.innerHTML = `<span>${s.speed}×</span>`;
        return div;
    });
    const ticks = [];
    const every = meta.duration > 120 ? 10 : meta.duration > 30 ? 5 : 1;
    for (let t = 0; t < meta.duration; t += every) {
        const tick = document.createElement('div');
        tick.className = 'tick';
        tick.style.left = `${x(t)}px`;
        if (t % (every * 5) === 0 || every > 1) tick.textContent = `${t}s`;
        ticks.push(tick);
    }
    const sel = document.createElement('div');
    sel.className = 'sel';
    sel.hidden = !selection;
    if (selection) {
        sel.style.left = `${x(selection[0])}px`;
        sel.style.width = `${x(selection[1]) - x(selection[0])}px`;
    }
    const head = document.createElement('div');
    head.className = 'head';
    head.id = 'head';
    el.replaceChildren(...parts, ...ticks, sel, head);
    placeHead();
}

function placeHead() {
    const head = document.getElementById('head');
    if (head && meta) head.style.left = `${(ui.video.currentTime / meta.duration) * ui.timeline.clientWidth}px`;
}

function timelineTime(event) {
    const rect = ui.timeline.getBoundingClientRect();
    return Math.max(0, Math.min(meta.duration, ((event.clientX - rect.left) / rect.width) * meta.duration));
}

ui.timeline.addEventListener('pointerdown', (event) => {
    ui.timeline.setPointerCapture(event.pointerId);
    const from = timelineTime(event);
    const fromX = event.clientX;
    ui.video.currentTime = from;
    selection = null;
    const move = (e) => {
        const t = timelineTime(e);
        if (Math.abs(e.clientX - fromX) > 3) selection = [Math.min(from, t), Math.max(from, t)];
        ui.video.currentTime = t;
        drawTimeline();
    };
    const up = () => {
        ui.timeline.removeEventListener('pointermove', move);
        ui.timeline.removeEventListener('pointerup', up);
        drawTimeline();
    };
    ui.timeline.addEventListener('pointermove', move);
    ui.timeline.addEventListener('pointerup', up);
    drawTimeline();
});

// ------------------------------------------------------------------ playback

function segmentAt(t) {
    return segments.find((s) => t >= s.start - 1e-3 && t < s.end - 1e-3);
}

/** Each frame: playing as edited skips the cut parts and plays each part at its speed. */
function tick() {
    const video = ui.video;
    if (ui.previewEdits.checked && !video.paused && segments.length) {
        const t = video.currentTime;
        const segment = segmentAt(t);
        if (!segment) {
            const next = segments.find((s) => s.start > t);
            if (next) video.currentTime = next.start;
            else if (ui.loop.checked) video.currentTime = segments[0].start;
            else video.pause();
        } else if (video.playbackRate !== segment.speed) {
            video.playbackRate = segment.speed;
        }
    } else if (!ui.previewEdits.checked && video.playbackRate !== 1) {
        video.playbackRate = 1;
    }
    ui.time.textContent = `${clock(video.currentTime)} / ${clock(meta.duration)} · edit ${clock(editLength())}`;
    ui.play.textContent = video.paused ? '▶' : '❚❚';
    placeHead();
    requestAnimationFrame(tick);
}

function togglePlay() {
    const video = ui.video;
    if (video.paused) {
        if (ui.previewEdits.checked && !segmentAt(video.currentTime)) video.currentTime = (segments.find((s) => s.start > video.currentTime) ?? segments[0]).start;
        void video.play();
    } else {
        video.pause();
    }
}

ui.video.addEventListener('ended', () => {
    if (ui.loop.checked) {
        ui.video.currentTime = ui.previewEdits.checked ? segments[0]?.start ?? 0 : 0;
        void ui.video.play();
    }
});

// ------------------------------------------------------------------ crop

/** Where the picture is drawn in the viewer (letterboxed), and its scale. */
function picture() {
    const box = ui.viewer.getBoundingClientRect();
    const scale = Math.min(box.width / meta.width, box.height / meta.height);
    return { left: (box.width - meta.width * scale) / 2, top: (box.height - meta.height * scale) / 2, scale };
}

function cropRatio() {
    const value = ui.cropAspect.value;
    if (value === 'free') return 0;
    if (value === 'output') {
        const out = outputSize(false);
        return out.width && out.height ? out.width / out.height : 0;
    }
    return +value;
}

/** The biggest crop of `ratio`'s shape round the middle of `around` (or the picture's). */
function fitCrop(ratio, around = null) {
    const cx = around ? around.x + around.w / 2 : meta.width / 2;
    const cy = around ? around.y + around.h / 2 : meta.height / 2;
    let w = meta.width;
    let h = meta.height;
    if (ratio) {
        if (w / h > ratio) w = h * ratio;
        else h = w / ratio;
    }
    if (around && !ratio) ({ w, h } = around);
    const x = Math.max(0, Math.min(meta.width - w, cx - w / 2));
    const y = Math.max(0, Math.min(meta.height - h, cy - h / 2));
    return { x, y, w, h };
}

function layoutCrop() {
    if (!meta) return;
    ui.cropLayer.hidden = !crop;
    if (!crop) return;
    const { left, top, scale } = picture();
    Object.assign(ui.cropLayer.style, { left: `${left}px`, top: `${top}px`, width: `${meta.width * scale}px`, height: `${meta.height * scale}px` });
    Object.assign(ui.cropBox.style, { left: `${crop.x * scale}px`, top: `${crop.y * scale}px`, width: `${crop.w * scale}px`, height: `${crop.h * scale}px` });
    ui.cropSize.textContent = `${even(crop.w)}×${even(crop.h)}`;
}

ui.cropBox.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    ui.cropBox.setPointerCapture(event.pointerId);
    remember();
    const corner = event.target.dataset.corner ?? null;
    const startX = event.clientX;
    const startY = event.clientY;
    const from = { ...crop };
    const { scale } = picture();
    const ratio = cropRatio();
    const move = (e) => {
        const dx = (e.clientX - startX) / scale;
        const dy = (e.clientY - startY) / scale;
        if (!corner) {
            crop.x = Math.max(0, Math.min(meta.width - from.w, from.x + dx));
            crop.y = Math.max(0, Math.min(meta.height - from.h, from.y + dy));
        } else {
            // The opposite corner stays put.
            const right = corner.includes('e');
            const bottom = corner.includes('s');
            const ax = right ? from.x : from.x + from.w;
            const ay = bottom ? from.y : from.y + from.h;
            let w = Math.max(32, right ? from.w + dx : from.w - dx);
            let h = Math.max(32, bottom ? from.h + dy : from.h - dy);
            const maxW = right ? meta.width - ax : ax;
            const maxH = bottom ? meta.height - ay : ay;
            w = Math.min(w, maxW);
            h = Math.min(h, maxH);
            if (ratio) {
                if (w / h > ratio) w = h * ratio;
                else h = w / ratio;
            }
            crop = { x: right ? ax : ax - w, y: bottom ? ay : ay - h, w, h };
        }
        layoutCrop();
    };
    const up = () => {
        ui.cropBox.removeEventListener('pointermove', move);
        ui.cropBox.removeEventListener('pointerup', up);
        edited();
    };
    ui.cropBox.addEventListener('pointermove', move);
    ui.cropBox.addEventListener('pointerup', up);
});

ui.cropOn.onchange = () => {
    remember();
    crop = ui.cropOn.checked ? fitCrop(cropRatio()) : null;
    edited();
};
ui.cropAspect.onchange = () => {
    if (!crop) return;
    remember();
    crop = fitCrop(cropRatio(), crop);
    edited();
};

// ------------------------------------------------------------------ output

function readOut() {
    return {
        format: ui.format.value,
        width: +ui.outW.value || 0,
        height: +ui.outH.value || 0,
        fit: ui.fit.value,
        fps: +ui.fps.value || 0,
        compression: ui.mode.value === 'size' ? { mode: 'size', mb: +ui.targetMb.value || 10 } : { mode: 'quality', quality: +ui.quality.value },
        speed: ui.encSpeed.value,
        audio: ui.audio.checked,
        audioKbps: +ui.audioKbps.value,
    };
}

function applyPreset(index) {
    const preset = presets[index];
    if (!preset) return;
    ui.preset.value = String(index);
    ui.format.value = preset.format;
    ui.outW.value = preset.width || '';
    ui.outH.value = preset.height || '';
    ui.fit.value = preset.fit ?? 'cover';
    ui.fps.value = String(preset.fps ?? 0);
    ui.mode.value = preset.compression?.mode ?? 'quality';
    ui.quality.value = preset.compression?.quality ?? 75;
    ui.targetMb.value = preset.compression?.mb ?? 10;
    ui.encSpeed.value = preset.speed ?? 'balanced';
    ui.audio.checked = !!preset.audio;
    if (preset.audioKbps) ui.audioKbps.value = String(preset.audioKbps);
    ui.limitMb.value = preset.limits?.maxMB ?? '';
    ui.limitMin.value = preset.limits?.minSeconds ?? '';
    ui.limitMax.value = preset.limits?.maxSeconds ?? '';
    // Cropping to the output's shape follows the preset.
    if (crop && ui.cropAspect.value === 'output') crop = fitCrop(cropRatio(), crop);
    outputChanged(false);
}

/** The picture going in (the crop, or the whole), and what it comes out as. */
function outputSize(round = true) {
    const inW = crop ? crop.w : meta.width;
    const inH = crop ? crop.h : meta.height;
    const out = readOut();
    let width = out.width;
    let height = out.height;
    if (width && !height) height = (width * inH) / inW;
    else if (height && !width) width = (height * inW) / inH;
    else if (!width && !height) { width = inW; height = inH; }
    return round ? { width: even(width), height: even(height), inW: even(inW), inH: even(inH) } : { width, height };
}

function outputChanged(custom = true) {
    if (custom) ui.preset.value = 'custom';
    const out = readOut();
    ui.qualityValue.textContent = ui.quality.value;
    ui.qualityRow.hidden = out.compression.mode !== 'quality';
    ui.sizeRow.hidden = out.compression.mode !== 'size';
    ui.mode.disabled = out.format === 'gif';
    if (out.format === 'gif' && ui.mode.value === 'size') {
        ui.mode.value = 'quality';
        return outputChanged(custom);
    }
    ui.audio.disabled = out.format === 'gif' || !meta?.audio;
    ui.audioKbps.disabled = ui.audio.disabled || !ui.audio.checked;
    edited(false);
}

function describe() {
    const size = outputSize();
    const out = readOut();
    const fps = out.fps || meta.fps;
    const shapeIn = size.inW / size.inH;
    const shapeOut = size.width / size.height;
    const mismatch = Math.abs(shapeIn - shapeOut) > 0.01;
    ui.resolution.innerHTML = `${size.inW}×${size.inH}${crop ? ' (cropped)' : ''} → <b>${size.width}×${size.height}</b> · ${fps} fps · ${editLength().toFixed(1)} s`
        + (mismatch ? `<br><span class="hint warn">Different shape: ${out.fit === 'cover' ? 'its edges are cut off' : out.fit === 'contain' ? 'black bars are added' : 'it\'s stretched'}. Crop to "Output's shape" to choose what's kept.</span>` : '');
}

function checkLimits(bytes) {
    const warnings = [];
    const length = editLength();
    const maxMb = +ui.limitMb.value;
    const min = +ui.limitMin.value;
    const max = +ui.limitMax.value;
    if (maxMb && bytes && bytes > maxMb * 1e6) warnings.push(`<span class="hint bad">≈ ${mb(bytes)} is over the ${maxMb} MB limit: lower the quality, size or frame rate, or use a target size.</span>`);
    if (max && length > max) warnings.push(`<span class="hint bad">${length.toFixed(1)} s is over the ${max} s limit: cut ${(length - max).toFixed(1)} s or speed a part up.</span>`);
    if (min && length < min) warnings.push(`<span class="hint bad">${length.toFixed(1)} s is under the ${min} s minimum.</span>`);
    if (!warnings.length && (maxMb || max || min) && bytes) warnings.push('<span class="hint good">Within the limits.</span>');
    ui.warnings.innerHTML = warnings.join('<br>');
}

// ------------------------------------------------------------------ estimate

let estimateTimer = 0;
let estimateToken = 0;
let lastEstimate = 0;

function edited(changedEdit = true) {
    if (changedEdit) {
        ui.cropOn.checked = !!crop;
        layoutCrop();
        drawTimeline();
    }
    describe();
    checkLimits(lastEstimate);
    clearTimeout(estimateTimer);
    ui.estimate.style.opacity = '0.5';
    ui.estimateNote.textContent = 'Working it out…';
    estimateTimer = setTimeout(runEstimate, 700);
}

async function runEstimate() {
    const token = ++estimateToken;
    try {
        const result = await api('estimate', { id: meta.id, edit: { segments, crop }, out: readOut() });
        if (token !== estimateToken) return;
        lastEstimate = result.bytes;
        ui.estimate.textContent = `≈ ${mb(result.bytes)}`;
        ui.estimate.style.opacity = '1';
        const kbps = (result.bytes * 8) / 1000 / Math.max(0.1, result.seconds);
        ui.estimateNote.textContent = result.sampled
            ? `From a few seconds encoded with these settings (about ±15%). ${Math.round(kbps)} kbps.`
            : `Aimed under the target: ${Math.round(kbps)} kbps (encoded again smaller if it comes out over).`;
        checkLimits(result.bytes);
    } catch (error) {
        if (token !== estimateToken || error.status === 409) return;
        ui.estimate.textContent = '–';
        ui.estimate.style.opacity = '1';
        ui.estimateNote.textContent = `Couldn't estimate: ${error.message.split('\n')[0]}`;
    }
}

// ------------------------------------------------------------------ export

async function startExport() {
    ui.export.disabled = true;
    ui.progress.hidden = false;
    ui.progress.firstElementChild.style.width = '0%';
    ui.exportInfo.textContent = 'Encoding…';
    try {
        const { job } = await api('export', { id: meta.id, edit: { segments, crop }, out: readOut(), name: ui.name.value });
        for (;;) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            const state = await api(`job?job=${encodeURIComponent(job)}`);
            ui.progress.firstElementChild.style.width = `${Math.round(state.progress * 100)}%`;
            ui.exportInfo.textContent = `Encoding… ${Math.round(state.progress * 100)}%${state.tries > 1 ? ` (try ${state.tries}: smaller, to fit the size)` : ''}`;
            if (state.status === 'failed') throw new Error(state.error);
            if (state.status === 'done') {
                ui.exportInfo.innerHTML = `Done: <b>${state.file}</b> · ${mb(state.bytes)}${state.over ? ' <span class="hint bad">(still over the target: lower the size or frame rate)</span>' : ''} · <a href="${state.url}" download>Download</a>`;
                break;
            }
        }
        showExports((await api(`meta?id=${encodeURIComponent(meta.id)}`)).exports);
    } catch (error) {
        ui.exportInfo.innerHTML = `<span class="hint bad">Export failed: ${String(error.message).split('\n').slice(0, 3).join(' ')}</span>`;
    }
    ui.export.disabled = false;
    setTimeout(() => { ui.progress.hidden = true; }, 1500);
}

function showExports(list) {
    ui.exports.replaceChildren(...(list ?? []).map((file) => {
        const row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = `<span class="name" title="${file.name}">${file.name}</span><span class="hint">${mb(file.bytes)}</span><a href="${file.url}" target="_blank">Open</a><a href="${file.url}" download>⬇</a>`;
        return row;
    }));
    if (!list?.length) ui.exports.innerHTML = '<span class="hint">None yet.</span>';
}

// ------------------------------------------------------------------ wiring

ui.play.onclick = togglePlay;
ui.back.onclick = () => { ui.video.pause(); ui.video.currentTime = Math.max(0, ui.video.currentTime - FRAME()); };
ui.fwd.onclick = () => { ui.video.pause(); ui.video.currentTime = Math.min(meta.duration, ui.video.currentTime + FRAME()); };
ui.setIn.onclick = () => {
    const t = ui.video.currentTime;
    selection = [t, Math.max(t + 0.05, selection?.[1] ?? meta.duration)];
    drawTimeline();
};
ui.setOut.onclick = () => {
    const t = ui.video.currentTime;
    selection = [Math.min(t - 0.05, selection?.[0] ?? 0), t].map((v) => Math.max(0, v));
    drawTimeline();
};
ui.keep.onclick = keepSelection;
ui.cut.onclick = cutSelection;
ui.speedSel.onclick = speedSelection;
ui.undo.onclick = undo;
ui.reset.onclick = () => resetEdit(true);
ui.preset.onchange = () => { if (ui.preset.value !== 'custom') applyPreset(+ui.preset.value); };
for (const input of [ui.format, ui.outW, ui.outH, ui.fit, ui.fps, ui.mode, ui.quality, ui.targetMb, ui.encSpeed, ui.audio, ui.audioKbps]) {
    input.addEventListener(input.type === 'range' ? 'input' : 'change', () => outputChanged(true));
}
for (const input of [ui.limitMb, ui.limitMin, ui.limitMax]) input.addEventListener('change', () => checkLimits(lastEstimate));
ui.outSwap.onclick = () => {
    [ui.outW.value, ui.outH.value] = [ui.outH.value, ui.outW.value];
    outputChanged(true);
};
ui.export.onclick = startExport;
ui.frameShot.onclick = async () => {
    const shot = await api('frame', { id: meta.id, t: ui.video.currentTime, crop });
    window.open(shot.url, '_blank');
    showExports((await api(`meta?id=${encodeURIComponent(meta.id)}`)).exports);
};
ui.pick.onchange = () => { location.search = `?id=${encodeURIComponent(ui.pick.value)}`; };
ui.openFolder.onclick = () => api(`open?id=${encodeURIComponent(meta?.id ?? '')}`, {});
ui.remove.onclick = async () => {
    if (!meta || !confirm(`Delete the recording ${meta.id} and its exports?`)) return;
    await api(`delete?id=${encodeURIComponent(meta.id)}`, {});
    location.search = '';
};

window.addEventListener('keydown', (event) => {
    if (!meta || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    const key = event.key.toLowerCase();
    if (key === ' ') { event.preventDefault(); togglePlay(); }
    else if (key === 'arrowleft') ui.back.onclick();
    else if (key === 'arrowright') ui.fwd.onclick();
    else if (key === 'i') ui.setIn.onclick();
    else if (key === 'o') ui.setOut.onclick();
    else if (key === 'k') keepSelection();
    else if (key === 'x' || key === 'delete') cutSelection();
    else if (key === 's' && !event.ctrlKey) speedSelection();
    else if (key === 'z' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); undo(); }
    else if (key === 'escape') { selection = null; drawTimeline(); }
    else if (key === 'home') ui.video.currentTime = segments[0]?.start ?? 0;
});
new ResizeObserver(() => { if (meta) { layoutCrop(); drawTimeline(); } }).observe(ui.viewer);

void start();
