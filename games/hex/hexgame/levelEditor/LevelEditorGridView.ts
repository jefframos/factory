import * as PIXI from "pixi.js";
import { HexUtils } from "../HexTypes";
import { LevelMatrixCodec } from "./LevelMatrixCodec";

type TileMode = "active" | "preview";

export class LevelEditorGridView extends PIXI.Container {
    public onTileToggle?: (key: string, mode: TileMode) => void;

    private tilesContainer: PIXI.Container = new PIXI.Container();

    private activeKeys: string[] = [];
    private previewKeys: string[] = [];

    private dirty: boolean = true;

    public constructor() {
        super();
        this.addChild(this.tilesContainer);
    }

    public setState(active: Set<string> | string[], preview: Set<string> | string[]): void {
        // IMPORTANT: stabilize order so comparisons are deterministic
        const newActive = this.normalize(active).sort();
        const newPreview = this.normalize(preview).sort();

        if (!this.sameArray(newActive, this.activeKeys) || !this.sameArray(newPreview, this.previewKeys)) {
            this.activeKeys = newActive;
            this.previewKeys = newPreview;
            this.dirty = true;
        }
    }

    public update(_dt: number): void {
        if (!this.dirty) {
            return;
        }
        this.dirty = false;
        this.rebuild();
    }

    public reset(): void {
        this.activeKeys = [];
        this.previewKeys = [];
        this.dirty = true;
    }

    private normalize(v: Set<string> | string[]): string[] {
        if (v instanceof Set) {
            return Array.from(v);
        }
        if (Array.isArray(v)) {
            return v.slice();
        }
        return [];
    }

    private sameArray(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    private rebuild(): void {
        console.log("REBUILD tiles:", this.previewKeys.length, this.activeKeys.length);

        // Clean up old container completely FIRST
        this.tilesContainer.removeChildren().forEach((c) => c.destroy());
        this.removeChild(this.tilesContainer);
        this.tilesContainer.destroy();

        // NOW create and add the new container
        this.tilesContainer = new PIXI.Container();
        this.addChild(this.tilesContainer);

        // Draw preview first (under)
        for (const k of this.previewKeys) {
            this.drawTile(k, "preview");
        }
        // Draw active on top
        for (const k of this.activeKeys) {
            this.drawTile(k, "active");
        }

        this.centerPivotFromBounds();
    }

    private drawTile(key: string, mode: TileMode): void {
        const { q, r } = LevelMatrixCodec.parseKey(key);

        // ✅ In this project, HexUtils.offsetToPixel is actually AXIAL -> pixel
        const pos = HexUtils.offsetToPixel(q, r);


        const g = new PIXI.Graphics();

        const alpha = mode === "active" ? 0.25 : 0.12;
        const lineAlpha = mode === "active" ? 0.30 : 0.18;

        g.lineStyle(2, 0xffffff, lineAlpha);
        g.beginFill(0xffffff, alpha);

        const size = HexUtils.HEX_SIZE;
        const points: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i - 30);
            points.push(pos.x + size * Math.cos(angle), pos.y + size * Math.sin(angle));
        }
        g.drawPolygon(points);
        g.endFill();

        // ✅ explicit hitArea avoids weird stale bounds when pivot changes
        g.hitArea = new PIXI.Polygon(points);

        g.eventMode = "static";
        g.cursor = "pointer";
        g.on("pointertap", () => {
            this.onTileToggle?.(key, mode);
        });

        this.tilesContainer.addChild(g);
    }

    private centerPivotFromBounds(): void {
        const b = this.getLocalBounds();
        this.pivot.set(b.x + b.width / 2, b.y + b.height / 2);
    }
}
