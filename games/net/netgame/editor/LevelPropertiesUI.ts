import { OBJECT_SCHEMA } from "./EditorSchema";

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
    INPUT_ROW: `display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 4px;`,
    INPUT: `width: 80px; background: #111; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px; font-size: 11px;`,
    BTN_DANGER: `background: #e74c3c; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 15px; width: 100%;`
};

export class LevelPropertiesUI {
    public root: HTMLDivElement;
    private staticContainer: HTMLDivElement;
    private dynamicContainer: HTMLDivElement;

    public onAddRandomBox?: () => void;
    public onDeleteSelected?: () => void;
    public onPropertyChanged?: (prop: string, value: any) => void;

    constructor(parent: HTMLElement) {
        this.root = document.createElement("div");
        this.root.style.cssText = PROP_STYLES.PANEL;

        // Container for tools that NEVER change (Add Box, Level Stats)
        this.staticContainer = document.createElement("div");
        // Container for properties that change based on selection
        this.dynamicContainer = document.createElement("div");

        this.root.appendChild(this.staticContainer);
        this.root.appendChild(this.dynamicContainer);

        this.initStaticTools();
        parent.appendChild(this.root);
    }

    /** * Builds the persistent parts of the UI 
     */
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

    /**
     * Rebuilds the selection-specific UI
     */
    public showObjectProperties(obj: any): void {
        this.root.style.display = "flex";
        this.dynamicContainer.innerHTML = ""; // Wipe only the dynamic part

        const divider = document.createElement("div");
        divider.style.cssText = "margin-top: 15px; border-top: 2px solid #3498db; padding-top: 15px;";
        this.dynamicContainer.appendChild(divider);

        const title = document.createElement("h4");
        title.style.cssText = PROP_STYLES.TITLE;
        title.innerText = `Edit: ${obj.type}`;
        this.dynamicContainer.appendChild(title);

        // 1. Map the schema to the inputs
        const fields = OBJECT_SCHEMA[obj.type] || ['x', 'y'];
        fields.forEach(field => {
            this.createInputForField(obj, field);
        });

        // 2. Render Modifier Section
        this.renderModifierSection(obj);

        // 3. Delete Button (Now only appears when an object is selected)
        const delBtn = document.createElement("button");
        delBtn.innerText = "DELETE OBJECT";
        delBtn.style.cssText = PROP_STYLES.BTN_DANGER;
        delBtn.onclick = () => this.onDeleteSelected?.();
        this.dynamicContainer.appendChild(delBtn);
    }

    private createInputForField(target: any, prop: string) {
        if (typeof target[prop] === 'boolean') {
            this.createCheckbox(this.dynamicContainer, prop.toUpperCase(), target, prop);
        } else if (prop === 'label') {
            this.createTextInput(this.dynamicContainer, "LABEL", target, prop);
        } else {
            this.createNumericInput(this.dynamicContainer, prop.toUpperCase(), target, prop);
        }
    }

    private renderModifierSection(obj: any) {
        const container = document.createElement("div");
        container.style.cssText = "margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;";

        if (!obj.modifier) {
            const addModBtn = document.createElement("button");
            addModBtn.innerText = "+ ADD MODIFIER";
            addModBtn.style.cssText = PROP_STYLES.BTN_ADD + "background: #27ae60; font-size: 10px; margin-top: 5px;";
            addModBtn.onclick = () => {
                obj.modifier = { trigger: 'start', mode: 'add', force: { x: 0, y: 0 } };
                this.showObjectProperties(obj);
            };
            container.appendChild(addModBtn);
        } else {
            const modTitle = document.createElement("div");
            modTitle.style.cssText = "font-size: 11px; color: #2ecc71; margin-bottom: 8px; font-weight: bold; letter-spacing: 1px;";
            modTitle.innerText = "MODIFIER SETTINGS";
            container.appendChild(modTitle);

            this.createDropdown(container, "TRIGGER", obj.modifier, 'trigger', ['start', 'active', 'end']);
            this.createDropdown(container, "MODE", obj.modifier, 'mode', ['add', 'set', 'multiply']);
            this.createNumericInput(container, "FORCE X", obj.modifier.force, 'x');
            this.createNumericInput(container, "FORCE Y", obj.modifier.force, 'y');
            this.createCheckbox(container, "RADIAL?", obj.modifier, 'useRadialDirection');

            const remBtn = document.createElement("button");
            remBtn.innerText = "REMOVE MODIFIER";
            remBtn.style.cssText = PROP_STYLES.BTN_DANGER + "background: rgba(231, 76, 60, 0.2); color: #e74c3c; margin-top: 10px; font-size: 10px; padding: 6px;";
            remBtn.onclick = () => {
                delete obj.modifier;
                this.showObjectProperties(obj);
            };
            container.appendChild(remBtn);
        }
        this.dynamicContainer.appendChild(container);
    }

    // --- TOOLKIT HELPERS ---

    private createNumericInput(parent: HTMLElement, label: string, target: any, prop: string): void {
        const row = document.createElement("div");
        row.style.cssText = PROP_STYLES.INPUT_ROW;
        row.innerHTML = `<span style="font-size:10px; color:#aaa;">${label}</span>`;

        const input = document.createElement("input");
        input.type = "number";
        input.style.cssText = PROP_STYLES.INPUT;
        input.value = (target[prop] ?? 0).toString();

        input.oninput = () => {
            target[prop] = parseFloat(input.value) || 0;
            this.onPropertyChanged?.(prop, target[prop]);
        };

        row.appendChild(input);
        parent.appendChild(row);
    }

    private createDropdown(parent: HTMLElement, label: string, target: any, prop: string, options: string[]): void {
        const row = document.createElement("div");
        row.style.cssText = PROP_STYLES.INPUT_ROW;
        row.innerHTML = `<span style="font-size:10px; color:#aaa;">${label}</span>`;

        const select = document.createElement("select");
        select.style.cssText = PROP_STYLES.INPUT;

        options.forEach(opt => {
            const o = document.createElement("option");
            o.value = opt;
            o.text = opt.toUpperCase();
            o.selected = target[prop] === opt;
            select.appendChild(o);
        });

        select.onchange = () => {
            target[prop] = select.value;
            this.onPropertyChanged?.(prop, target[prop]);
        };

        row.appendChild(select);
        parent.appendChild(row);
    }

    private createCheckbox(parent: HTMLElement, label: string, target: any, prop: string): void {
        const row = document.createElement("div");
        row.style.cssText = PROP_STYLES.INPUT_ROW;
        row.innerHTML = `<span style="font-size:10px; color:#aaa;">${label}</span>`;

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !!target[prop];
        check.onchange = () => {
            target[prop] = check.checked;
            this.onPropertyChanged?.(prop, target[prop]);
        };

        row.appendChild(check);
        parent.appendChild(row);
    }

    private createTextInput(parent: HTMLElement, label: string, target: any, prop: string): void {
        const row = document.createElement("div");
        row.style.cssText = PROP_STYLES.INPUT_ROW;
        row.innerHTML = `<span style="font-size:10px; color:#aaa;">${label}</span>`;

        const input = document.createElement("input");
        input.style.cssText = PROP_STYLES.INPUT;
        input.value = target[prop] || "";
        input.oninput = () => {
            target[prop] = input.value;
            this.onPropertyChanged?.(prop, target[prop]);
        };

        row.appendChild(input);
        parent.appendChild(row);
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