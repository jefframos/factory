// ffmpeg.mjs
//
// Finding ffmpeg, running it (with progress and a way to stop it), reading a file's facts from its banner, and building
// the export command from an edit (kept segments, each with its speed; a crop) and the output settings.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

let found = null;

/** ffmpeg: $FFMPEG_PATH, else the one on the PATH, else the project's @ffmpeg-installer/ffmpeg. */
export function ffmpegPath(cwd = process.cwd()) {
    if (found) return found;
    const candidates = [process.env.FFMPEG_PATH, 'ffmpeg'];
    try {
        candidates.push(createRequire(path.join(cwd, 'package.json'))('@ffmpeg-installer/ffmpeg').path);
    } catch {
        // Not installed in this project.
    }
    for (const candidate of candidates.filter(Boolean)) {
        const result = spawnSync(candidate, ['-hide_banner', '-version'], { encoding: 'utf8' });
        if (result.status === 0) return (found = candidate);
    }
    throw new Error('ffmpeg not found: put it on the PATH, set FFMPEG_PATH, or `npm i -D @ffmpeg-installer/ffmpeg`.');
}

/** Seconds from an ffmpeg time (hh:mm:ss.xx). */
const seconds = (time) => {
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600 + m * 60 + s;
};

/**
 * Runs ffmpeg with `args`. `onProgress(seconds)`: how far into the output it is. Returns { done, kill }: `done`
 * resolves when it ends well, rejects with the end of its log when not.
 */
export function run(args, onProgress) {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { windowsHide: true });
    let log = '';
    let killed = false;
    child.stderr.on('data', (data) => {
        const text = data.toString();
        log = (log + text).slice(-6000);
        const match = /time=(\d+:\d+:[\d.]+)/.exec(text);
        if (match && onProgress) onProgress(seconds(match[1]));
    });
    const done = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(log);
            else reject(new Error(killed ? 'stopped' : `ffmpeg failed (${code}):\n${log.slice(-1500)}`));
        });
    });
    return { done, kill: () => { killed = true; child.kill('SIGKILL'); } };
}

/** A file's duration, size, frame rate, video codec and whether it has sound (from ffmpeg's banner). */
export async function probe(file) {
    const result = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' });
    const text = result.stderr ?? '';
    const duration = /Duration: (\d+:\d+:[\d.]+)/.exec(text);
    const video = /Stream #.*Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(text);
    const fps = /Stream #.*Video:[^\n]*?([\d.]+) fps/.exec(text) ?? /Stream #.*Video:[^\n]*?([\d.]+) tbr/.exec(text);
    return {
        duration: duration ? seconds(duration[1]) : 0,
        codec: video?.[1] ?? '',
        width: video ? Number(video[2]) : 0,
        height: video ? Number(video[3]) : 0,
        fps: fps ? Math.round(Number(fps[1])) : 60,
        audio: /Stream #.*Audio:/.test(text),
    };
}

