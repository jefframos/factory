import { WorldData } from "../HexTypes";

export class WorldEditorDomUI {
    public readonly root: HTMLDivElement;

    // Store references to generated inputs: key -> input element
    private inputs: Map<string, HTMLInputElement> = new Map();

    // Blacklist of keys we never want to show in the UI
    private readonly IGNORE_KEYS = ["id", "levelFile", "levels"];

    public onChanged?: (data: Partial<WorldData>) => void;

    public onDeleteWorld?: () => void;
    private deleteBtn?: HTMLButtonElement;

    constructor(container: HTMLElement) {
        this.root = document.createElement("div");
        this.root.style.cssText = `
            position: absolute; right: 12px; top: 12px; width: 260px;
            background: rgba(20, 20, 20, 0.9); border-radius: 12px; padding: 14px;
            pointer-events: auto; border: 1px solid rgba(255,255,255,0.1);
            backdrop-filter: blur(10px); display: none; flex-direction: column; gap: 10px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        `;

        this.root.innerHTML = `<div style="font-weight:bold; color:#4CAF50; margin-bottom:4px;">World Settings</div>`;
        container.appendChild(this.root);

        this.deleteBtn = document.createElement("button");
        this.deleteBtn.innerText = "Delete World";
        this.deleteBtn.style.cssText = `
        margin-top: 10px; background: #c0392b; color: white; border: none; 
        padding: 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
        opacity: 0.8; transition: opacity 0.2s;
    `;
        this.deleteBtn.onmouseenter = () => this.deleteBtn!.style.opacity = "1";
        this.deleteBtn.onmouseleave = () => this.deleteBtn!.style.opacity = "0.8";

        this.deleteBtn.onclick = () => {
            if (confirm("Are you sure you want to delete this world and ALL its levels?")) {
                this.onDeleteWorld?.();
            }
        };
    }

    /**
     * The "Reflective" part: Reads the object and builds the UI dynamically
     */
    public setData(world: WorldData | null) {
        if (!world) {
            this.root.style.display = "none";
            return;
        }

        this.root.style.display = "flex";

        while (this.root.children.length > 1) {
            this.root.removeChild(this.root.lastChild!);
        }
        this.inputs.clear();
        // Get all keys from the object
        const keys = Object.keys(world);

        keys.forEach(key => {
            if (this.IGNORE_KEYS.includes(key)) return;

            const value = (world as any)[key];
            const type = typeof value;

            // Only create fields for primitives
            if (type === "string" || type === "number" || type === "boolean") {
                this.ensureField(key, value, type);
            }
        });

        this.root.appendChild(this.deleteBtn!);
    }

    private ensureField(key: string, value: any, type: string) {
        if (this.inputs.has(key)) {
            const input = this.inputs.get(key)!;
            if (type === "boolean") input.checked = value;
            else input.value = value;
            return;
        }

        const wrapper = document.createElement("div");
        const label = document.createElement("div");
        label.innerText = key.charAt(0).toUpperCase() + key.slice(1);
        label.style.cssText = "font-size: 11px; opacity: 0.6; margin-bottom: 3px;";

        const input = document.createElement("input");

        if (type === "boolean") {
            input.type = "checkbox";
            input.checked = value;
            // Align checkbox nicely
            wrapper.style.cssText = "display: flex; justify-content: space-between; align-items: center;";
        } else {
            input.type = type === "number" ? "number" : "text";
            input.value = value;
            input.style.cssText = `
                width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                color: white; padding: 6px; border-radius: 4px; font-size: 13px; outline: none;
            `;
        }

        input.onchange = () => this.triggerChange();
        if (type !== "boolean") input.oninput = () => this.triggerChange();

        wrapper.appendChild(label);
        wrapper.appendChild(input);
        this.root.appendChild(wrapper);

        this.inputs.set(key, input);
    }

    private triggerChange() {
        const result: any = {};
        this.inputs.forEach((input, key) => {
            if (input.type === "checkbox") {
                result[key] = input.checked;
            } else if (input.type === "number") {
                result[key] = parseFloat(input.value);
            } else {
                result[key] = input.value;
            }
        });
        this.onChanged?.(result);
    }
}