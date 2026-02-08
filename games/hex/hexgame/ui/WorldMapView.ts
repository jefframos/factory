import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import HexAssets from "../HexAssets";
import { LevelData, WorldData } from "../HexTypes";
import { LevelDataManager } from "../LevelDataManager";
import { Point, SplineUtils } from "../mapEditor/SplineUtils";
import { VisualLayer } from "../mapEditor/VisualEditorLogic";
import { VisualViewController } from "../mapEditor/VisualViewController";
import { PathRope } from "./PathRope";

// ---------- Map-data types ----------
export interface WorldMapPoint {
    id: string;
    x: number;
    y: number;
    order: number;
}

export interface WorldMapData {
    points: WorldMapPoint[];
    visuals?: {
        layers: VisualLayer[];
    };
}

export interface WorldMapViewStyle {
    levelButtonTexture: string;
    levelButtonSize: number;
    backButtonTexture: string;
    backIconTexture: string;
    splineColor: number;
    splineAlpha: number;
    splineWidth: number;
    titleFontSize: number;
    titleColor: number;
    titleY: number;
}

export interface WorldMapViewOptions {
    parent: PIXI.Container;
    mapData: WorldMapData;
    worlds?: WorldData[];
    worldId?: string;
    style: WorldMapViewStyle;
    onLevelSelected?: (level: LevelData, world: WorldData) => void;
    onBack?: () => void;
}

type AssignedPoint = {
    point: WorldMapPoint;
    level: LevelData;
    world: WorldData;
    button: BaseButton;
};

export class WorldMapView extends PIXI.Container {

    public readonly onUpdateCurrentLevel: Signal = new Signal();
    private readonly opts: WorldMapViewOptions;
    private readonly backgroundShape: PIXI.Graphics = new PIXI.Graphics();
    private readonly rootWorldContainer: PIXI.Container;

    // Bottom Layer: Floor visuals + Path Ropes
    private readonly splineContainer: PIXI.Container = new PIXI.Container();

    // Top Layer: Sorted props (Trees/Buildings) + Buttons
    private readonly pointsContainer: PIXI.Container = new PIXI.Container();

    private pathRopeDone!: PathRope;
    private pathRopeTodo!: PathRope;

    private currentLevelIndex: number = 0;
    private controlPointsSorted: WorldMapPoint[] = [];
    private readonly visualController: VisualViewController;
    private assigned: AssignedPoint[] = [];

    private targetPosition: PIXI.Point = new PIXI.Point(0, 0);
    private lerpSpeed: number = 0.1; // Adjust for smoothness

    constructor(opts: WorldMapViewOptions) {
        super();
        this.opts = opts;
        this.setupBackground();
        this.addChild(this.backgroundShape);

        this.rootWorldContainer = new PIXI.Container();
        this.addChild(this.rootWorldContainer);

        // 1. Setup Background (Massive rectangle)

        // 2. Setup Containers & Depth Sorting
        this.pointsContainer.sortableChildren = true;
        this.rootWorldContainer.addChild(this.splineContainer);
        this.rootWorldContainer.addChild(this.pointsContainer);

        // 3. Initialize Ropes (Permanent objects)
        this.initRopes();

        // 4. Controller initialization
        this.visualController = new VisualViewController(this.rootWorldContainer, this.splineContainer, this.pointsContainer);

        // 5. UI Elements
        opts.parent.addChild(this);

        // 6. Initial Build
        this.rebuildFromData(opts.mapData, opts.worldId);

        const gr = new PIXI.Graphics();
        gr.beginFill(0xff0000);
        gr.drawCircle(0, 0, 10);
        gr.endFill();
        this.addChild(gr)
    }

    private setupBackground(): void {
        const size = 100000;
        this.backgroundShape.beginFill(0x1a1a1a);
        this.backgroundShape.drawRect(-size / 2, -size / 2, size, size);
        this.backgroundShape.endFill();
        this.backgroundShape.interactive = false;
    }

    private initRopes(): void {
        this.pathRopeDone = new PathRope({
            texture: PIXI.Texture.WHITE,
            segmentPoints: 25,
            tension: 0.5,
            spacing: 12,
            alpha: 1,
            tint: 0xffff00
        });

        this.pathRopeTodo = new PathRope({
            texture: PIXI.Texture.WHITE,
            segmentPoints: 25,
            tension: 0.5,
            spacing: 12,
            alpha: 1,
            tint: 0xffffff
        });

        this.splineContainer.addChild(this.pathRopeTodo);
        this.splineContainer.addChild(this.pathRopeDone);
    }

