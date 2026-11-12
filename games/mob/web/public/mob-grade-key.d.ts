// Types for mob-grade-key.js (the grader imports it from TypeScript).
export function stableStringify(value: unknown): string;
export function hashString(text: string): string;
export function levelHash(level: unknown): string;
export function contextHash(index: number, before: readonly unknown[], settings: unknown): string;
export function coinsAt(before: readonly unknown[], settings: unknown): number;
export function loadoutKey(index: number, before: readonly unknown[], settings: unknown): string;
export function gradeHolds(grade: unknown, level: unknown, index: number, before: readonly unknown[], settings: unknown): boolean;
export function gradeColour(score: number): string;
export function gradeWord(score: number): string;
