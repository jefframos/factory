export abstract class SectionRenderer {
    constructor(protected parent: HTMLElement, protected onUpdate: () => void) { }

    public static collapsedStates: Map<string, boolean> = new Map();

    abstract render(obj: any): void;

    protected createContainer(title: string, color: string = "#3498db") {
        const root = document.createElement("div");
        root.style.cssText = "margin-top: 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.02);";

        // Determine initial state (Default to expanded/false if not found)
        const isCollapsed = SectionRenderer.collapsedStates.get(title) || false;

        const header = document.createElement("div");
        header.style.cssText = `
            padding: 8px 12px; 
            background: rgba(0,0,0,0.2); 
            cursor: pointer; 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            user-select: none;
        `;

        const titleSpan = document.createElement("span");
        titleSpan.style.cssText = `font-size: 11px; color: ${color}; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;`;
        titleSpan.innerText = title;

        const icon = document.createElement("span");
        icon.innerText = isCollapsed ? "▶" : "▼";
        icon.style.cssText = "font-size: 9px; color: rgba(255,255,255,0.3);";

        header.appendChild(titleSpan);
        header.appendChild(icon);

        const content = document.createElement("div");
        content.style.cssText = "padding: 10px; display: flex; flex-direction: column; gap: 6px;";

        // Apply the saved state immediately
        content.style.display = isCollapsed ? "none" : "flex";

        header.onclick = () => {
            const nowHidden = content.style.display !== "none";
            content.style.display = nowHidden ? "none" : "flex";
            icon.innerText = nowHidden ? "▶" : "▼";

            // Save the state globally so it persists when switching objects
            SectionRenderer.collapsedStates.set(title, nowHidden);
        };

        root.appendChild(header);
        root.appendChild(content);
        this.parent.appendChild(root);

        return content;
    }

    protected createRow(parent: HTMLElement, label: string) {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 4px;";
        row.innerHTML = `<span style="font-size:10px; color:#aaa;">${label}</span>`;
        parent.appendChild(row);
        return row;
    }

    protected createNumericInput(parent: HTMLElement, label: string, target: any, prop: string) {
        const row = this.createRow(parent, label);
        const input = document.createElement("input");
        input.type = "number";
        input.style.cssText = "width: 80px; background: #111; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px; font-size: 11px;";
        input.value = (target[prop] ?? 0).toString();
        input.oninput = () => { target[prop] = parseFloat(input.value) || 0; this.onUpdate(); };
        row.appendChild(input);
    }
    protected createSlider(parent: HTMLElement, label: string, target: any, prop: string, min: number = 0, max: number = 1, step: number = 0.01) {
        const row = this.createRow(parent, label);

        // Container for slider + value display
        const sliderCont = document.createElement("div");
        sliderCont.style.cssText = "display: flex; align-items: center; gap: 5px;";

        const input = document.createElement("input");
        input.type = "range";
        input.min = min.toString();
        input.max = max.toString();
        input.step = step.toString();
        input.value = (target[prop] ?? 1).toString();
        input.style.cssText = "width: 60px; cursor: pointer;";

        const valDisplay = document.createElement("span");
        valDisplay.style.cssText = "font-size: 9px; color: #3498db; width: 20px; text-align: right;";
        valDisplay.innerText = parseFloat(input.value).toFixed(2);

        input.oninput = () => {
            const val = parseFloat(input.value);
            target[prop] = val;
            valDisplay.innerText = val.toFixed(2);
            //this.onUpdate();
        };

        input.onchange = () => {
            const val = parseFloat(input.value);
            target[prop] = val;
            valDisplay.innerText = val.toFixed(2);
            this.onUpdate();
        };

        sliderCont.appendChild(input);
        sliderCont.appendChild(valDisplay);
        row.appendChild(sliderCont);
    }
    protected createTextInput(parent: HTMLElement, label: string, target: any, prop: string) {
        const row = this.createRow(parent, label);
        const input = document.createElement("input");
        input.style.cssText = "width: 80px; background: #111; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px; font-size: 11px;";
        input.value = target[prop] || "";
        input.oninput = () => { target[prop] = input.value; this.onUpdate(); };
        row.appendChild(input);
    }

    protected createCheckbox(parent: HTMLElement, label: string, target: any, prop: string) {
        const row = this.createRow(parent, label);
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !!target[prop];
        check.onchange = () => { target[prop] = check.checked; this.onUpdate(); };
        row.appendChild(check);
    }

    protected createDropdown(parent: HTMLElement, label: string, target: any, prop: string, options: string[]) {
        const row = this.createRow(parent, label);
        const select = document.createElement("select");
        select.style.cssText = "width: 80px; background: #111; border: 1px solid #444; color: #fff; padding: 2px; border-radius: 4px; font-size: 10px;";
        options.forEach(opt => {
            const o = document.createElement("option");
            o.value = opt; o.text = opt.toUpperCase();
            o.selected = target[prop] === opt;
            select.appendChild(o);
        });
        select.onchange = () => { target[prop] = select.value; this.onUpdate(); };
        row.appendChild(select);
    }

    protected createButton(text: string, color: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.innerText = text;
        btn.style.cssText = `background: ${color}; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; font-size: 10px; display: block; margin-top: 5px;`;
        btn.onclick = (e) => {
            e.preventDefault();
            onClick();
        };
        return btn;
    }
}