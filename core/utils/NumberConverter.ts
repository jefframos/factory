export class NumberConverter {
    // Standard naming stops at Trillion
    private static readonly NAMES = ["", "k", "M", "B", "T"];

    /**
     * Formats numbers to a max of 4 digits. 
     * Transition: 999T -> 1.00aa
     */
    public static format(value: number): string {
        if (value === 0) return "0";
        if (value < 1000) return Math.floor(value).toString();

        // Calculate the tier (3 = k, 6 = M, 9 = B, 12 = T, 15 = aa...)
        const tier = Math.floor(Math.log10(Math.abs(value)) / 3);
        const suffix = this.getSuffix(tier);

        // Scale the number down to the 1-999 range
        const scaled = value / Math.pow(10, tier * 3);

        let formatted: string;

        // Constraint: Max 4 characters (excluding punctuation)
        // Examples: "1.23k", "12.3k", "123k", "1.23aa"
        if (scaled >= 100) {
            formatted = scaled.toFixed(0);
        } else if (scaled >= 10) {
            formatted = scaled.toFixed(1);
        } else {
            formatted = scaled.toFixed(2);
        }

        // Clean up trailing .0 or .00 (e.g., "10.0k" -> "10k")
        return formatted.replace(/\.?0+$/, "") + suffix;
    }

    private static getSuffix(tier: number): string {
        // Return standard k, M, B, T
        if (tier < this.NAMES.length) {
            return this.NAMES[tier];
        }

        // Calculate aa, ab, ac... starting from tier 5 (10^15)
        const alphaIndex = tier - this.NAMES.length;

        // 97 is ASCII for 'a'
        const firstChar = String.fromCharCode(97 + Math.floor(alphaIndex / 26));
        const secondChar = String.fromCharCode(97 + (alphaIndex % 26));

        return firstChar + secondChar;
    }
}