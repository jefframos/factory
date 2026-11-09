// Types for mob-grade-key.js (the grader imports it from TypeScript).
export function stableStringify(value: unknown): string;
export function hashString(text: string): string;
export function levelHash(level: unknown): string;
export function contextHash(index: number, before: readonly unknown[], settings: unknown): string;
export function gradeColour(score: number): string;
export function gradeWord(score: number): string;
