// PlaytestSession.ts
//
// Entry point for playtests — see this folder's README.md. Started by PizzaScene.build() from the
// page URL:
//
//   ?bot                 the bot plays ('efficient'); ?bot=casual for the distracted-human style
//   &speed=8             game speed while it plays (GameClock.setSpeed; default 8)
//   &minutes=40          stop after this many GAME minutes (default 40)
//   &fresh               start from a wiped save (index.ts) — otherwise it continues YOUR save
//   ?record              no bot: records YOU playing; press Report on the panel when done
//   &botnav              draw the bot's walkability map + route on the ground (NavDebugOverlay.ts)
//
// Owns the recorder (always), the bot (bot mode), a small status panel (top-right, DOM) and the
// end of the run: the demo-end popup, the time limit, or nothing happening for STALL_END_SEC — then
// it builds the report (PlaytestAnalysis + PlaytestReport) and shows it over the game.

import PlaytestRecorder, { PlaytestData } from './PlaytestRecorder';
import PlaytestBot, { BotStyle, PlaytestHost } from './PlaytestBot';
import { analyzePlaytest } from './PlaytestAnalysis';
import NavDebugOverlay from './NavDebugOverlay';
import { buildPlaytestReportHtml, buildPlaytestReportText } from './PlaytestReport';
import { GameClock } from '../utils/GameClock';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import { StoreProgressStorage } from '../store/StoreProgressStorage';

const DEFAULT_SPEED = 8;
const DEFAULT_MINUTES = 40;
/** No analytics event at all for this long (game time) = the bot is stuck for good — end the run. */
const STALL_END_SEC = 8 * 60;
/** Real ms after the scene builds before the bot takes over (lets the first frames settle). */
const START_DELAY_MS = 1500;
/** After the demo-end popup, keep recording this long (game time) before reporting. */
const DEMO_END_GRACE_SEC = 5;
const PANEL_REFRESH_MS = 500;
/** Speed buttons on the panel (bot mode). */
const SPEED_OPTIONS = [1, 2, 5, 10];

/** Panel choices (speed, free cam) remembered across reloads — a debug convenience, not part of the save (?fresh keeps it). */
const SETTINGS_KEY = 'pizza.playtestBotSettings';

interface BotSettings {
    speed?: number;
    freeCam?: boolean;
}

function loadSettings(): BotSettings {
    try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as BotSettings;
    } catch {
        return {};
    }
}

function saveSettings(patch: BotSettings): void {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
    } catch {
        // Storage blocked — the panel still works, it just won't remember.
    }
}

function params(): URLSearchParams {
    return new URLSearchParams(window.location.search);
}

/** ?fresh with ?bot or ?record — index.ts wipes the save before anything loads. */
export function wantsFreshPlaytestSave(): boolean {
    const p = params();
    return p.has('fresh') && (p.has('bot') || p.has('record'));
}

export default class PlaytestSession {
    /** From the page URL — undefined when this isn't a playtest. */
    public static fromUrl(host: PlaytestHost): PlaytestSession | undefined {
        const p = params();
        if (!p.has('bot') && !p.has('record')) {
            return undefined;
        }
        const bot = p.has('bot');
        const style: BotStyle = p.get('bot') === 'casual' ? 'casual' : 'efficient';
        // The last speed picked on the panel wins over &speed / the default.
        const speed = bot ? Math.max(1, loadSettings().speed || Number(p.get('speed')) || DEFAULT_SPEED) : 1;
        const minutes = Math.max(1, Number(p.get('minutes')) || DEFAULT_MINUTES);
        return new PlaytestSession(host, bot ? style : undefined, speed, minutes);
    }

