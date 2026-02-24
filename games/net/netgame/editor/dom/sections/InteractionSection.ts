import { SectionRenderer } from "./SectionRenderer";

export class InteractionSection extends SectionRenderer {
    render(obj: any) {
        const container = this.createContainer("Visual Interaction", "#f1c40f");

        if (!obj.interaction) {
            const btn = this.createButton("+ ADD VISUAL EFFECT", "#27ae60", () => {
                obj.interaction = {
                    trigger: 'start',
                    type: 'scale_bounce',
                    targetScale: 1.2,
                    duration: 200
                };
                this.onUpdate();
            });
            container.appendChild(btn);
        } else {
            this.createDropdown(container, "TRIGGER", obj.interaction, 'trigger', ['start', 'active', 'end']);
            this.createDropdown(container, "EFFECT", obj.interaction, 'type', ['scale_bounce', 'none']);
            this.createNumericInput(container, "BOUNCE AMT", obj.interaction, 'targetScale');
            this.createNumericInput(container, "DURATION (MS)", obj.interaction, 'duration');

            const remBtn = this.createButton("REMOVE INTERACTION", "rgba(231, 76, 60, 0.2)", () => {
                delete obj.interaction;
                this.onUpdate();
            });
            remBtn.style.color = "#e74c3c";
            container.appendChild(remBtn);
        }
    }
}