/** The atempo filters for `speed` (each atempo takes 0.5 to 2). */
function atempo(speed) {
    const parts = [];
    let left = speed;
    while (left > 2) { parts.push('atempo=2'); left /= 2; }
    while (left < 0.5) { parts.push('atempo=0.5'); left /= 0.5; }
    if (Math.abs(left - 1) > 1e-3) parts.push(`atempo=${left.toFixed(4)}`);
    return parts;
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** How long the edit plays for (its segments, each at its speed). */
export function editDuration(segments) {
    return segments.reduce((sum, s) => sum + (s.end - s.start) / (s.speed || 1), 0);
}

/** Quality (0 to 100, higher is better) as each encoder's CRF. */
const crf = {
    mp4: (q) => Math.round(40 - q * 0.25),
    webm: (q) => Math.round(52 - q * 0.32),
};
const VP9_SPEED = { fast: 5, balanced: 3, small: 1 };
const X264_PRESET = { fast: 'veryfast', balanced: 'medium', small: 'slow' };

/**
 * The ffmpeg arguments to export `input` (its facts: `meta`) with `edit` ({ segments: [{ start, end, speed }], crop:
 * { x, y, w, h } | null }) and `out` ({ format: mp4 | webm | gif, width, height, fit: cover | contain | stretch, fps,
 * compression: { mode: quality, quality } | { mode: size, mb }, speed: fast | balanced | small, audio, audioKbps }) to
 * `file`. `window` (optional { start, duration }, in the output's time): only that part (a sample, for estimates).
 * `videoKbps`: the bitrate for the size mode.
 */
export function exportArgs({ input, meta, edit, out, file, window, videoKbps }) {
    const segments = edit.segments.length ? edit.segments : [{ start: 0, end: meta.duration, speed: 1 }];
    const audio = meta.audio && out.audio && out.format !== 'gif';
    const graph = [];
    const pads = [];
    segments.forEach((s, i) => {
        const speed = s.speed || 1;
        graph.push(`[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[v${i}]`);
        pads.push(`[v${i}]`);
        if (audio) {
            graph.push(`[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS${atempo(speed).map((f) => `,${f}`).join('')}[a${i}]`);
            pads.push(`[a${i}]`);
        }
    });
    graph.push(`${pads.join('')}concat=n=${segments.length}:v=1:a=${audio ? 1 : 0}[vc]${audio ? '[ac]' : ''}`);

    const video = [];
    if (edit.crop) {
        const { x, y, w, h } = edit.crop;
        video.push(`crop=${even(w)}:${even(h)}:${Math.round(x)}:${Math.round(y)}`);
    }
    // A steady frame rate (the recording's is variable).
    video.push(`fps=${out.fps || meta.fps || 60}`);
    if (out.width && out.height) {
        const w = even(out.width);
        const h = even(out.height);
        if (out.fit === 'stretch') video.push(`scale=${w}:${h}:flags=lanczos`, 'setsar=1');
        else if (out.fit === 'contain') video.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1');
        else video.push(`scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${w}:${h}`, 'setsar=1');
    } else if (out.width || out.height) {
        // One side given: the other follows the picture's shape.
        video.push(`scale=${out.width ? even(out.width) : -2}:${out.height ? even(out.height) : -2}:flags=lanczos`, 'setsar=1');
    } else {
        video.push('scale=trunc(iw/2)*2:trunc(ih/2)*2', 'setsar=1');
    }
    if (window) video.push(`trim=start=${window.start.toFixed(3)}:duration=${window.duration.toFixed(3)}`, 'setpts=PTS-STARTPTS');
    const quality = out.compression?.quality ?? 75;
    if (out.format === 'gif') {
        const colours = Math.round(32 + Math.max(0, Math.min(100, quality)) * 2.24);
        graph.push(`[vc]${video.join(',')},split[g1][g2];[g1]palettegen=max_colors=${colours}:stats_mode=diff[p];[g2][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle[vout]`);
    } else {
        graph.push(`[vc]${video.join(',')},format=yuv420p[vout]`);
    }
    if (audio) graph.push(`[ac]${window ? `atrim=start=${window.start.toFixed(3)}:duration=${window.duration.toFixed(3)},asetpts=PTS-STARTPTS` : 'anull'}[aout]`);

    const args = ['-i', input, '-filter_complex', graph.join(';'), '-map', '[vout]'];
    if (audio) args.push('-map', '[aout]');
    else args.push('-an');
    const sizeMode = out.compression?.mode === 'size' && videoKbps;
    if (out.format === 'mp4') {
        args.push('-c:v', 'libx264', '-preset', X264_PRESET[out.speed] ?? 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
        if (sizeMode) args.push('-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.5)}k`, '-bufsize', `${videoKbps * 2}k`);
        else args.push('-crf', String(crf.mp4(quality)));
        if (audio) args.push('-c:a', 'aac', '-b:a', `${out.audioKbps || 128}k`);
    } else if (out.format === 'webm') {
        args.push('-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', String(VP9_SPEED[out.speed] ?? 3), '-pix_fmt', 'yuv420p');
        if (sizeMode) args.push('-b:v', `${videoKbps}k`);
        else args.push('-crf', String(crf.webm(quality)), '-b:v', '0');
        if (audio) args.push('-c:a', 'libopus', '-b:a', `${out.audioKbps || 128}k`);
    } else {
        args.push('-loop', '0');
    }
    args.push(file);
    return args;
}

/** The video bitrate (kbps) to land a `seconds` long export under `mb` (1 MB = 1,000,000 bytes), sound included. */
export function bitrateFor(mb, seconds, audioKbps, margin = 0.95) {
    const total = (mb * 8000 * margin) / Math.max(0.5, seconds);
    return Math.max(80, Math.round(total - (audioKbps || 0)));
}
