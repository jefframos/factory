import { OBJECT_SCHEMA } from "../EditorSchema";
import { SectionRenderer } from "./SectionRenderer";

export class MainSettingsSection extends SectionRenderer {
    render(obj: any) {
        const container = this.createContainer("Core Settings", "#3498db");

        this.createTextInput(container, "LABEL", obj, 'label');
        this.createCheckbox(container, "IS STATIC", obj, 'isStatic');

        // Look up which fields to show for this specific type (box, circle, etc)
        const fields = OBJECT_SCHEMA[obj.type] || [];
        fields.forEach(field => {
            // Skip the ones we already handled manually above
            if (field === 'label' || field === 'isStatic' || field === 'x' || field === 'y') return;

            this.createNumericInput(container, field.toUpperCase(), obj, field);
        });
    }
}