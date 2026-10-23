/**
 * Storage for the debug overlay.
 *
 * - Panel settings (what Apply saves) go in cookies, one logical entry per panel. Cookies cap at
 *   ~4KB each, so an entry is split across numbered chunk cookies when it's bigger than that.
 * - Overlay layout (panel positions, minimized/closed, launcher spot) is a per-browser convenience
 *   and lives in localStorage. Both are best-effort: blocked storage just means nothing is
 *   remembered, never an error.
 */

const COOKIE_PREFIX = 'dbo_';
const CHUNK_SIZE = 3600;
const MAX_CHUNKS = 12;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const UI_STATE_KEY = 'daybreak-debug-overlay-ui';

function sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readCookie(name: string): string | null {
    try {
        const prefix = `${name}=`;

        for (const part of document.cookie.split(';')) {
            const trimmed = part.trim();

            if (trimmed.startsWith(prefix)) {
                return trimmed.slice(prefix.length);
            }
        }
    } catch {
        // Cookies unavailable (sandboxed iframe, etc).
    }

    return null;
}

function writeCookie(name: string, value: string, maxAge = COOKIE_MAX_AGE_SECONDS): void {
    try {
        document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
    } catch {
        // Ignored - see readCookie.
    }
}

function deleteCookie(name: string): void {
    writeCookie(name, '', 0);
}

export class DebugSettingsStore {
    constructor(private readonly namespace: string) { }

    private cookieName(panelId: string): string {
        return `${COOKIE_PREFIX}${sanitize(this.namespace)}_${sanitize(panelId)}`;
    }

    public load(panelId: string): Record<string, unknown> | null {
        const name = this.cookieName(panelId);
        const count = parseInt(readCookie(`${name}_n`) ?? '', 10);

        if (!Number.isFinite(count) || count <= 0) {
            return null;
        }

        let encoded = '';

        for (let i = 0; i < count; i++) {
            const chunk = readCookie(`${name}_${i}`);

            if (chunk === null) {
                return null;
            }

            encoded += chunk;
        }

        try {
            const parsed = JSON.parse(decodeURIComponent(encoded));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    /** False when the entry is too big to fit in the cookie budget (nothing is written then). */
    public save(panelId: string, data: Record<string, unknown>): boolean {
        const name = this.cookieName(panelId);
        const encoded = encodeURIComponent(JSON.stringify(data));
        const chunks: string[] = [];

        let start = 0;

        while (start < encoded.length) {
            let end = Math.min(encoded.length, start + CHUNK_SIZE);

            // Don't split a %XX escape across two cookies.
            if (end < encoded.length) {
                const escape = encoded.lastIndexOf('%', end - 1);

                if (escape >= end - 2) {
                    end = escape;
                }
            }

            chunks.push(encoded.slice(start, end));
            start = end;
        }

        if (chunks.length > MAX_CHUNKS) {
            return false;
        }

        this.clear(panelId);
        chunks.forEach((chunk, index) => writeCookie(`${name}_${index}`, chunk));
        writeCookie(`${name}_n`, String(chunks.length));

        return true;
    }

    public clear(panelId: string): void {
        const name = this.cookieName(panelId);

        for (let i = 0; i < MAX_CHUNKS; i++) {
            if (readCookie(`${name}_${i}`) !== null) {
                deleteCookie(`${name}_${i}`);
            }
        }

        deleteCookie(`${name}_n`);
    }
}

export interface DebugPanelUiState {
    closed?: boolean;
    minimized?: boolean;
    /** Set once the panel has been dragged out of the dock. */
    floating?: { x: number; y: number } | null;
    collapsedFolders?: Record<string, boolean>;
}

export interface DebugOverlayUiState {
    hidden?: boolean;
    launcher?: { x: number; y: number } | null;
    panels?: Record<string, DebugPanelUiState>;
}

export function loadUiState(): DebugOverlayUiState {
    try {
        const raw = window.localStorage.getItem(UI_STATE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function saveUiState(state: DebugOverlayUiState): void {
    try {
        window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
    } catch {
        // Storage blocked/full - layout just isn't remembered.
    }
}
