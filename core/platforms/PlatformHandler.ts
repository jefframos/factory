import { Signal } from "signals";
import SoundManager from "core/audio/SoundManager";
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

            SoundManager.instance.setMuted(!enabled);
        });
    }

}