const DEBUG = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("debug") === "1";

export function dbg(event: string, data: Record<string, unknown>): void {
    if (!DEBUG) return;
    const vals = Object.entries(data)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
    console.log(`[CLOG] ${event} | ${vals}`);
}

export function dbgTail(label: string, playerValue: number, tail: { value: number; isMerging: boolean; isLocked: boolean }[]): void {
    if (!DEBUG) return;
    const chain = [playerValue, ...tail.map(c => {
        let s = String(c.value);
        if (c.isMerging) s += "(M)";
        if (c.isLocked) s += "(L)";
        return s;
    })].join(" → ");
    console.log(`[CLOG] ${label} | ${chain}`);
}
