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
        this.gui.domElement.style.position = 'fixed';
        this.gui.domElement.style.left = '0';
        this.gui.domElement.style.top = '0';
        this.gui.domElement.style.zIndex = '1000';
        this.initialized = true;
    }

    /** Adds a button with label and callback, optionally inside a folder */
    public addButton(name: string, callback: () => void, folderName?: string): void {
        if (!this.isDev || !this.gui) return;

        const obj = { [name]: callback };

        const target = folderName ? this.getOrCreateFolder(folderName) : this.gui;
        target.add(obj, name);
    }

    /** Gets or creates a folder by name, collapsed by default */
    private getOrCreateFolder(name: string): dat.GUI {
        if (this.folders.has(name)) {
            return this.folders.get(name)!;
        }

        const folder = this.gui!.addFolder(name);
        folder.open()//close(); // collapsed by default
        this.folders.set(name, folder);
        return folder;
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
