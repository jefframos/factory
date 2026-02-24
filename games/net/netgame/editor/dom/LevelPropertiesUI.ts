import { InteractionSection } from "./sections/InteractionSection";
import { MainSettingsSection } from "./sections/MainSettingsSection";
import { ModifierSection } from "./sections/ModifierSection";
import { PhysicsSection } from "./sections/PhysicsSection";
import { SectionRenderer } from "./sections/SectionRenderer";
import { View3DSection } from "./sections/View3DSection";

const PROP_STYLES = {
    PANEL: `
        position: absolute; 
        right: 15px; 
        bottom: 15px; 
        width: 280px; 
        background: rgba(25, 25, 25, 0.95); 
        border-radius: 12px; 
        padding: 18px; 
        pointer-events: auto;
        border: 1px solid rgba(255, 255, 255, 0.15); 
        backdrop-filter: blur(15px); 
        display: none; 
        flex-direction: column; 
        gap: 12px; 
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        max-height: 80vh;
        overflow-y: auto;
    `,
    SECTION: `border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 5px;`,
    TITLE: `margin: 0 0 10px 0; color: #3498db; font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;`,
    BTN_ADD: `background: #3498db; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: background 0.2s; width: 100%;`,
    INFO_TEXT: `font-size: 11px; color: rgba(255,255,255,0.5); font-style: italic; margin-top: 5px;`,
    BTN_DANGER: `background: #e74c3c; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 15px; width: 100%;`
};

export class LevelPropertiesUI {
    public root: HTMLDivElement;
    private staticContainer: HTMLDivElement;
    private dynamicContainer: HTMLDivElement;
    // Callbacks
    public onAddRandomBox?: () => void;
    public onDeleteSelected?: () => void;
    public onPropertyChanged?: (prop: string, value: any) => void;
    private currentObj: any = null;
    // Sub-renderers
    private sections: any[] = [];

    constructor(parent: HTMLElement) {
        // 1. Initialize root first to satisfy TypeScript assignment checks
        this.root = document.createElement("div");
        this.root.style.cssText = PROP_STYLES.PANEL;

        this.staticContainer = document.createElement("div");
        this.dynamicContainer = document.createElement("div");

        this.root.appendChild(this.staticContainer);
        this.root.appendChild(this.dynamicContainer);

        this.initStaticTools();
        parent.appendChild(this.root);

        // 2. Initialize Section Handlers
        const updateCb = () => {
            // Signal the manager that data changed
            this.onPropertyChanged?.("bulk", null);

            // Re-render the panel so "Add" buttons turn into "Input" fields
            if (this.currentObj) {
                this.showObjectProperties(this.currentObj);
            }
        };

        this.sections = [
            new MainSettingsSection(this.dynamicContainer, updateCb),
            new PhysicsSection(this.dynamicContainer, updateCb),
            new ModifierSection(this.dynamicContainer, updateCb),
            new View3DSection(this.dynamicContainer, updateCb),
            new InteractionSection(this.dynamicContainer, updateCb)
        ];
    }

    public static toggleAll(expand: boolean) {
        // Note: This only affects the map. You'd call this before refreshing the UI.
        // Or you can iterate over all title keys in your sections.
        const titles = ["Geometry & Label", "Physics Settings", "3D Appearance", "Interactions"];
        titles.forEach(t => SectionRenderer.collapsedStates.set(t, !expand));
    }

    private initStaticTools(): void {
        this.staticContainer.innerHTML = "";
        const header = document.createElement("div");
        header.style.cssText = PROP_STYLES.SECTION;
        header.innerHTML = `<h4 id="prop-level-name" style="${PROP_STYLES.TITLE}">Level Editor</h4>`;

        const addBtn = document.createElement("button");
        addBtn.style.cssText = PROP_STYLES.BTN_ADD;
        addBtn.innerText = "+ Add Random Static Box";
        addBtn.onclick = () => this.onAddRandomBox?.();

        const info = document.createElement("div");
        info.id = "level-info-stats";
        info.style.cssText = PROP_STYLES.INFO_TEXT;
        info.innerText = "Select an object to edit properties.";



        this.staticContainer.appendChild(header);
        this.staticContainer.appendChild(addBtn);
        this.staticContainer.appendChild(info);
    }

    public showObjectProperties(obj: any): void {
        // 3. Store the object reference here
        this.currentObj = obj;

        this.root.style.display = "flex";
        this.dynamicContainer.innerHTML = "";

        const title = document.createElement("h4");
        title.style.cssText = PROP_STYLES.TITLE;
        title.innerText = `Edit: ${obj.type}`;
        this.dynamicContainer.appendChild(title);

        // Run all section renderers
        this.sections.forEach(section => section.render(obj));

        this.renderDeleteButton();
    }

    private renderDeleteButton() {
        const btn = document.createElement("button");
        btn.innerText = "DELETE OBJECT";
        btn.style.cssText = PROP_STYLES.BTN_DANGER;
        btn.onclick = () => this.onDeleteSelected?.();
        this.dynamicContainer.appendChild(btn);
    }

    public updateStats(objectCount: number): void {
        const stats = this.staticContainer.querySelector("#level-info-stats") as HTMLDivElement;
        if (stats) stats.innerText = `Objects in Scene: ${objectCount}`;
    }

    public show(levelName: string, objectCount: number): void {
        this.root.style.display = "flex";
        const title = this.staticContainer.querySelector("#prop-level-name") as HTMLElement;
        if (title) title.innerText = levelName;
        this.updateStats(objectCount);
    }

    public hide(): void {
        this.root.style.display = "none";
        this.dynamicContainer.innerHTML = "";
    }
}