export class EggGenerator {
    public progress: number = 0;
    private readonly MAX_TIME = 5;
    private speedUpActive: boolean = false;

    constructor(private onEggReady: () => void) { }

    public activateSpeedUp(duration: number): void {
        this.speedUpActive = true;
        setTimeout(() => this.speedUpActive = false, duration);
    }

    public update(delta: number): void {
        const multiplier = this.speedUpActive ? 5 : 1;
        this.progress += delta * multiplier;

        if (this.progress >= this.MAX_TIME) {
            this.progress = 0;
            this.onEggReady();
        }
    }

    public get ratio(): number { return this.progress / this.MAX_TIME; }
}