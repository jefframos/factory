import { Game } from "@core/Game";

export default class ShortcutManager {
    private static shortcuts: { [key: string]: () => void } = {};
    private static shortcutsDescriptions: Map<string, string> = new Map();
    private static _init: boolean = false;

    // Register a shortcut with a callback
    static registerShortcut(keys: string[], callback: () => void, desc: string = ''): void {
        const shortcutKey = keys.map(key => key.toLowerCase()).sort().join('+');
        this.shortcuts[shortcutKey] = callback;

        if (!ShortcutManager._init) {
            ShortcutManager.init();
        }

        this.shortcutsDescriptions.set(shortcutKey, desc)
        console.debug(this.shortcutsDescriptions)


    }
    static registerDevShortcut(keys: string[], callback: () => void, desc: string): void {
        if (!Game?.debugParams?.dev) return;
        const shortcutKey = keys.map(key => key.toLowerCase()).sort().join('+');
        this.shortcuts[shortcutKey] = callback;

        this.shortcutsDescriptions.set(shortcutKey, desc)

        if (!ShortcutManager._init) {
            ShortcutManager.init();
        }

        console.debug(this.shortcutsDescriptions)
    }

    // Remove a specific shortcut
    static removeShortcut(keys: string[]): void {
        const shortcutKey = keys.map(key => key.toLowerCase()).sort().join('+');
        if (this.shortcuts[shortcutKey]) {
            delete this.shortcuts[shortcutKey];
        }
    }

    // Remove all shortcuts
    static removeAllShortcuts(): void {
        this.shortcuts = {};
    }

    // Initialize the listener for keyboard events
    static init(): void {
        document.addEventListener('keydown', (event: KeyboardEvent) => {
            this.handleKeyDown(event);
        });

        ShortcutManager._init = true;
    }

    // Handle keydown events
    private static handleKeyDown(event: KeyboardEvent): void {
        const pressedKeys = [];

        if (event.ctrlKey) pressedKeys.push('ctrl');
        if (event.shiftKey) pressedKeys.push('shift');
        if (event.altKey) pressedKeys.push('alt');
        if (event.metaKey) pressedKeys.push('meta'); // For Mac ⌘

        // Push the key pressed (ignoring modifier keys)
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
            pressedKeys.push(event.key.toLowerCase());
        }

        const shortcutKey = pressedKeys.sort().join('+');

        // Check if the shortcut exists and execute the callback if it does
        if (this.shortcuts[shortcutKey]) {
            event.preventDefault(); // Prevent the default behavior (e.g., override CTRL+S)
            this.shortcuts[shortcutKey]();
        }
    }
}
