import * as dat from 'dat.gui';

export class DevGuiManager {
    private static _instance: DevGuiManager;
    public static get instance(): DevGuiManager {
        if (!DevGuiManager._instance) {
            DevGuiManager._instance = new DevGuiManager();
        }
        return DevGuiManager._instance;
    }

    private gui: dat.GUI | null = null;
    private folders: Map<string, dat.GUI> = new Map();
    private initialized = false;
    private isDev = false;

    private constructor() { }

    public initialize(isDev: boolean): void {
        if (!isDev || this.initialized) return;

        this.isDev = isDev;
        this.gui = new dat.GUI({ width: 200 });

        // 1. Target the main GUI element
        const dom = this.gui.domElement;

        // 2. dat.GUI often wraps the GUI in a container with class "dg ac"
        // We need to make sure that wrapper doesn't block us
        const wrapper = dom.parentElement;
        if (wrapper && wrapper.classList.contains('dg')) {
            Object.assign(wrapper.style, {
                zIndex: '10001',      // Higher than Pixi (8)
                position: 'relative', // Ensure z-index is respected
                pointerEvents: 'auto' // Explicitly allow clicks
            });
        }

        // 3. Force the internal GUI element to stay on top and be clickable
        Object.assign(dom.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            zIndex: '10000',
            pointerEvents: 'auto'
        });

        this.initialized = true;
    }

    /** Adds a button with label and callback, optionally inside a folder */
    public addButton(name: string, callback: () => void, folderName?: string): void {
        if (!this.isDev || !this.gui) return;

        const obj = { [name]: callback };

        const target = folderName ? this.getOrCreateFolder(folderName) : this.gui;
        target.add(obj, name);
    }



    /**
     * Retrieves an existing folder or creates one if it doesn't exist.
     * @param name - Folder name
     * @returns dat.GUI instance for the folder
     */
    private getOrCreateFolder(name: string): dat.GUI {

        if (!this.folders.has(name)) {
            const folder = this.gui.addFolder(name);
            folder.open(); // Optional: open folder by default
            this.folders.set(name, folder);
        }
        return this.folders.get(name)!;
    }

    /**
 * Adds GUI controls for multiple properties on a given object.
 * @param owner - The object owning the property (used for display name and binding).
 * @param target - The actual object whose properties will be edited (e.g., position).
 * @param keys - Array of property keys (e.g., ['x', 'y', 'z']).
 * @param range - [min, max] range for sliders.
 * @param folderName - (Optional) Folder to group the controls.
 */
    public addProperties(
        owner: any,
        keys: string[],
        range: [number, number],
        name?: string,
        folderName?: string
    ): void {
        if (!this.isDev || !this.gui) return;
        const folder = folderName
            ? this.getOrCreateFolder(folderName)
            : this.gui;

        keys.forEach((key) => {
            if (key in owner) {
                folder.add(owner, key, range[0], range[1], 0.01)
                    .name(`${name ? name : owner.constructor.name}.${key}`)
                    .onChange((v: number) => {
                        owner[key] = v;
                    });
            } else {
                console.warn(`GuiHelper: Key "${key}" not found in owner`, owner);
            }
        });
    }

    /**
 * Adds GUI controls for a dynamic object and calls a callback when any value changes.
 * @param defaultValue - The initial object containing keys and default numeric values.
 * @param callback - Function to call when any property changes, receives the full object.
 * @param keys - The keys to expose in the GUI.
 * @param range - [min, max] range for sliders.
 * @param folderName - (Optional) folder name to group the controls.
 * @param name - (Optional) label prefix for each control.
 */
    public addObjectTrigger(
        defaultValue: Record<string, number>,
        callback: (updated: Record<string, number>) => void,
        keys: string[],
        range: [number, number],
        name?: string,
        folderName?: string,
    ): void {
        const folder = folderName ? this.getOrCreateFolder(folderName) : this.gui;

        keys.forEach((key) => {
            if (key in defaultValue) {
                folder.add(defaultValue, key, range[0], range[1], 0.01)
                    .name(`${name || 'Value'}.${key}`)
                    .onChange(() => callback({ ...defaultValue }));
            } else {
                console.warn(`GuiHelper: Key "${key}" not found in defaultValue`, defaultValue);
            }
        });
    }

    /** Clear all GUI entries (optional) */
    public clear(): void {
        if (!this.isDev || !this.gui) return;

        const guiDom = this.gui.domElement;
        guiDom.parentElement?.removeChild(guiDom);
        this.gui.destroy();
        this.gui = null;
        this.folders.clear();
        this.initialized = false;
    }
}
