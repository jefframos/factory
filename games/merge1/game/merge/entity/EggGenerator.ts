export class EggGenerator {
    public progress: number = 0;
    public static readonly MAX_TIME = 5;
    private speedUpActive: boolean = false;

    constructor(private onEggReady: () => boolean) { }

    public activateSpeedUp(duration: number): void {
        this.speedUpActive = true;
        setTimeout(() => {
            this.speedUpActive = false;
        }, duration);
    }

    public update(delta: number): void {
        const multiplier = this.speedUpActive ? 10 : 1;
        this.progress += delta * multiplier;

        if (this.progress >= EggGenerator.MAX_TIME) {
            const spawned = this.onEggReady();

            // Only consume the timer if we actually spawned an egg.
            if (spawned) {
                this.progress = 0;
            } else {
                // Keep it “ready” so we retry next frame.
                this.progress = EggGenerator.MAX_TIME;
            }
        }
    }

    public get ratio(): number {
        return this.progress / EggGenerator.MAX_TIME;
    }
}