    private readonly recorder: PlaytestRecorder;
    private bot?: PlaytestBot;
    private readonly startRealMs = performance.now();
    private ended = false;
    private demoEndedAtSec?: number;
    private panel?: HTMLDivElement;
    private panelText?: HTMLDivElement;
    private lastPanelMs = 0;
    private lastPanelRealMs = 0;
    private lastPanelGameSec = 0;
    private reportLayer?: HTMLDivElement;
    private navOverlay?: NavDebugOverlay;
    /** Stop pressed — the bot is off (you have control) until Resume. Recording continues. */
    private botStopped = false;
    private botStartedOnce = false;
    /** Game time of the last Resume — the stall check counts from here, not from before the stop. */
    private resumedAtSec = 0;
    private stopButton?: HTMLButtonElement;
    private freeCamButton?: HTMLButtonElement;
    private readonly speedButtons = new Map<number, HTMLButtonElement>();
    /** Set when the run ends — what __pizzaPlaytest.result() hands the headless runner. */
    private result?: { text: string; data: PlaytestData };

    private constructor(
        private readonly host: PlaytestHost,
        private readonly style: BotStyle | undefined,
        private speed: number,
        private readonly minutes: number,
    ) {
        this.recorder = new PlaytestRecorder(() => host.getStores(), () => host.isPlayerFrozen(), style ? 'bot' : 'human', speed, style);
        this.buildPanel();
        (window as unknown as { __pizzaPlaytest?: unknown }).__pizzaPlaytest = {
            report: () => this.end('requested'),
            data: () => this.recorder.snapshot(),
            /** The text report so far, without ending the run — e.g. copy(__pizzaPlaytest.text()) in the console. */
            text: () => {
                const snapshot = this.recorder.snapshot();
                return buildPlaytestReportText(snapshot, analyzePlaytest(snapshot));
            },
            stop: () => this.end('stopped'),
            /** For the headless runner (tools/playtest/run-playtest.mjs) — polled every couple of seconds. */
            state: () => ({
                ended: this.ended,
                endReason: this.result?.data.endReason,
                gameTimeSec: this.recorder.gameTimeSec,
                speed: GameClock.getSpeed(),
                money: EconomyStorage.getBalance(CurrencyType.Money),
                levels: Object.fromEntries(this.host.getStores().map(store => [store.getId(), StoreProgressStorage.getLevel(store.getId())])),
                doing: this.bot?.getGoalLabel() ?? '',
            }),
            /** The finished run's text report and raw data — undefined until it ends. */
            result: () => this.result,
        };
        console.log(`[Playtest] ${style ? `bot (${style}) at ${speed}x for ${minutes} game min` : 'recording a human session'} — window.__pizzaPlaytest.report() to finish early`);
    }

    public fixedUpdate(delta: number): void {
        if (this.ended) {
            return;
        }
        this.recorder.fixedUpdate(delta);
        this.bot?.fixedUpdate(delta);
        this.checkEnd();
    }

    /** Every render frame — runs while the world is paused too. */
    public update(): void {
        if (this.ended) {
            return;
        }
        if (this.style && !this.bot && !this.botStopped && performance.now() - this.startRealMs >= START_DELAY_MS) {
            this.bot = new PlaytestBot(this.host, this.recorder, this.style, name => this.handlePopupClosed(name));
            GameClock.setSpeed(this.speed);
            if (!this.botStartedOnce && loadSettings().freeCam) {
                this.setFreeCamera(true);
            }
            this.botStartedOnce = true;
        }
        this.recorder.update();
        this.bot?.update();
        if (this.bot && params().has('botnav')) {
            this.navOverlay ??= new NavDebugOverlay(this.host.scene);
            this.navOverlay.update(this.bot.getNav().getGrid(), this.bot.getPath(), this.host.player.transform.position);
        }
        this.refreshPanel();
    }

    public destroy(): void {
        this.bot?.stop();
        this.panel?.remove();
        this.reportLayer?.remove();
        this.navOverlay?.destroy();
    }

    private handlePopupClosed(name: string): void {
        if (/DemoEnd/i.test(name) || this.recorder.hasEvent('demoEnded')) {
            this.demoEndedAtSec ??= this.recorder.gameTimeSec;
        }
    }

