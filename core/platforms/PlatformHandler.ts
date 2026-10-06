import { Signal } from "signals";
import SoundManager from "core/audio/SoundManager";
import { DevGuiManager } from "core/utils/DevGuiManager";
import { IPlatformConnection } from "./IPlatformConnection";

/**
 * An analytics event's action. Any string works; these carry special meaning (Poki's game events,
 * https://developers.poki.com/guide/game-events):
 *   - 'start' / 'complete' / 'fail': a progression funnel (level, tutorial, quest). Send 'start',
 *     then exactly ONE of 'complete' or 'fail' per attempt, never both.
 *   - 'visible' / 'interact': a UI element (a shop button, a rewarded-ad offer) was shown / used.
 *     Send them as pairs for the same (category, what).
 * Anything else is a one-off custom event, e.g. ('difficulty', 'hard', 'selected').
 */
export type AnalyticsAction = 'start' | 'complete' | 'fail' | 'visible' | 'interact' | (string & {});

/** Characters Poki reserves (`/` for event paths, `^` to join the three values) — replaced in every value. */
const RESERVED_ANALYTICS_CHARS = /[/^]/g;

export default class PlatformHandler {
    public static ENABLE_VIDEO_ADS = true;
    public static GAME_ID = "YOUR_GAME_ID_HERE";
    public isGameplayActive = false;

    public readonly onPause: Signal = new Signal();
    public readonly onResume: Signal = new Signal();

    private static _instance: PlatformHandler;

    private constructor() { }

    public static get instance(): PlatformHandler {
        if (!PlatformHandler._instance) {
            PlatformHandler._instance = new PlatformHandler();
        }
        return PlatformHandler._instance;
    }

    private _platform?: IPlatformConnection;
    public get platform(): IPlatformConnection {
        return this._platform;
    }
    public set platform(value: IPlatformConnection) {
        this._platform = value;
    }

    public async initialize(platform: IPlatformConnection): Promise<void> {
        this.platform = platform;

        await this.platform.initialize();

        await this.platform?.onPause?.(() => {
            console.log("GAME PAUSED");
            this.onPause.dispatch();
        });

        await this.platform?.onResume?.(() => {
            console.log("GAME RESUMED");
            this.onResume.dispatch();
        });

        await this.platform?.onAudioChanged?.((enabled) => {
            console.log("AUDIO ENABLED", enabled);

            // Platform mute (e.g. YouTube's own mute button) must always win
            // over the in-game toggle — setPlatformMuted keeps it as a
            // separate flag ANDed against the player's own preference,
            // rather than sharing setMuted's single Howler.mute() call (see
            // SoundManager's own docs — that used to let the in-game toggle
            // undo a platform mute).
            SoundManager.instance.setPlatformMuted(!enabled);
        });
    }

    /**
     * Sends a game analytics event to the current platform (Poki: PokiSDK.measure()) — e.g.
     * measure('level', 3, 'start'), measure('tutorial', 'fill-shelf', 'complete'),
     * measure('button', 'shop', 'visible'). See AnalyticsAction for the special actions.
     *
     * Use stable values that stay comparable across versions (ids, not display text). Call it at
     * the exact moment the thing happens. Ads are already tracked by the platform's own ad calls,
     * so only measure the in-game offer that leads to one, not the ad itself.
     *
     * Safe to call anytime: values are trimmed, `/` and `^` become `-`, an event with an empty
     * value is dropped, it's a no-op before initialize() or on a platform without analytics, and
     * a throwing SDK is caught — analytics never breaks gameplay.
     */
    public measure(category: string, what: string | number, action: AnalyticsAction): void {
        const values = [category, what, action].map(value => String(value).trim().replace(RESERVED_ANALYTICS_CHARS, '-'));
        if (values.some(value => value.length === 0)) {
            console.warn('[Analytics] dropped an event with an empty value:', category, what, action);
            return;
        }
        const [cleanCategory, cleanWhat, cleanAction] = values;
        try {
            this._platform?.measure?.(cleanCategory, cleanWhat, cleanAction);
        } catch (e) {
            console.warn('[Analytics] platform measure() failed', e);
        }
    }

    /**
     * Dev-only "Pause Game" toggle that dispatches this same onPause/onResume signal every
     * scene already listens to for a REAL platform pause (see MergeScene.ts/IslandViewScene.ts's
     * identical PlatformHandler.instance.onPause/onResume wiring) — lets any game's own dev build
     * exercise that pause flow on demand, without waiting on an actual platform SDK callback (most
     * platform wrappers here don't implement onPause/onResume at all yet — see
     * IPlatformConnection's own doc).
     *
     * Call this AFTER DevGuiManager.instance.initialize(Game.debugParams.dev) in each game's
     * index.ts — DevGuiManager.addToggle() is a same-tick no-op if the GUI hasn't been built yet
     * (see DevGuiManager.ts), and initialize() runs well before that point in every game's own
     * startup sequence.
     */
    public setupDevPauseToggle(): void {
        DevGuiManager.instance.addToggle('Pause Game', false, (paused) => {
            if (paused) {
                this.onPause.dispatch();
            } else {
                this.onResume.dispatch();
            }
        }, 'Platform');
    }

}