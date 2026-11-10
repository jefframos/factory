// api.mjs
//
// The recorder's server side, under /__recorder: the pages, the in-game hook, the recordings (streamed up in chunks
// while recording, then remuxed into a seekable source), size estimates, exports (ffmpeg jobs, with progress) and
// frame grabs. Recordings live in <outDir>/<id>/: raw.webm (as recorded), source.mp4|webm (seekable), meta.json,
// exports/.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bitrateFor, editDuration, exportArgs, probe, run } from './ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, '..');
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.svg': 'image/svg+xml',
};

export function createApi({ outDir, cwd }) {
    fs.mkdirSync(outDir, { recursive: true });
    /** Export jobs by id: { status: running | done | failed, progress (0..1), file, bytes, error }. */
    const jobs = new Map();
    /** The estimate running for each recording (a newer one stops it). */
    const estimates = new Map();

    const dirOf = (id) => {
        if (!/^[\w-]+$/.test(id ?? '')) throw new Error('bad id');
        return path.join(outDir, id);
    };
    const readMeta = (id) => JSON.parse(fs.readFileSync(path.join(dirOf(id), 'meta.json'), 'utf8'));

    function presets() {
        const base = JSON.parse(fs.readFileSync(path.join(TOOL, 'presets.json'), 'utf8'));
        // A project can add its own (recorder.presets.json at its root): same shape, listed first.
        const own = path.join(cwd, 'recorder.presets.json');
        if (fs.existsSync(own)) {
            const extra = JSON.parse(fs.readFileSync(own, 'utf8'));
            base.capture = [...(extra.capture ?? []), ...base.capture];
            base.export = [...(extra.export ?? []), ...base.export];
        }
        return base;
    }

    function list() {
        return fs.readdirSync(outDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(outDir, entry.name, 'meta.json')))
            .map((entry) => ({ ...readMeta(entry.name), exports: exportsOf(entry.name) }))
            .sort((a, b) => b.id.localeCompare(a.id));
    }

    function exportsOf(id) {
        const dir = path.join(dirOf(id), 'exports');
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter((name) => !name.startsWith('.')).map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size, url: `files/${id}/exports/${encodeURIComponent(name)}` }));
    }

    /** A recording finished: its raw file remuxed into one a page can seek in (h264 into mp4, vp8/9 into webm). */
    async function finish(id) {
        const dir = dirOf(id);
        const meta = readMeta(id);
        const raw = path.join(dir, meta.raw);
        if (!fs.existsSync(raw) || fs.statSync(raw).size < 1024) {
            fs.rmSync(dir, { recursive: true, force: true });
            throw new Error('The recording was empty: the browser recorded nothing (its encoder may refuse this size or frame rate). Try again: the recorder now checks each format first.');
        }
        const rawFacts = await probe(raw);
        const h264 = /h264|avc/i.test(rawFacts.codec);
        const source = h264 ? 'source.mp4' : 'source.webm';
        const args = ['-fflags', '+genpts', '-i', raw, '-c:v', 'copy'];
        if (rawFacts.audio) args.push(...(h264 ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'copy']));
        else args.push('-an');
        if (h264) args.push('-movflags', '+faststart');
        args.push(path.join(dir, source));
        await run(args).done;
        const facts = await probe(path.join(dir, source));
        const done = { ...meta, ...facts, fps: meta.fps || facts.fps, source, bytes: fs.statSync(path.join(dir, source)).size, finished: true };
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(done, null, 2));
        return done;
    }

    /** About how big the export would be: samples of it encoded (a few seconds across it), scaled to its length. */
    async function estimate(id, edit, out) {
        const meta = readMeta(id);
        const length = editDuration(edit.segments.length ? edit.segments : [{ start: 0, end: meta.duration, speed: 1 }]);
        const audioKbps = meta.audio && out.audio && out.format !== 'gif' ? out.audioKbps || 128 : 0;
        if (out.compression?.mode === 'size' && out.format !== 'gif') {
            const videoKbps = bitrateFor(out.compression.mb, length, audioKbps);
            return { bytes: Math.round(((videoKbps + audioKbps) * 1000 * length) / 8), seconds: length, sampled: false };
        }
        estimates.get(id)?.forEach((job) => job.kill());
        // Samples spread over it (a short one too: its start alone isn't like the rest).
        const count = Math.max(1, Math.min(5, Math.ceil(length / 3)));
        const span = Math.min(1.5, length / count);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-estimate-'));
        const running = [];
        estimates.set(id, running);
        try {
            let bytes = 0;
            for (let k = 0; k < count; k++) {
                const start = count === 1 ? 0 : ((length - span) * (k + 0.5)) / count;
                const file = path.join(tmp, `sample${k}.${out.format}`);
                const job = run(exportArgs({ input: path.join(dirOf(id), meta.source), meta, edit, out: { ...out, speed: out.speed === 'small' ? 'balanced' : out.speed }, file, window: { start, duration: span } }));
                running.push(job);
                await job.done;
                bytes += fs.statSync(file).size;
            }
            // The slowest setting is a little smaller than the one sampled with.
            const scale = out.speed === 'small' ? 0.92 : 1;
            return { bytes: Math.round((bytes / (count * span)) * length * scale), seconds: length, sampled: true };
        } finally {
            if (estimates.get(id) === running) estimates.delete(id);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }

    /** An export: encoded to <id>/exports/<name>; in the size mode, encoded again smaller while it's over (3 tries). */
    function startExport(id, edit, out, name) {
        const meta = readMeta(id);
        const dir = path.join(dirOf(id), 'exports');
        fs.mkdirSync(dir, { recursive: true });
        // Its name: the one given (or the recording's), its size, and a number if that's taken.
        const inW = edit.crop?.w ?? meta.width;
        const inH = edit.crop?.h ?? meta.height;
        const w = out.width || (out.height ? (out.height * inW) / inH : inW);
        const h = out.height || (out.width ? (out.width * inH) / inW : inH);
        const stem = `${(name || id).replace(/[^\w.-]+/g, '-')}-${Math.round(w / 2) * 2}x${Math.round(h / 2) * 2}`;
        let file = path.join(dir, `${stem}.${out.format}`);
        for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${stem}-${n}.${out.format}`);
        const jobId = `${id}-${Date.now()}`;
        const job = { status: 'running', progress: 0, file: path.basename(file), url: `files/${id}/exports/${encodeURIComponent(path.basename(file))}`, bytes: 0, error: '', tries: 0 };
        jobs.set(jobId, job);
        const length = editDuration(edit.segments.length ? edit.segments : [{ start: 0, end: meta.duration, speed: 1 }]);
        const audioKbps = meta.audio && out.audio && out.format !== 'gif' ? out.audioKbps || 128 : 0;
        const sizeMode = out.compression?.mode === 'size' && out.format !== 'gif';
        (async () => {
            let margin = 0.95;
            for (let attempt = 0; attempt < (sizeMode ? 3 : 1); attempt++) {
                job.tries = attempt + 1;
                const videoKbps = sizeMode ? bitrateFor(out.compression.mb, length, audioKbps, margin) : 0;
                const task = run(exportArgs({ input: path.join(dirOf(id), meta.source), meta, edit, out, file, videoKbps }), (t) => { job.progress = Math.min(0.99, t / length); });
                job.kill = task.kill;
                await task.done;
                job.bytes = fs.statSync(file).size;
                if (!sizeMode || job.bytes <= out.compression.mb * 1e6) break;
                margin *= (out.compression.mb * 1e6) / job.bytes * 0.93;
            }
            job.status = 'done';
            job.progress = 1;
            job.over = sizeMode && job.bytes > out.compression.mb * 1e6;
        })().catch((error) => {
            job.status = 'failed';
            job.error = String(error.message ?? error);
        });
        return jobId;
    }

    /** A still of the source at `t` (cropped as the edit's), as a PNG in exports/. */
    async function frame(id, t, crop) {
        const meta = readMeta(id);
        const dir = path.join(dirOf(id), 'exports');
        fs.mkdirSync(dir, { recursive: true });
        const name = `frame-${t.toFixed(2).replace('.', '_')}s.png`;
        const filters = crop ? [`crop=${Math.round(crop.w)}:${Math.round(crop.h)}:${Math.round(crop.x)}:${Math.round(crop.y)}`] : [];
        await run(['-ss', String(t), '-i', path.join(dirOf(id), meta.source), '-frames:v', '1', ...(filters.length ? ['-vf', filters.join(',')] : []), path.join(dir, name)]).done;
        return { name, url: `files/${id}/exports/${name}` };
    }

    function openFolder(target) {
        const command = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(command, [target], { detached: true, stdio: 'ignore' }).unref();
    }

    // ------------------------------------------------------------------ http

    const readBody = (req) => new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
    const readJson = async (req) => JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const send = (res, status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    };

    /** A file, with Range support (the editor's video seeks). */
    function serveFile(req, res, file) {
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.statusCode = 404;
            res.end('not found');
            return;
        }
        const size = fs.statSync(file).size;
        res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
        if (range) {
            const start = range[1] ? Number(range[1]) : size - Number(range[2]);
            const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', end - start + 1);
            fs.createReadStream(file, { start, end }).pipe(res);
            return;
        }
        res.setHeader('Content-Length', size);
        fs.createReadStream(file).pipe(res);
    }

    async function api(req, res, route, query) {
        if (route === 'presets') return send(res, 200, presets());
        if (route === 'list') return send(res, 200, list());
        if (route === 'meta') return send(res, 200, { ...readMeta(query.get('id')), exports: exportsOf(query.get('id')) });
        if (route === 'start' && req.method === 'POST') {
            const body = await readJson(req);
            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
            const id = `${stamp}-${body.width}x${body.height}`;
            fs.mkdirSync(dirOf(id), { recursive: true });
            const raw = /mp4/.test(body.mime ?? '') ? 'raw.mp4' : 'raw.webm';
            fs.writeFileSync(path.join(dirOf(id), raw), Buffer.alloc(0));
            fs.writeFileSync(path.join(dirOf(id), 'meta.json'), JSON.stringify({ id, raw, mime: body.mime, fps: body.fps, game: body.game ?? '', recordedWidth: body.width, recordedHeight: body.height, finished: false }, null, 2));
            return send(res, 200, { id });
        }
        if (route === 'chunk' && req.method === 'POST') {
            const id = query.get('id');
            const meta = readMeta(id);
            fs.appendFileSync(path.join(dirOf(id), meta.raw), await readBody(req));
            return send(res, 200, { ok: true });
        }
        if (route === 'finish' && req.method === 'POST') {
            try {
                return send(res, 200, await finish(query.get('id')));
            } catch (error) {
                return send(res, 500, { error: String(error.message ?? error) });
            }
        }
        if (route === 'estimate' && req.method === 'POST') {
            const body = await readJson(req);
            try {
                return send(res, 200, await estimate(body.id, body.edit, body.out));
            } catch (error) {
                return send(res, String(error.message).includes('stopped') ? 409 : 500, { error: String(error.message ?? error) });
            }
        }
        if (route === 'export' && req.method === 'POST') {
            const body = await readJson(req);
            return send(res, 200, { job: startExport(body.id, body.edit, body.out, body.name) });
        }
        if (route === 'job') {
            const job = jobs.get(query.get('job'));
            if (!job) return send(res, 404, { error: 'no such job' });
            const { kill: _kill, ...state } = job;
            return send(res, 200, state);
        }
        if (route === 'cancel' && req.method === 'POST') {
            jobs.get(query.get('job'))?.kill?.();
            return send(res, 200, { ok: true });
        }
        if (route === 'frame' && req.method === 'POST') {
            const body = await readJson(req);
            return send(res, 200, await frame(body.id, body.t, body.crop));
        }
        if (route === 'open' && req.method === 'POST') {
            const id = query.get('id');
            openFolder(id ? path.join(dirOf(id), fs.existsSync(path.join(dirOf(id), 'exports')) ? 'exports' : '') : outDir);
            return send(res, 200, { ok: true });
        }
        if (route === 'delete' && req.method === 'POST') {
            fs.rmSync(dirOf(query.get('id')), { recursive: true, force: true });
            return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: `no route ${route}` });
    }

    /** The middleware for /__recorder (its prefix already taken off req.url). */
    return async function handle(req, res, next) {
        try {
            const url = new URL(req.url, 'http://local');
            const route = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            // /__recorder without its slash: the pages' relative links need it.
            if (route === '' && !(req.originalUrl ?? '/').split('?')[0].endsWith('/')) {
                res.statusCode = 302;
                res.setHeader('Location', '/__recorder/');
                return res.end();
            }
            if (route === '' || route === 'index.html') return serveFile(req, res, path.join(TOOL, 'ui', 'index.html'));
            if (route === 'editor' || route === 'editor.html') return serveFile(req, res, path.join(TOOL, 'ui', 'editor.html'));
            if (route.startsWith('api/')) return await api(req, res, route.slice(4), url.searchParams);
            if (route.startsWith('files/')) {
                const file = path.resolve(outDir, route.slice(6));
                if (!file.startsWith(path.resolve(outDir))) return send(res, 403, { error: 'outside' });
                return serveFile(req, res, file);
            }
            const file = path.resolve(TOOL, route);
            if (!file.startsWith(TOOL) || !/^(ui|client)[\\/]/.test(path.relative(TOOL, file))) return next();
            return serveFile(req, res, file);
        } catch (error) {
            send(res, 500, { error: String(error.message ?? error) });
        }
    };
}
