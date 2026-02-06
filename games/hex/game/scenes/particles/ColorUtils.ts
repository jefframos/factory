export class ColorUtils {
    static lerpColor(a: number, b: number, t: number): number {
        const ar = (a >> 16) & 0xFF;
        const ag = (a >> 8) & 0xFF;
        const ab = a & 0xFF;

        const br = (b >> 16) & 0xFF;
        const bg = (b >> 8) & 0xFF;
        const bb = b & 0xFF;

        const rr = Math.round(ar + (br - ar) * t);
        const rg = Math.round(ag + (bg - ag) * t);
        const rb = Math.round(ab + (bb - ab) * t);

        return (rr << 16) + (rg << 8) + rb;
    }

    static randomColorBetween(a: number, b: number): number {
        return this.lerpColor(a, b, Math.random());
    }
}