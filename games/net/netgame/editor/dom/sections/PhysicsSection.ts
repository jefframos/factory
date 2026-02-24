import { SectionRenderer } from "./SectionRenderer";

export class PhysicsSection extends SectionRenderer {
    render(obj: any) {
        const container = this.createContainer("Physics Settings", "#e67e22");

        // 1. Ensure physics object exists (Sanitization)
        if (!obj.physics) {
            obj.physics = {
                isStatic: obj.isStatic ?? true, // Fallback to old property if it existed
                isSensor: obj.isSensor ?? false,
                mass: 1,
                friction: 1,
                restitution: 0.5,
                density: 0.001
            };
        }

        const ph = obj.physics;

        // 2. Core State
        this.createCheckbox(container, "IS STATIC (Fixed)", ph, 'isStatic');
        this.createCheckbox(container, "IS SENSOR (Ghost)", ph, 'isSensor');

        // 3. Material Properties
        // Friction: usually 0 to 1
        this.createSlider(container, "FRICTION", ph, 'friction', 0, 1, 0.05);

        // Restitution: 0 (no bounce) to 1 (perfect bounce)
        this.createSlider(container, "BOUNCINESS", ph, 'restitution', 0, 1.2, 0.05);

        // 4. Weight Logic
        if (!ph.isStatic) {
            this.createNumericInput(container, "MASS (kg)", ph, 'mass');
            this.createNumericInput(container, "DENSITY", ph, 'density');
        } else {
            const info = document.createElement("div");
            info.style.cssText = "font-size: 9px; color: #777; font-style: italic; margin-top: 5px;";
            info.innerText = "Mass/Density ignored for static objects.";
            container.appendChild(info);
        }
    }
}