    private checkEnd(): void {
        if (!this.style || this.botStopped) {
            return;
        }
        const t = this.recorder.gameTimeSec;
        if (this.demoEndedAtSec === undefined && this.recorder.hasEvent('demoEnded')) {
            this.demoEndedAtSec = t;
        }
        if (this.demoEndedAtSec !== undefined && t - this.demoEndedAtSec >= DEMO_END_GRACE_SEC) {
            this.end('reached the end of the demo');
        } else if (t >= this.minutes * 60) {
            this.end(`time limit (${this.minutes} game min)`);
        } else if (t - Math.max(this.recorder.lastEventTime(), this.resumedAtSec) >= STALL_END_SEC) {
            this.end(`nothing happened for ${STALL_END_SEC / 60} game min — stuck`);
        }
    }

    private end(reason: string): void {
        if (this.ended) {
            return;
        }
        this.ended = true;
        this.bot?.stop();
        this.bot = undefined;
        if (this.style) {
            GameClock.setSpeed(1);
        }
        const data = this.recorder.finish(reason);
        this.showReport(data);
    }

    // ---- DOM

    private buildPanel(): void {
        const panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;background:rgba(20,22,28,.88);color:#e8eaf0;'
            + 'font:12px/1.4 ui-monospace,Consolas,monospace;padding:8px 10px;border-radius:8px;max-width:340px;pointer-events:auto';
        const text = document.createElement('div');
        panel.appendChild(text);
        const buttons = document.createElement('div');
        buttons.style.cssText = 'margin-top:6px;display:flex;gap:6px';
        buttons.appendChild(this.button('Report', () => this.end('requested')));
        if (this.style) {
            this.stopButton = this.button('Stop', () => this.toggleBot());
            buttons.appendChild(this.stopButton);
            this.freeCamButton = this.button('Free cam', () => this.setFreeCamera(!this.host.isFreeCamera()));
            buttons.appendChild(this.freeCamButton);
        }
        panel.appendChild(buttons);
        if (this.style) {
            const speeds = document.createElement('div');
            speeds.style.cssText = 'margin-top:6px;display:flex;gap:6px';
            for (const speed of SPEED_OPTIONS) {
                const button = this.button(`${speed}x`, () => this.setSpeed(speed));
                this.speedButtons.set(speed, button);
                speeds.appendChild(button);
            }
            panel.appendChild(speeds);
            this.refreshSpeedButtons();
        }
        document.body.appendChild(panel);
        this.panel = panel;
        this.panelText = text;
    }

    /** Stop hands control back to you at 1x (recording continues); Resume restarts the bot at the chosen speed. */
    private toggleBot(): void {
        if (this.ended) {
            return;
        }
        this.botStopped = !this.botStopped;
        if (this.botStopped) {
            this.bot?.stop();
            this.bot = undefined;
            GameClock.setSpeed(1);
        } else {
            this.resumedAtSec = this.recorder.gameTimeSec;
        }
        if (this.stopButton) {
            this.stopButton.textContent = this.botStopped ? 'Resume' : 'Stop';
        }
        // Re-apply so the player's movement controller matches who's driving now.
        if (this.host.isFreeCamera()) {
            this.setFreeCamera(true);
        }
    }

    /** Fly camera instead of the follow camera (WASD/right-drag/wheel — see DebugFlyCameraController). */
    private setFreeCamera(enabled: boolean): void {
        this.host.setFreeCamera(enabled, !this.botStopped);
        saveSettings({ freeCam: enabled });
        this.refreshFreeCamButton();
    }

    private refreshFreeCamButton(): void {
        if (this.freeCamButton) {
            this.freeCamButton.style.background = this.host.isFreeCamera() ? '#4a6cf7' : '#2b3040';
        }
    }

    private setSpeed(speed: number): void {
        this.speed = speed;
        saveSettings({ speed });
        // Before the bot starts (or while stopped) it's applied when the bot (re)starts.
        if (this.bot) {
            GameClock.setSpeed(speed);
        }
        this.refreshSpeedButtons();
    }

