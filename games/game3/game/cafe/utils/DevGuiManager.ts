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
    private initialized = false;
    private isDev = false;

    private constructor() { }

    public initialize(isDev: boolean): void {
        if (!isDev || this.initialized) return;

        this.isDev = isDev;

        this.gui = new dat.GUI({ width: 300 });
        this.gui.domElement.style.position = 'fixed';
        this.gui.domElement.style.left = '0';
        this.gui.domElement.style.top = '0';
        this.gui.domElement.style.zIndex = '1000';
        this.initialized = true;
    }

    /** Adds a button with label and callback */
    public addButton(name: string, callback: () => void): void {
        if (!this.isDev || !this.gui) return;

        const obj = { [name]: callback };
        this.gui.add(obj, name);
    }

    /** Clear all GUI entries (optional) */
    public clear(): void {
        if (!this.isDev || !this.gui) return;

        const guiDom = this.gui.domElement;
        guiDom.parentElement?.removeChild(guiDom);
        this.gui.destroy();
        this.gui = null;
        this.initialized = false;
    }
}
