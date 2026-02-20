const PROP_STYLES = {
    PANEL: `
        position: absolute; 
        right: 15px; 
        bottom: 15px; 
        width: 280px; 
        background: rgba(25, 25, 25, 0.95); 
        border-radius: 12px; 
        padding: 18px; 
        pointer-events: auto; /* CRITICAL */
        border: 1px solid rgba(255, 255, 255, 0.15); 
        backdrop-filter: blur(15px); 
        display: none; /* Starts hidden */
        flex-direction: column; 
        gap: 12px; 
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `,
    SECTION: `border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 5px;`,
    TITLE: `margin: 0 0 10px 0; color: #3498db; font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;`,
    BTN_ADD: `background: #3498db; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: background 0.2s;`,
    INFO_TEXT: `font-size: 11px; color: rgba(255,255,255,0.5); font-style: italic;`,
    INPUT_ROW: `display: flex; justify-content: space-between; align-items: center; gap: 10px;`,
    INPUT: `width: 80px; background: #111; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px;`,
    BTN_DANGER: `background: #e74c3c; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 10px;`
};

export class LevelPropertiesUI {
    public root: HTMLDivElement;
    public onAddRandomBox?: () => void;

    private inputs: Record<string, HTMLInputElement> = {};

    public onDeleteSelected?: () => void;
    public onPropertyChanged?: (prop: string, value: number) => void;

    constructor(parent: HTMLElement) {
        this.root = document.createElement("div");
        this.root.style.cssText = PROP_STYLES.PANEL;

        this.init();
        parent.appendChild(this.root);
    }

    private init(): void {
        // Header
        const header = document.createElement("div");
        header.style.cssText = PROP_STYLES.SECTION;
        header.innerHTML = `<h4 style="${PROP_STYLES.TITLE}">Tools & Objects</h4>`;

        // Add Button
        const addBtn = document.createElement("button");
        addBtn.style.cssText = PROP_STYLES.BTN_ADD;
        addBtn.innerText = "+ Add Random Static Box";
        addBtn.onmouseenter = () => addBtn.style.background = "#2980b9";
        addBtn.onmouseleave = () => addBtn.style.background = "#3498db";
        addBtn.onclick = () => this.onAddRandomBox?.();

        // Object Count / Info
        const info = document.createElement("div");
        info.id = "level-info-stats";
        info.style.cssText = PROP_STYLES.INFO_TEXT;
        info.innerText = "Mandatory nodes (Start/Finish) auto-patched.";

        this.root.appendChild(header);
        this.root.appendChild(addBtn);
        this.root.appendChild(info);

        this.createNumericInput("X Position", "x");
        this.createNumericInput("Y Position", "y");
        this.createNumericInput("Width", "width");
        this.createNumericInput("Height", "height");

        const delBtn = document.createElement("button");
        delBtn.innerText = "DELETE OBJECT";
        delBtn.style.cssText = PROP_STYLES.BTN_DANGER; // Using your danger style
        delBtn.onclick = () => this.onDeleteSelected?.();
        this.root.appendChild(delBtn);
    }
    public updateSelectionFields(data: any) {
        if (this.inputs.x) this.inputs.x.value = Math.round(data.x).toString();
        if (this.inputs.y) this.inputs.y.value = Math.round(data.y).toString();
        // ... repeat for w/h
    }
    public updateStats(objectCount: number): void {
        const stats = this.root.querySelector("#level-info-stats") as HTMLDivElement;
        if (stats) {
            // Split the text to preserve the name if you want, or just refresh
            stats.innerText = `Objects in Scene: ${objectCount}`;
        }
    }
    private createNumericInput(label: string, propId: string): void {
        const row = document.createElement("div");
        row.style.cssText = PROP_STYLES.INPUT_ROW;
        row.innerHTML = `<span style="font-size:11px; color:#aaa;">${label}</span>`;

        const input = document.createElement("input");
        input.type = "number";
        input.style.cssText = PROP_STYLES.INPUT;

        input.oninput = () => {
            this.onPropertyChanged?.(propId, parseFloat(input.value));
        };

        this.inputs[propId] = input;
        row.appendChild(input);
        this.root.appendChild(row);
    }

    public showObjectProperties(data: any): void {
        this.root.style.display = "flex";
        if (this.inputs.x) this.inputs.x.value = data.x.toString();
        if (this.inputs.y) this.inputs.y.value = data.y.toString();
        if (this.inputs.width) this.inputs.width.value = (data.width || 0).toString();
        if (this.inputs.height) this.inputs.height.value = (data.height || 0).toString();
    }
    public show(levelName: string, objectCount: number): void {
        this.root.style.display = "flex";
        this.updateStats(objectCount);
        const title = this.root.querySelector("h4") as HTMLElement;
        if (title) title.innerText = levelName;
    }

    public hide(): void {
        this.root.style.display = "none";
    }
}