    public rebuildFromData(mapData: WorldMapData, worldId?: string): void {
        // 1. Clear Foreground (Buttons + Decorations)
        this.pointsContainer.removeChildren().forEach(c => c.destroy({ children: true }));

        // 2. Clear Spline Container visuals ONLY (Preserving Ropes)
        for (let i = this.splineContainer.children.length - 1; i >= 0; i--) {
            const child = this.splineContainer.children[i];
            if (child !== this.pathRopeTodo && child !== this.pathRopeDone) {
                child.destroy({ children: true });
            }
        }

        this.assigned = [];

        // 3. Separate Layers by Depth logic
        const allLayers = mapData.visuals?.layers ?? [];
        const bgLayers = allLayers.filter(l => (l as any).belowSpline === true);
        const fgLayers = allLayers.filter(l => !(l as any).belowSpline);

        // 4. Deserialize Background (below path)
        this.visualController.deserialize(bgLayers);

        // 5. Draw the Path Spline
        this.controlPointsSorted = [...(mapData.points ?? [])].sort((a, b) => a.order - b.order);
        this.drawSpline(this.controlPointsSorted);

        // 6. Deserialize Foreground (mixed with buttons)
        this.visualController.deserialize(fgLayers);

        // 7. Map Levels to Buttons
        const sequence = this.buildLevelSequence(worldId);
        const count = Math.min(this.controlPointsSorted.length, sequence.length);

        for (let i = 0; i < count; i++) {
            const point = this.controlPointsSorted[i];
            const { level, world } = sequence[i];

            const btn = this.createLevelButton(i, point, level, world);
            this.pointsContainer.addChild(btn);
            this.assigned.push({ point, level, world, button: btn });
        }

        // 8. Apply Global Y-Sorting for FG
        this.pointsContainer.children.forEach(child => {
            child.zIndex = child.y;
        });
        this.pointsContainer.sortChildren();

        // 9. Initial View State
        if (this.assigned.length > 0) {
            this.setSelected(0);
            this.centerOnLevel(0);
        }
    }

    private drawSpline(points: WorldMapPoint[]): void {
        if (points.length < 2) {
            this.pathRopeDone.clearRope();
            this.pathRopeTodo.clearRope();
            return;
        }

        const segmentPoints = 25;
        const tension = 0.5;
        const control: Point[] = points.map(p => ({ x: p.x, y: p.y }));

        const fullSpline = SplineUtils.generateCatmullRomSpline(control, segmentPoints, tension);

        const k = Math.max(0, Math.min(this.currentLevelIndex, control.length - 1));
        const splitSampleIndex = Math.min(k * segmentPoints, fullSpline.length - 1);

        const doneSamples = fullSpline.slice(0, splitSampleIndex + 1);
        const todoSamples = fullSpline.slice(splitSampleIndex);

        if (doneSamples.length >= 2) this.pathRopeDone.setSampledPoints(doneSamples);
        else this.pathRopeDone.clearRope();

        if (todoSamples.length >= 2) this.pathRopeTodo.setSampledPoints(todoSamples);
        else this.pathRopeTodo.clearRope();
    }

    private createLevelButton(index: number, point: WorldMapPoint, level: LevelData, world: WorldData): BaseButton {
        const size = this.opts.style.levelButtonSize;
        const btn = new BaseButton({
            standard: {
                width: size,
                height: size,
                fontStyle: new PIXI.TextStyle({ ...HexAssets.MainFont }),
                texture: PIXI.Texture.from(this.opts.style.levelButtonTexture),
                centerIconHorizontally: true,
                centerIconVertically: true
            },
            disabled: {
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Grey)
            },
            click: {
                callback: () => {
                    this.setSelected(index);
                    this.opts.onLevelSelected?.(level, world);
                }
            }
        });

        btn.position.set(point.x, point.y);
        btn.pivot.set(size * 0.5, size * 0.5);
        btn.setLabel(String(index + 1))

        return btn;
    }

    public setSelected(index: number): void {
        if (index < 0 || index >= this.assigned.length) return;
        const selected = this.assigned[index];

        this.assigned.forEach((entry, i) => {
            entry.button.scale.set(i === index ? 1.08 : 1);
        });
    }
    public getCurrentIndex(): number {
        return this.currentLevelIndex;
    }
    public centerOnLevel(index: number, animate: boolean = true): void {
        if (index < 0 || index >= this.assigned.length) return;

        const point = this.assigned[index].point;

        // We want the point to end up at (0, 0) relative to our "camera"
        // The camera view logic in the Scene will handle the 75% offset
        this.targetPosition.set(-point.x, -point.y);

        if (!animate) {
            this.rootWorldContainer.position.copyFrom(this.targetPosition);
        }
    }

    public update(delta: number): void {
        // Smoothly lerp the container position towards the target level point
        // This makes the current level point move to the 0,0 of the map container
        this.rootWorldContainer.x += (this.targetPosition.x - this.rootWorldContainer.x) * this.lerpSpeed;
        this.rootWorldContainer.y += (this.targetPosition.y - this.rootWorldContainer.y) * this.lerpSpeed;
    }

    public setCurrentLevelIndex(index: number): void {
        this.currentLevelIndex = index;
        this.assigned.forEach((entry, i) => {
            if (i <= index) {
                entry.button.enable()
            } else {
                entry.button.disable()

            }
        });

        this.onUpdateCurrentLevel.dispatch(index);
        this.drawSpline(this.controlPointsSorted);
    }

    private buildLevelSequence(worldId?: string): Array<{ level: LevelData; world: WorldData }> {
        const sequence: Array<{ level: LevelData; world: WorldData }> = [];
        const worlds = this.opts.worlds ?? LevelDataManager.getEnabledWorlds();

        if (worldId) {
            const w = worlds.find(w => w.id === worldId);
            w?.levels?.forEach(lvl => sequence.push({ level: lvl, world: w }));
            return sequence;
        }

        worlds.forEach(w => {
            if (w.enabled) w.levels?.forEach(lvl => sequence.push({ level: lvl, world: w }));
        });
        return sequence;
    }
}