/** Injected once by DebugOverlay. Everything is scoped under `.dbo-root` so game CSS can't leak in or out. */
export const DEBUG_OVERLAY_CSS = `
.dbo-root {
    --dbo-bg: rgba(19, 21, 27, 0.94);
    --dbo-bg-raised: rgba(255, 255, 255, 0.045);
    --dbo-bg-hover: rgba(255, 255, 255, 0.09);
    --dbo-border: rgba(255, 255, 255, 0.09);
    --dbo-text: #e8eaf0;
    --dbo-muted: #8e96a8;
    --dbo-accent: #6ea8ff;
    --dbo-accent-soft: rgba(110, 168, 255, 0.2);
    --dbo-on-accent: #0a1222;
    --dbo-danger: #ff6b6b;
    --dbo-warn: #ffb547;
    --dbo-ok: #4fd18b;
    --dbo-row-h: 30px;
    --dbo-radius: 12px;
    --dbo-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.04) inset;
    --dbo-panel-w: 320px;

    position: fixed;
    inset: 0;
    z-index: 2147482000;
    pointer-events: none;
    color: var(--dbo-text);
    font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    -webkit-tap-highlight-color: transparent;
}
.dbo-root *, .dbo-root *::before, .dbo-root *::after { box-sizing: border-box; }
@media (pointer: coarse) {
    .dbo-root { --dbo-row-h: 40px; font-size: 13px; }
}

/* ---------- launcher ---------- */
.dbo-launcher {
    position: fixed;
    top: calc(12px + env(safe-area-inset-top, 0px));
    left: calc(12px + env(safe-area-inset-left, 0px));
    display: flex;
    align-items: stretch;
    height: 36px;
    pointer-events: auto;
    background: var(--dbo-bg);
    border: 1px solid var(--dbo-border);
    border-radius: 999px;
    box-shadow: var(--dbo-shadow);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
}
.dbo-launcher button {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--dbo-text);
    font: inherit;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    cursor: pointer;
}
.dbo-launcher button:hover { background: var(--dbo-bg-hover); }
.dbo-launcher .dbo-launcher-main { border-radius: 999px 0 0 999px; padding-left: 12px; font-weight: 600; }
.dbo-launcher .dbo-launcher-menu { border-radius: 0 999px 999px 0; border-left: 1px solid var(--dbo-border); color: var(--dbo-muted); padding-right: 12px; }
.dbo-launcher .dbo-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dbo-ok); box-shadow: 0 0 0 3px rgba(79, 209, 139, 0.2); }
.dbo-root.is-hidden .dbo-launcher .dbo-dot { background: var(--dbo-muted); box-shadow: none; }
.dbo-launcher .dbo-launcher-label { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.05; }
.dbo-launcher .dbo-launcher-fps { font-size: 9px; font-weight: 500; letter-spacing: 0.02em; color: var(--dbo-muted); font-variant-numeric: tabular-nums; }
.dbo-launcher .dbo-launcher-fps[data-level="good"] { color: var(--dbo-ok); }
.dbo-launcher .dbo-launcher-fps[data-level="ok"] { color: #f0b429; }
.dbo-launcher .dbo-launcher-fps[data-level="low"] { color: #ff6b6b; }

/* ---------- panel menu (launcher dropdown) ---------- */
.dbo-menu {
    position: fixed;
    min-width: 220px;
    max-width: calc(100vw - 24px);
    max-height: 60vh;
    overflow-y: auto;
    padding: 6px;
    pointer-events: auto;
    background: var(--dbo-bg);
    border: 1px solid var(--dbo-border);
    border-radius: var(--dbo-radius);
    box-shadow: var(--dbo-shadow);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}
.dbo-menu[hidden] { display: none; }
.dbo-menu-item {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--dbo-text);
    font: inherit;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--dbo-row-h);
    padding: 0 10px;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
}
.dbo-menu-item:hover { background: var(--dbo-bg-hover); }
.dbo-menu-item .dbo-check {
    width: 16px; height: 16px; border-radius: 5px; flex: none;
    border: 1.5px solid var(--dbo-muted);
    display: grid; place-items: center;
}
.dbo-menu-item.is-on .dbo-check { background: var(--dbo-accent); border-color: var(--dbo-accent); color: var(--dbo-on-accent); }
.dbo-menu-item .dbo-menu-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbo-menu-item .dbo-menu-hint { color: var(--dbo-muted); font-size: 11px; }
.dbo-menu-sep { height: 1px; background: var(--dbo-border); margin: 6px 4px; }
.dbo-menu-empty { color: var(--dbo-muted); padding: 8px 10px; }

/* ---------- dock (stack of docked panels) ---------- */
.dbo-stack {
    position: fixed;
    top: calc(58px + env(safe-area-inset-top, 0px));
    left: calc(12px + env(safe-area-inset-left, 0px));
    width: var(--dbo-panel-w);
    max-height: calc(100% - 70px - env(safe-area-inset-top, 0px));
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    overscroll-behavior: contain;
    pointer-events: none;
    scrollbar-width: none;
}
.dbo-stack::-webkit-scrollbar { display: none; }
.dbo-root.is-hidden .dbo-stack { display: none; }

/* ---------- panel ---------- */
.dbo-panel {
    pointer-events: auto;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--dbo-bg);
    border: 1px solid var(--dbo-border);
    border-radius: var(--dbo-radius);
    box-shadow: var(--dbo-shadow);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    overflow: hidden;
}
.dbo-panel.is-closed { display: none; }
.dbo-panel.is-floating {
    position: fixed;
    width: var(--dbo-panel-w);
    max-height: calc(100% - 24px);
    z-index: 1;
}
.dbo-panel.is-floating.is-front { z-index: 2; }
.dbo-panel.is-dragging { opacity: 0.92; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55); }

.dbo-header {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    padding: 0 6px 0 12px;
    flex: none;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    border-bottom: 1px solid var(--dbo-border);
}
.dbo-panel.is-dragging .dbo-header { cursor: grabbing; }
.dbo-panel.is-minimized .dbo-header { border-bottom-color: transparent; }
.dbo-title {
    flex: 1;
    min-width: 0;
    font-weight: 650;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dbo-hbtn {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--dbo-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    height: 28px;
    min-width: 28px;
    padding: 0 8px;
    border-radius: 8px;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    position: relative;
    flex: none;
}
.dbo-hbtn.is-icon { padding: 0; }
.dbo-hbtn:hover { background: var(--dbo-bg-hover); color: var(--dbo-text); }
.dbo-hbtn:disabled { opacity: 0.35; cursor: default; background: transparent; color: var(--dbo-muted); }
.dbo-hbtn.is-apply.is-dirty { background: var(--dbo-accent); color: var(--dbo-on-accent); }
.dbo-hbtn.is-apply.is-dirty:hover { filter: brightness(1.08); }
.dbo-hbtn svg { display: block; }
@media (pointer: coarse) {
    .dbo-header { height: 46px; }
    .dbo-hbtn { height: 34px; min-width: 34px; }
}

.dbo-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 0 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.dbo-panel.is-minimized .dbo-body { display: none; }
.dbo-empty { color: var(--dbo-muted); padding: 10px 12px; }

/* ---------- folders ---------- */
.dbo-folder-head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    font-weight: 600;
}
.dbo-folder-head:hover { background: var(--dbo-bg-raised); }
.dbo-chev { color: var(--dbo-muted); transition: transform 0.15s ease; flex: none; }
.dbo-folder.is-collapsed > .dbo-folder-head .dbo-chev { transform: rotate(-90deg); }
.dbo-folder.is-collapsed > .dbo-folder-body { display: none; }
.dbo-folder-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbo-folder-count { color: var(--dbo-muted); font-weight: 500; font-size: 11px; }
.dbo-folder-body { margin-left: 14px; border-left: 1px solid var(--dbo-border); }
.dbo-body > .dbo-folder { border-top: 1px solid var(--dbo-border); margin-top: 4px; padding-top: 2px; }
.dbo-body > .dbo-folder:first-child { border-top: 0; margin-top: 0; }
.dbo-body > .dbo-folder > .dbo-folder-head {
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--dbo-muted);
}
.dbo-body > .dbo-folder > .dbo-folder-body { margin-left: 0; border-left: 0; }
@media (pointer: coarse) { .dbo-folder-head { height: 38px; } }

/* ---------- rows ---------- */
.dbo-row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 38%) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: var(--dbo-row-h);
    padding: 2px 12px;
}
.dbo-row.is-stacked { grid-template-columns: minmax(0, 1fr); gap: 3px; padding-top: 4px; padding-bottom: 4px; }
.dbo-row.is-full { grid-template-columns: minmax(0, 1fr); }
.dbo-row.is-modified::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 3px;
    background: var(--dbo-accent);
}
.dbo-row.is-disabled { opacity: 0.45; pointer-events: none; }
.dbo-label {
    color: var(--dbo-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
    -webkit-user-select: none;
}
.dbo-row.is-modified .dbo-label { color: var(--dbo-text); }
.dbo-label.is-scrub { cursor: ew-resize; touch-action: none; }
.dbo-ctrl { display: flex; align-items: center; gap: 6px; min-width: 0; }

.dbo-input, .dbo-select {
    appearance: none;
    -webkit-appearance: none;
    height: calc(var(--dbo-row-h) - 6px);
    min-width: 0;
    width: 100%;
    margin: 0;
    padding: 0 8px;
    background: var(--dbo-bg-raised);
    border: 1px solid var(--dbo-border);
    border-radius: 7px;
    color: var(--dbo-text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    outline: none;
}
.dbo-input:focus, .dbo-select:focus { border-color: var(--dbo-accent); background: var(--dbo-bg-hover); }
.dbo-input.is-num { width: 64px; flex: none; text-align: right; padding: 0 6px; }
.dbo-input[readonly] { color: var(--dbo-muted); }
.dbo-select {
    cursor: pointer;
    padding-right: 26px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238e96a8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 9px center;
}
.dbo-select option { background: #1b1e26; color: var(--dbo-text); }

/* slider */
.dbo-range {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: calc(var(--dbo-row-h) - 4px);
    margin: 0;
    background: transparent;
    cursor: pointer;
    touch-action: pan-y;
    --fill: 0%;
}
.dbo-range:focus { outline: none; }
.dbo-range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(to right, var(--dbo-accent) var(--fill), rgba(255, 255, 255, 0.12) var(--fill));
}
.dbo-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border-radius: 50%;
    background: #fff;
    border: 0;
    box-shadow: 0 0 0 3px var(--dbo-accent-soft), 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.1s ease;
}
.dbo-range:active::-webkit-slider-thumb { transform: scale(1.15); }
.dbo-range::-moz-range-track { height: 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.12); }
.dbo-range::-moz-range-progress { height: 4px; border-radius: 4px; background: var(--dbo-accent); }
.dbo-range::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 0;
    box-shadow: 0 0 0 3px var(--dbo-accent-soft), 0 1px 3px rgba(0, 0, 0, 0.4);
}
@media (pointer: coarse) {
    .dbo-range::-webkit-slider-thumb { width: 22px; height: 22px; margin-top: -9px; }
    .dbo-range::-moz-range-thumb { width: 22px; height: 22px; }
}

/* toggle */
.dbo-switch {
    -webkit-appearance: none;
    appearance: none;
    position: relative;
    width: 34px;
    height: 20px;
    margin: 0;
    flex: none;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
    cursor: pointer;
    transition: background 0.15s ease;
    outline: none;
}
.dbo-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    transition: transform 0.15s ease;
}
.dbo-switch:checked { background: var(--dbo-accent); }
.dbo-switch:checked::after { transform: translateX(14px); }
.dbo-switch:focus-visible { box-shadow: 0 0 0 3px var(--dbo-accent-soft); }
.dbo-row.is-toggle { cursor: pointer; }
@media (pointer: coarse) {
    .dbo-switch { width: 44px; height: 26px; }
    .dbo-switch::after { width: 22px; height: 22px; }
    .dbo-switch:checked::after { transform: translateX(18px); }
}

/* color */
.dbo-swatch {
    -webkit-appearance: none;
    appearance: none;
    width: 34px;
    height: calc(var(--dbo-row-h) - 6px);
    flex: none;
    padding: 0;
    margin: 0;
    border: 1px solid var(--dbo-border);
    border-radius: 7px;
    background: none;
    cursor: pointer;
}
.dbo-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.dbo-swatch::-webkit-color-swatch { border: 0; border-radius: 6px; }
.dbo-swatch::-moz-color-swatch { border: 0; border-radius: 6px; }
.dbo-input.is-hex { text-transform: lowercase; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }

/* segmented (small enums) */
.dbo-seg {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: 2px;
    padding: 2px;
    background: var(--dbo-bg-raised);
    border: 1px solid var(--dbo-border);
    border-radius: 8px;
}
.dbo-seg button {
    appearance: none;
    border: 0;
    flex: 1 1 0;
    min-width: 0;
    height: calc(var(--dbo-row-h) - 10px);
    padding: 0 6px;
    border-radius: 6px;
    background: transparent;
    color: var(--dbo-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
}
.dbo-seg button:hover { color: var(--dbo-text); }
.dbo-seg button.is-active { background: var(--dbo-accent); color: var(--dbo-on-accent); }

/* buttons */
.dbo-btns { display: flex; gap: 6px; }
.dbo-btn {
    appearance: none;
    flex: 1 1 0;
    min-width: 0;
    height: calc(var(--dbo-row-h) - 4px);
    padding: 0 12px;
    border: 1px solid var(--dbo-border);
    border-radius: 8px;
    background: var(--dbo-bg-hover);
    color: var(--dbo-text);
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition: transform 0.08s ease, background 0.15s ease;
}
.dbo-btn:hover { background: rgba(255, 255, 255, 0.14); }
.dbo-btn:active { transform: scale(0.97); }
.dbo-btn.is-accent { background: var(--dbo-accent); border-color: transparent; color: var(--dbo-on-accent); }
.dbo-btn.is-danger { background: rgba(255, 107, 107, 0.16); border-color: rgba(255, 107, 107, 0.35); color: #ffb3b3; }

/* vector */
.dbo-vec { display: flex; gap: 4px; flex: 1; min-width: 0; }
.dbo-vec-field {
    display: flex;
    align-items: stretch;
    flex: 1 1 0;
    min-width: 0;
    height: calc(var(--dbo-row-h) - 6px);
    background: var(--dbo-bg-raised);
    border: 1px solid var(--dbo-border);
    border-radius: 7px;
    overflow: hidden;
}
.dbo-vec-field:focus-within { border-color: var(--dbo-accent); }
.dbo-axis {
    width: 18px;
    flex: none;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
}
.dbo-axis[data-axis="0"] { color: #ff7b8a; background: rgba(255, 123, 138, 0.13); }
.dbo-axis[data-axis="1"] { color: #62d895; background: rgba(98, 216, 149, 0.13); }
.dbo-axis[data-axis="2"] { color: #6ea8ff; background: rgba(110, 168, 255, 0.15); }
.dbo-axis[data-axis="3"] { color: #c7a1ff; background: rgba(199, 161, 255, 0.14); }
.dbo-vec-field input {
    flex: 1;
    min-width: 0;
    width: 100%;
    border: 0;
    margin: 0;
    padding: 0 6px;
    background: transparent;
    color: var(--dbo-text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
    outline: none;
}

/* monitor */
.dbo-monitor {
    flex: 1;
    min-width: 0;
    color: var(--dbo-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
}

/* array rows */
.dbo-array-item { display: flex; align-items: center; gap: 4px; }
.dbo-array-item > .dbo-row { flex: 1; min-width: 0; }
.dbo-array-remove {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--dbo-muted);
    width: 24px;
    height: 24px;
    margin-right: 6px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: none;
}
.dbo-array-remove:hover { color: var(--dbo-danger); background: rgba(255, 107, 107, 0.12); }

/* toast */
.dbo-toast {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    transform: translate(-50%, 12px);
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--dbo-bg);
    border: 1px solid var(--dbo-border);
    box-shadow: var(--dbo-shadow);
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.18s ease, transform 0.18s ease;
    pointer-events: none;
    white-space: nowrap;
}
.dbo-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
.dbo-toast.is-error { color: #ffb3b3; border-color: rgba(255, 107, 107, 0.4); }

/* ---------- phones: panels dock as a bottom sheet, no free dragging ---------- */
@media (max-width: 640px) {
    .dbo-stack {
        top: auto;
        left: calc(8px + env(safe-area-inset-left, 0px));
        right: calc(8px + env(safe-area-inset-right, 0px));
        bottom: calc(8px + env(safe-area-inset-bottom, 0px));
        width: auto;
        max-height: 58%;
    }
    .dbo-panel.is-floating {
        position: relative;
        left: auto !important;
        top: auto !important;
        width: auto;
        max-height: none !important;
    }
    .dbo-header { cursor: default; }
    .dbo-toast { bottom: auto; top: calc(58px + env(safe-area-inset-top, 0px)); }
}
`;
