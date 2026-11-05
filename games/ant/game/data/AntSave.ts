// AntSave.ts
//
// The player's progress: the level they're on (cleared levels are the ones before it). One small localStorage entry;
// if storage isn't available the game just starts at the first level each time.

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

export const AntSave = {
    get level(): number {
        return state.level;
    },

    set level(value: number) {
        state.level = value;
        try {
            window.localStorage.setItem(KEY, JSON.stringify(state));
        } catch {
            // No storage (private mode): progress lasts this session only.
        }
    },
};
