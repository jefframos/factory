import { ColorPaletteService } from "../../../services/ColorPaletteService";
import { SectionRenderer } from "./SectionRenderer";

export class View3DSection extends SectionRenderer {
    render(obj: any) {
        const container = this.createContainer("3D Appearance", "#9b59b6");
        if (!obj.view3d) return;

        // Slot Selection (1-8)
        const slotOptions = ['1', '2', '3', '4', '5', '6', '7', '8', 'none'];
        this.createDropdown(container, "COLOR SLOT", obj.view3d, 'colorSlot', slotOptions);

        if (obj.view3d.colorSlot === 'none' || !obj.view3d.colorSlot) {
            this.createColorPicker(container, "CUSTOM COLOR", obj.view3d, 'color');
        } else {
            // Visual indicator of which color is currently resolved from the slot
            const resolved = ColorPaletteService.resolve(parseInt(obj.view3d.colorSlot));
            const row = this.createRow(container, "SLOT PREVIEW");
            row.innerHTML += `<div style="width:20px; height:20px; background:#${resolved.toString(16).padStart(6, '0')}; border-radius:4px;"></div>`;
        }
    }

    protected createColorPicker(parent: HTMLElement, label: string, target: any, prop: string) {
        const row = this.createRow(parent, label);
        const input = document.createElement("input");
        input.type = "color";
        // Convert number to hex string for HTML input
        input.value = `#${(target[prop] || 0xffffff).toString(16).padStart(6, '0')}`;
        input.style.cssText = "width: 40px; height: 20px; border: none; background: none; cursor: pointer;";

        input.oninput = () => {
            target[prop] = parseInt(input.value.replace("#", ""), 16);
            this.onUpdate();
        };
        row.appendChild(input);
    }
}