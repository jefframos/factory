export class CoinGenerator {
    public timer: number;
    public interval: number = 5; // 5 seconds in ms

    constructor(lastTimestamp: number, interval: number) {
        const now = Date.now();
        const elapsed = now - lastTimestamp;
        this.interval = interval;

        // Subtract elapsed time from the interval to catch up
        // if elapsed > 5000, it triggers immediately on first update
        this.timer = Math.max(0, this.interval - (elapsed % this.interval));
    }

    public update(deltaMS: number): boolean {
        this.timer -= deltaMS;
        if (this.timer <= 0) {
            this.timer = this.interval;
            return true; // Ready to drop a coin
        }
        return false;
    }
}