// AntSave.ts
//
// The player's progress: the furthest level they've reached (cleared levels are the ones before it). One small
// localStorage entry; if storage isn't available the game just starts at the first level each time. `selected` is the
// level the main screen shows and PLAY starts — the furthest, or an older one to replay (not saved).

const KEY = 'ant.save';

interface SaveData {
    level: number;
}

function load(): SaveData {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<SaveData> | null;
        return { level: Math.max(0, Math.floor(saved?.level ?? 0)) };
    } catch {
        return { level: 0 };
    }
}

const state = load();
let selected = state.level;

export const AntSave = {
    get selected(): number {
        return Math.min(selected, state.level);
    },

    set selected(value: number) {
        selected = Math.max(0, Math.min(value, state.level));
    },

    /** A level reached (won the one before): progress only goes up — replaying an old level doesn't lower it. */
    reach(value: number): void {
        if (value > state.level) AntSave.level = value;
        selected = value;
    },

    get level(): number {
        return state.level;
    },

    set level(value: number) {
        state.level = value;
        selected = value;
        try {
            window.localStorage.setItem(KEY, JSON.stringify(state));
        } catch {
            // No storage (private mode): progress lasts this session only.
        }
    },
};
