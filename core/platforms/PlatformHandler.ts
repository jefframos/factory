import { IPlatformConnection } from "./IPlatformConnection";

export let ENABLE_VIDEO_ADS = false;
export default class PlatformHandler {
    public isGameplayActive = false;

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

    public initialize(platform: IPlatformConnection): Promise<void> {
        this.platform = platform;
        console.log(this.platform)
        return this.platform.initialize()
    }

}