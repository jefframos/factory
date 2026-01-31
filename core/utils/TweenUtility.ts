export class TweenUtil {
    /**
     * Standard Linear Interpolation
     */
    static lerp(start: number, end: number, t: number): number {
        return start * (1 - t) + end * t;
    }

    /**
     * Map a value from one range to another
     */
    static map(val: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
        return ((val - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
    }

    // --- EASING FUNCTIONS ---

    // Smooth acceleration
    static easeInQuad(t: number): number {
        return t * t;
    }

    // Smooth deceleration (Great for UI opening)
    static easeOutQuad(t: number): number {
        return t * (2 - t);
    }

    // Acceleration then deceleration
    static easeInOutQuad(t: number): number {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    // Bouncy finish (Perfect for a "Present" box pop)
    static easeOutBack(t: number): number {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    // --- GENERATOR EFFECTS ---

    /**
     * Creates a oscillating value (sine wave)
     * Useful for making the icon "vibrate" or hover.
     */
    static sinWave(time: number, speed: number, amplitude: number): number {
        return Math.sin(time * speed) * amplitude;
    }
}