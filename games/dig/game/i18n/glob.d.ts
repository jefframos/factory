// Vite's import.meta.glob (the project's tsconfig doesn't include vite/client), used by Localization.ts.
interface ImportMeta {
    glob<T = unknown>(pattern: string, options?: { eager?: boolean }): Record<string, T>;
}
