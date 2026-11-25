// Numbers.ts
//
// Big numbers, short: 1234 -> 1.2K.

const UNITS = ['', 'K', 'M', 'B', 'T'];

export function shortNumber(value: number): string {
    if (value < 1000) return String(Math.round(value));
    const power = Math.min(UNITS.length - 1, Math.floor(Math.log10(value) / 3));
    const scaled = value / Math.pow(1000, power);
    return `${scaled < 10 ? scaled.toFixed(2).replace(/0$/, '') : scaled < 100 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.floor(scaled)}${UNITS[power]}`;
}

export const shortMoney = (value: number): string => `$${value < 10000 ? Math.round(value).toLocaleString('en-US') : shortNumber(value)}`;
