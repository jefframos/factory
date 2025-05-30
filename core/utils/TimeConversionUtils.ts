export class TimerConversionUtils {
    private static pad(value: number, length: number = 2): string {
        return value.toString().padStart(length, '0');
    }

    public static toSeconds(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        return this.pad(seconds);
    }

    public static toMinutesSeconds(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${this.pad(minutes)}:${this.pad(seconds)}`;
    }

    public static toHoursMinutesSeconds(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}`;
    }

    public static toMinutesSecondsMilliseconds(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const milliseconds = ms % 1000;
        return `${this.pad(minutes)}:${this.pad(seconds)}:${this.pad(milliseconds, 4)}`;
    }
    public static toUncappedMinutesSeconds(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${this.pad(minutes)}:${this.pad(seconds)}`;
    }
}
