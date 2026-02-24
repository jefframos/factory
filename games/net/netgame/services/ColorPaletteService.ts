import { PaletteSet, View3DDefinition } from "../level/LevelTypes";

export class ColorPaletteService {
    private static _palettes: Map<string, number[]> = new Map();
    private static _activeId: string = "Default";

    public static init(palettes: PaletteSet[], activeId: string): void {
        this._palettes.clear();

        if (palettes && palettes.length > 0) {
            palettes.forEach(p => {
                // Ensure p.colors exists and has 8 values, otherwise use default white
                const colors = (p.colors && p.colors.length === 8)
                    ? [...p.colors]
                    : new Array(8).fill(0xffffff);

                this._palettes.set(p.id, colors);
            });
        }

        this._activeId = activeId || (palettes && palettes[0] ? palettes[0].id : "Default");

        // Final safety: if map is still empty, create the Default set
        if (this._palettes.size === 0 || !this._palettes.has(this._activeId)) {
            if (!this._palettes.has("Default")) {
                this._palettes.set("Default", new Array(8).fill(0xffffff));
            }
            this._activeId = "Default";
        }
    }
    public static resolveViewColor(view: View3DDefinition, fallback: number = 0x7CFF01): number {
        // 1. Priority: Color Slot (1-8)
        if (view.colorSlot !== undefined && view.colorSlot >= 1 && view.colorSlot <= 8) {
            return this.resolve(view.colorSlot, fallback);
        }

        // 2. Secondary: Color ID (Legacy/Named lookup)
        // If you still use named colors alongside the 8-slot system
        /* if (view.colorId && view.colorId !== 'none') {
            return this.resolveById(view.colorId, fallback); 
        }
        */

        // 3. Tertiary: Custom Hex Color
        if (view.color !== undefined) {
            return view.color;
        }

        // 4. Final Fallback
        return fallback;
    }
    public static getAllPalettes(): PaletteSet[] {
        return Array.from(this._palettes.entries()).map(([id, colors]) => {
            return {
                id: id,
                colors: [...colors] // Explicitly spread to ensure a fresh array copy
            };
        });
    }

    public static getActivePalette(): number[] {
        return this._palettes.get(this._activeId) || new Array(8).fill(0xffffff);
    }

    public static setActivePalette(id: string) {
        if (this._palettes.has(id)) this._activeId = id;
    }

    public static updateColor(slotIndex: number, hex: number) {
        const colors = this.getActivePalette();
        colors[slotIndex] = hex;
    }

    public static duplicatePalette(newId: string) {
        const current = this.getActivePalette();
        this._palettes.set(newId, [...current]);
        this._activeId = newId;
    }

    public static resolve(slot?: number, fallback: number = 0xffffff): number {
        if (slot !== undefined && slot >= 1 && slot <= 8) {
            return this.getActivePalette()[slot - 1];
        }
        return fallback;
    }


    public static getActiveId(): string { return this._activeId; }
}