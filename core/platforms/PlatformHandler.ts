import { Signal } from "signals";
import SoundManager from "core/audio/SoundManager";
import { DevGuiManager } from "core/utils/DevGuiManager";
import { IPlatformConnection } from "./IPlatformConnection";

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