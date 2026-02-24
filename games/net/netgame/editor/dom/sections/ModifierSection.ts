import { SectionRenderer } from "./SectionRenderer";

export class ModifierSection extends SectionRenderer {
    render(obj: any) {
        const container = this.createContainer("Physics Modifier", "#2ecc71");

        if (!obj.modifier) {
            // Use this.createButton which is defined in the base class
            const addBtn = this.createButton("+ ADD MODIFIER", "#27ae60", () => {
                obj.modifier = { trigger: 'start', mode: 'add', force: { x: 0, y: 0 } };
                this.onUpdate();
            });
            container.appendChild(addBtn);
        } else {
            this.createDropdown(container, "TRIGGER", obj.modifier, 'trigger', ['start', 'active', 'end']);
            this.createDropdown(container, "MODE", obj.modifier, 'mode', ['add', 'set', 'multiply']);
            this.createNumericInput(container, "FORCE X", obj.modifier.force, 'x');
            this.createNumericInput(container, "FORCE Y", obj.modifier.force, 'y');
            this.createCheckbox(container, "RADIAL?", obj.modifier, 'useRadialDirection');

            const remBtn = this.createButton("REMOVE MODIFIER", "rgba(231, 76, 60, 0.2)", () => {
                delete obj.modifier;
                this.onUpdate();
            });
            remBtn.style.color = "#e74c3c";
            container.appendChild(remBtn);
        }
    }
}