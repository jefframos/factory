export interface GradientStop {
    color: number;
    position: number;
}

export class ColorGradient {
    private stops: GradientStop[] = [];

    constructor(input: number[] | GradientStop[]) {
        if (typeof input[0] === 'number') {
            // Auto-calculate positions for raw number array [0x000, 0xfff]
            const colors = input as number[];
            this.stops = colors.map((color, i) => ({
                color,
                position: i / (colors.length - 1 || 1)
            }));
        } else {
            // Use provided stops and ensure they are sorted by position
            this.stops = [...(input as GradientStop[])].sort((a, b) => a.position - b.position);
        }
    }

    /**
     * Evaluates the color at a normalized position (0 to 1)
     */
    public evaluate(percent: number): number {
        const t = Math.max(0, Math.min(1, percent));

        if (this.stops.length === 0) return 0xffffff;
        if (t <= this.stops[0].position) return this.stops[0].color;
        if (t >= this.stops[this.stops.length - 1].position) return this.stops[this.stops.length - 1].color;

        // Find the bounding stops
        let i = 0;
        while (t > this.stops[i + 1].position) i++;

        const st1 = this.stops[i];
        const st2 = this.stops[i + 1];

        // Local interpolation factor between these two stops
        const localT = (t - st1.position) / (st2.position - st1.position);
        return this.lerpColor(st1.color, st2.color, localT);
    }

    private lerpColor(c1: number, c2: number, t: number): number {
        const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
        const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;

        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);

        return (r << 16) | (g << 8) | b;
    }
}