    private refreshSpeedButtons(): void {
        for (const [speed, button] of this.speedButtons) {
            const active = speed === this.speed;
            button.style.background = active ? '#4a6cf7' : '#2b3040';
            button.style.borderColor = active ? '#7d95ff' : '#556';
        }
    }

    private button(label: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.textContent = label;
        button.style.cssText = 'font:inherit;padding:3px 10px;border-radius:6px;border:1px solid #556;background:#2b3040;color:#e8eaf0;cursor:pointer';
        button.addEventListener('click', onClick);
        return button;
    }

    private refreshPanel(): void {
        const now = performance.now();
        if (!this.panelText || now - this.lastPanelMs < PANEL_REFRESH_MS) {
            return;
        }
        this.lastPanelMs = now;
        // The debug menu's "Toggle Fly Camera" flips it too.
        this.refreshFreeCamButton();
        const t = this.recorder.gameTimeSec;
        // Achieved speed (game s per real s, over the last panel refresh) — drops below the set
        // speed when frames get too heavy for the fixed-step catch-up (core Game.ts clamps it).
        const realSec = (now - this.lastPanelRealMs) / 1000;
        const achieved = realSec > 0 && this.lastPanelRealMs > 0 ? (t - this.lastPanelGameSec) / realSec : 0;
        this.lastPanelRealMs = now;
        this.lastPanelGameSec = t;
        const levels = this.host.getStores().map(store => `${store.getId()} Lv ${StoreProgressStorage.getLevel(store.getId())}`).join(', ');
        const lines = [
            `PLAYTEST ${this.style ? `bot · ${this.style} · ${this.botStopped ? 'stopped' : `${GameClock.getSpeed()}x`}` : 'recording you'}`,
            `game ${formatTime(t)}${this.style ? ` / ${this.minutes}:00 · ${achieved.toFixed(1)}x real` : ''} · $${EconomyStorage.getBalance(CurrencyType.Money)}`,
            levels,
            this.bot ? this.bot.getGoalLabel() : (this.style && !this.botStopped ? 'starting…' : ''),
            this.bot?.getNextUnlockLabel() ?? '',
        ];
        this.panelText.textContent = '';
        for (const line of lines.filter(Boolean)) {
            const div = document.createElement('div');
            div.textContent = line;
            this.panelText.appendChild(div);
        }
    }

    private showReport(data: PlaytestData): void {
        const analysis = analyzePlaytest(data);
        const html = buildPlaytestReportHtml(data, analysis);
        const stamp = data.startedAtIso.replace(/[:.]/g, '-').slice(0, 19);

        const layer = document.createElement('div');
        layer.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);display:flex;flex-direction:column;padding:12px;gap:8px';
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
        const text = buildPlaytestReportText(data, analysis);
        this.result = { text, data };
        const copyButton = this.button('Copy report (text)', () => {
            void copyToClipboard(text).then(ok => {
                copyButton.textContent = ok ? `Copied (${Math.round(text.length / 1000)}k chars)` : 'Copy failed — see console';
                if (!ok) {
                    console.log(text);
                }
            });
        });
        bar.appendChild(copyButton);
        bar.appendChild(this.button('Download report (.html)', () => download(`pizza-playtest-${stamp}.html`, html, 'text/html')));
        bar.appendChild(this.button('Download data (.json)', () => download(`pizza-playtest-${stamp}.json`, JSON.stringify(data), 'application/json')));
        bar.appendChild(this.button('Close', () => layer.remove()));
        const frame = document.createElement('iframe');
        frame.style.cssText = 'flex:1;border:0;border-radius:10px;background:#fff';
        frame.srcdoc = html;
        layer.appendChild(bar);
        layer.appendChild(frame);
        document.body.appendChild(layer);
        this.reportLayer = layer;
        if (this.panelText) {
            this.panelText.textContent = `PLAYTEST ended — ${data.endReason}`;
        }
        console.log('[Playtest] findings', analysis.findings);
    }
}

function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/** navigator.clipboard where allowed, else the old hidden-textarea copy (plain http / no permission). */
async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    }
}

function download(name: string, content: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
