import { ColorPaletteService } from "../../services/ColorPaletteService";


export class PaletteEditorUI {
    private container: HTMLDivElement;
    private listContainer: HTMLDivElement;
    private isExpanded: boolean = false;
    private toggleBtn!: HTMLButtonElement;

    constructor(private parent: HTMLElement, private onUpdate: () => void) {
        this.container = document.createElement("div");
        // Style it as a toolbar item
        this.container.style.cssText = `
            position: relative;
            display: flex;
            align-items: center;
            height: 100%;
            padding: 0 10px;
            border-left: 1px solid rgba(255,255,255,0.1);
        `;

        this.renderToggle();

        this.listContainer = document.createElement("div");
        this.listContainer.style.cssText = `
            position: absolute;
            top: 100%;
            right: 0;
            width: 220px;
            background: rgba(20, 20, 20, 0.98);
            border: 1px solid #444;
            border-radius: 0 0 8px 8px;
            padding: 12px;
            display: none;
            flex-direction: column;
            gap: 8px;
            z-index: 1000;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            backdrop-filter: blur(10px);
        `;

        this.container.appendChild(this.listContainer);
        this.parent.appendChild(this.container);

        this.refresh();
    }

    private renderToggle() {
        this.toggleBtn = document.createElement("button");
        this.toggleBtn.innerHTML = `<span style="color:#3498db; margin-right:5px;">🎨</span> Palette`;
        this.toggleBtn.style.cssText = `
            background: none;
            border: none;
            color: #eee;
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            text-transform: uppercase;
        `;

        this.toggleBtn.onclick = () => this.toggle();
        this.container.appendChild(this.toggleBtn);
    }

    private toggle() {
        this.isExpanded = !this.isExpanded;
        this.listContainer.style.display = this.isExpanded ? "flex" : "none";
        this.toggleBtn.style.color = this.isExpanded ? "#3498db" : "#eee";
    }

    public refresh() {
        this.listContainer.innerHTML = "";
        const activeId = ColorPaletteService.getActiveId();
        const palettes = ColorPaletteService.getAllPalettes();

        // 1. Palette Set Selector
        const selectorRow = document.createElement("div");
        selectorRow.style.cssText = "display: flex; gap: 5px; margin-bottom: 10px;";

        const select = document.createElement("select");
        select.style.cssText = "flex: 1; background: #111; color: #fff; font-size: 10px; border: 1px solid #444;";
        palettes.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.text = p.id;
            opt.selected = p.id === activeId;
            select.appendChild(opt);
        });
        select.onchange = () => {
            ColorPaletteService.setActivePalette(select.value);
            this.refresh();
            this.onUpdate();
        };

        const dupBtn = document.createElement("button");
        dupBtn.innerText = "⎘"; // Duplicate Icon
        dupBtn.onclick = () => {
            const name = prompt("Name for new Palette Set:");
            if (name) {
                ColorPaletteService.duplicatePalette(name);
                this.refresh();
                this.onUpdate();
            }
        };

        selectorRow.appendChild(select);
        selectorRow.appendChild(dupBtn);
        this.listContainer.appendChild(selectorRow);

        // 2. The 8 Squares Grid
        const grid = document.createElement("div");
        grid.style.cssText = "display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px;";

        const colors = ColorPaletteService.getActivePalette();
        colors.forEach((hex, index) => {
            const slotCont = document.createElement("div");
            slotCont.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 2px;";

            const picker = document.createElement("input");
            picker.type = "color";
            picker.value = `#${hex.toString(16).padStart(6, '0')}`;
            picker.style.cssText = "width: 35px; height: 35px; border: 2px solid #444; border-radius: 4px; cursor: pointer; padding: 0; background: none;";

            picker.oninput = () => {
                const newHex = parseInt(picker.value.replace("#", ""), 16);
                ColorPaletteService.updateColor(index, newHex);
                this.onUpdate();
            };

            const label = document.createElement("span");
            label.style.cssText = "font-size: 8px; color: #888;";
            label.innerText = `Slot ${index + 1}`;

            slotCont.appendChild(picker);
            slotCont.appendChild(label);
            grid.appendChild(slotCont);
        });

        this.listContainer.appendChild(grid);
    }

}