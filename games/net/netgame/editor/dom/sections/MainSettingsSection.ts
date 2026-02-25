import { OBJECT_SCHEMA } from "../EditorSchema";
import { SectionRenderer } from "./SectionRenderer";

export class MainSettingsSection extends SectionRenderer {
    render(obj: any) {
        const container = this.createContainer("Core Settings", "#3498db");

        // 1. Basic Fields
        this.createTextInput(container, "LABEL", obj, 'label');

        // Collectibles are usually sensors, but we'll keep this for flexibility 
        // unless you want to hide it for coins/cargo too.
        this.createCheckbox(container, "IS STATIC", obj, 'isStatic');

        // 2. Geometry Fields Logic
        const fields = OBJECT_SCHEMA[obj.type] || [];

        fields.forEach(field => {
            // Skip manual fields and coordinate fields (X/Y handled by Gizmo/Transform)
            if (field === 'label' || field === 'isStatic' || field === 'x' || field === 'y') return;

            // --- LOCK LOGIC ---
            // If this object is a collectible, do NOT render Width, Height, or Radius inputs.
            if (obj.collectible) {
                if (field === 'width' || field === 'height' || field === 'radius') {
                    return;
                }
            }

            this.createNumericInput(container, field.toUpperCase(), obj, field);
        });

        // 3. Visual Feedback for Locked Dimensions
        if (obj.collectible) {
            const lockMsg = document.createElement("div");
            lockMsg.style.cssText = "font-size: 9px; color: #f1c40f; font-style: italic; margin-top: 4px; opacity: 0.8;";
            lockMsg.innerText = "🔒 Dimensions locked for collectible type.";
            container.appendChild(lockMsg);
        }
    }
}