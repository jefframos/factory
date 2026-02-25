import { SectionRenderer } from "./SectionRenderer";

export class CollectibleSection extends SectionRenderer {
    public render(obj: any): void {
        // Only show this section if the object is explicitly a collectible
        if (!obj.collectible) return;

        const container = this.createContainer("Collectible Settings", "#f1c40f");

        // Display the type clearly
        this.createRow(container, `Type: ${obj.collectible.type.toUpperCase()}`);

        if (obj.collectible.type === 'coin') {
            // Only allow changing the coin's value
            this.createNumericInput(container, "Coin Value", obj.collectible, "value");

            const info = document.createElement("div");
            info.style.cssText = "font-size: 9px; color: #777; margin-top: 5px; text-align: center;";
            info.innerText = "Size is fixed at 20px radius.";
            container.appendChild(info);
        }

        if (obj.collectible.type === 'cargo') {
            // Only allow changing the Cargo ID for the grid system
            this.createTextInput(container, "Cargo ID", obj.collectible, "cargoId");

            const info = document.createElement("div");
            info.style.cssText = "font-size: 9px; color: #777; margin-top: 5px; text-align: center;";
            info.innerText = "Size is fixed at 40x40px.";
            container.appendChild(info);
        }
    }
}