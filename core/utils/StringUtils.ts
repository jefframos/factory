export class StringUtils {
    static parseStringArray(input: string): string[] {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
                return parsed;
            }
            throw new Error('Parsed value is not a string array');
        } catch (e) {
            console.warn('Failed to parse string array:', e);
            return [];
        }
    }
}