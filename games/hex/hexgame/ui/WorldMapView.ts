import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { GameplayProgressStorage } from "../data/GameplayProgressStorage";
import { LevelData, WorldData } from "../HexTypes";
import { LevelDataManager } from "../LevelDataManager";
import { Point, SplineUtils } from "../mapEditor/SplineUtils";
import { VisualLayer, VisualViewController } from "../mapEditor/VisualViewController";
import { LevelButtonView } from "./LevelButtonView";
import { PathRope } from "./PathRope";
import { PinState, WorldMapPin } from "./WorldMapPin";

// ---------- Map-data types ----------
export interface WorldMapPoint {
    id: string;
    x: number;
    y: number;
    order: number;
}
export interface WorldMapBoundary {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface WorldMapData {
    points: WorldMapPoint[];
    visuals?: {
        layers: VisualLayer[];
    };
    worldBoundaries?: WorldMapBoundary[];
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

    private boundaries: WorldMapBoundary[] = [];
    private viewportRect: PIXI.Rectangle = new PIXI.Rectangle(0, 0, 800, 600); // Default size
    private combinedBounds: PIXI.Rectangle | null = null;
    private viewportAnchor: PIXI.Point = new PIXI.Point(0, 0);

    public readonly onUpdateCurrentLevel: Signal = new Signal();
    private opts!: WorldMapViewOptions;
    private readonly backgroundShape: PIXI.Graphics = new PIXI.Graphics();
    private readonly rootWorldContainer: PIXI.Container;

    // Bottom Layer: Floor visuals + Path Ropes
    private readonly backgroundContainer: PIXI.Container = new PIXI.Container();
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

    private readonly debugGraphics: PIXI.Graphics = new PIXI.Graphics();
    public showDebug: boolean = false; // Toggle this to see boundaries

    private static readonly ACTIVATION_DISTANCE: number = 20; // Pixels
    public readonly onUpdatePinPosition: Signal = new Signal();

    private isAnimatingPath: boolean = false;
    private pathProgress: number = 0; // 0 to 1
    private currentSplinePoints: Point[] = [];
    private moveDuration: number = 1000; // ms
    private moveStartTime: number = 0;

    private isBeingDragged: boolean = false;

    private pinComponent: WorldMapPin | null = null;

    // Add this to your class properties
    private animationResolver: ((value: void | PromiseLike<void>) => void) | null = null;

    constructor() {
        super();
        // this.setupBackground();
        // this.addChild(this.backgroundShape);

        this.rootWorldContainer = new PIXI.Container();
        this.addChild(this.rootWorldContainer);

        // 1. Setup Background (Massive rectangle)

        // 2. Setup Containers & Depth Sorting
        this.pointsContainer.sortableChildren = true;
        this.rootWorldContainer.addChild(this.backgroundContainer);
        this.rootWorldContainer.addChild(this.splineContainer);
        this.rootWorldContainer.addChild(this.pointsContainer);

        // 3. Initialize Ropes (Permanent objects)


        // 4. Controller initialization
        this.visualController = new VisualViewController(this.backgroundContainer, this.splineContainer, this.pointsContainer);


        const gr = new PIXI.Graphics();
        gr.beginFill(0xff0000);
        gr.drawCircle(0, 0, 10);
        gr.endFill();
        //this.addChild(gr)

        this.addChild(this.debugGraphics);

    }
    public startDragging(): void {
        if (this.isAnimatingPath) return;

        this.isBeingDragged = true;
    }

    public stopDragging(): void {
        this.isBeingDragged = false;
        // Sync targetPosition to current location so Lerp doesn't jump back
        this.targetPosition.set(this.rootWorldContainer.x, this.rootWorldContainer.y);
    }

    public applyManualMove(dx: number, dy: number): void {
        // 1. Calculate the intended new position
        const nextX = this.rootWorldContainer.x + dx;
        const nextY = this.rootWorldContainer.y + dy;

        // 2. Use your existing constraint logic to keep it in bounds
        const constrained = this.getConstrainedPosition(nextX, nextY);

        // 3. Apply directly for 1:1 movement
        this.rootWorldContainer.x = constrained.x;
        this.rootWorldContainer.y = constrained.y;
    }
    public async initialize(opts: WorldMapViewOptions): Promise<void> {
        this.opts = opts;
        // Any async initialization can go here if needed in the future
        // 5. UI Elements
        opts.parent.addChild(this);

        // 6. Initial Build
        await this.rebuildFromData(opts.mapData, opts.worldId);

    }
    private setupBackground(): void {
        const size = 100000;
        this.backgroundShape.beginFill(0x1a1a1a);
        this.backgroundShape.drawRect(-size / 2, -size / 2, size, size);
        this.backgroundShape.endFill();
        this.backgroundShape.interactive = false;
    }

    private async initRopes(): Promise<void> {
        const todoTextureUrl = 'hex/images/non-preload/maps/paths/sand-path-2.webp';
        let todoTexture: PIXI.Texture;

        try {
            // Attempt to load the specific texture
            todoTexture = await PIXI.Assets.load(todoTextureUrl);
        } catch (e) {
            console.warn(`Failed to load rope texture: ${todoTextureUrl}. Falling back to WHITE.`);
            todoTexture = PIXI.Texture.WHITE;
        }

        this.pathRopeDone = new PathRope({
            texture: todoTexture,
            segmentPoints: 25,
            tension: 0.5,
            spacing: 12,
            alpha: 1,
            tint: 0xffffff,
            textureScale: 0.25
        });

        this.pathRopeTodo = new PathRope({
            texture: todoTexture,
            segmentPoints: 25,
            tension: 0.5,
            spacing: 20,
            alpha: 1,
            tileScale: 200,
            tint: 0xffffff,
            textureScale: 0.25
        });

        this.splineContainer.addChild(this.pathRopeTodo);
        this.splineContainer.addChild(this.pathRopeDone);
    }

    public async rebuildFromData(mapData: WorldMapData, worldId?: string): Promise<void> {
        // 1. Clear Foreground
        this.pointsContainer.removeChildren().forEach(c => c.destroy({ children: true }));

        // 2. Clear Spline Container visuals
        for (let i = this.splineContainer.children.length - 1; i >= 0; i--) {
            const child = this.splineContainer.children[i];
            if (child !== this.pathRopeTodo && child !== this.pathRopeDone) {
                child.destroy({ children: true });
            }
        }

        this.assigned = [];

        if (mapData.worldBoundaries) {
            this.setBoundaries(mapData.worldBoundaries);
        }

        const allLayers = mapData.visuals?.layers ?? [];
        const bgLayers = allLayers.filter(l => l.isBelowSpline === true);
        const fgLayers = allLayers.filter(l => !l.isBelowSpline);

        // 3. Process URLs (synchronous mapping is fine here)
        const fixUrls = (layers: VisualLayer[]) => {
            layers.forEach(layer => {
                layer.images.forEach(img => {
                    img.url = img.url.replace(/^.*raw-assets\//, 'hex/images/').replace(/\.png$/, '.webp');
                });
            });
        };

        fixUrls(bgLayers);
        fixUrls(fgLayers);

        // 4. Deserialize (Now properly awaiting the async calls)
        await this.visualController.deserializeAsync(bgLayers);

        // 5. Initialize Ropes (Awaiting texture load)
        await this.initRopes();
        this.visualController.deserializeAsync(fgLayers);

        // 6. Draw Path
        this.controlPointsSorted = [...(mapData.points ?? [])].sort((a, b) => a.order - b.order);
        this.drawSpline(this.controlPointsSorted);

        // 7. Map Levels to Buttons
        const sequence = this.buildLevelSequence(worldId);
        const count = Math.min(this.controlPointsSorted.length, sequence.length);

        for (let i = 0; i < count; i++) {
            const point = this.controlPointsSorted[i];
            const { level, world } = sequence[i];

            const btn = this.createLevelButton(i, point, level, world);
            this.pointsContainer.addChild(btn);
            this.assigned.push({ point, level, world, button: btn.button });
        }

        // 8. Sorting
        this.pointsContainer.children.forEach(child => {
            child.zIndex = child.y;
        });
        this.pointsContainer.sortChildren();

        // 9. Initial View State
        if (this.assigned.length > 0) {
            this.setSelected(0);
            this.centerOnLevel(0, false);
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

    // Inside WorldMapView.ts

    private createLevelButton(index: number, point: WorldMapPoint, level: LevelData, world: WorldData): LevelButtonView {
        // 1. Get the star data
        const levelData = GameplayProgressStorage.getLevelData(index);
        const stars = levelData ? levelData.stars : 0;

        // 2. Check if unlocked using your storage's currentProgressIndex
        // We can access the cached data safely here because the map is built after initialization
        const latestUnlocked = GameplayProgressStorage.getDataSync().currentProgressIndex;
        const isUnlocked = index <= latestUnlocked;

        const btn = new LevelButtonView(
            index,
            level,
            stars,
            isUnlocked
        );

        btn.onSelected.add(() => {
            const latestUnlocked = GameplayProgressStorage.getDataSync().currentProgressIndex;

            // Check if this specific button's index is within the allowed range
            if (index <= latestUnlocked) {
                this.setSelected(index);
                this.opts.onLevelSelected?.(level, world);
            } else {
                console.log("Level still locked!");
            }
        });

        btn.position.set(point.x, point.y);
        return btn;
    }

    public applyDrag(dx: number, dy: number): void {
        if (this.isAnimatingPath) {
            this.isBeingDragged = false;
            return;
        }

        // We add the delta to the current target
        this.targetPosition.x += dx;
        this.targetPosition.y += dy;
    }
    public recenter(): void {
        this.centerOnLevel(this.currentLevelIndex, true);
    }

    public setPin(pin: WorldMapPin): void {
        this.pinComponent = pin;
        this.pointsContainer.addChild(this.pinComponent);
        this.syncPinToCurrentLevel();
    }

    private syncPinToCurrentLevel(): void {
        if (!this.pinComponent || this.assigned.length === 0) return;

        const currentPoint = this.assigned[this.currentLevelIndex].point;
        this.pinComponent.position.set(currentPoint.x, currentPoint.y);
        this.pinComponent.zIndex = currentPoint.y + 1000;

        // Notify external listeners if needed
        this.onUpdatePinPosition.dispatch(currentPoint.x, currentPoint.y);
    }
    public setSelected(index: number): void {
        if (index < 0 || index >= this.assigned.length) return;
        const selected = this.assigned[index];

        // this.assigned.forEach((entry, i) => {
        //     entry.button.scale.set(i === index ? 1.08 : 1);
        // });
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
            const constrained = this.getConstrainedPosition(this.targetPosition.x, this.targetPosition.y);
            this.rootWorldContainer.x = constrained.x;
            this.rootWorldContainer.y = constrained.y;
        }
    }

    public async animateToLevel(index: number): Promise<void> {
        // If already animating, you might want to resolve the previous one immediately
        if (this.animationResolver) {
            this.animationResolver();
            this.animationResolver = null;
        }

        const prevIndex = this.currentLevelIndex;
        this.currentLevelIndex = index;

        const control: Point[] = this.controlPointsSorted.map(p => ({ x: p.x, y: p.y }));
        const fullSpline = SplineUtils.generateCatmullRomSpline(control, 50, 0.5);

        const segmentPoints = 50;
        const startIndex = prevIndex * segmentPoints;
        const endIndex = index * segmentPoints;

        this.currentSplinePoints = fullSpline.slice(
            Math.min(startIndex, endIndex),
            Math.max(startIndex, endIndex) + 1
        );

        if (prevIndex > index) {
            this.currentSplinePoints.reverse();
        }

        this.isAnimatingPath = true;
        this.pathProgress = 0;
        this.moveStartTime = performance.now();

        this.refreshButtonVisuals(index);
        this.onUpdateCurrentLevel.dispatch(index);

        // Return a promise that resolves when the update loop finishes the path
        return new Promise((resolve) => {
            this.animationResolver = resolve;
        });
    }
    public refreshAllButtons(): void {
        const latestUnlocked = GameplayProgressStorage.getDataSync().currentProgressIndex;

        this.assigned.forEach((entry, index) => {
            const progress = GameplayProgressStorage.getLevelData(index);
            const stars = progress ? progress.stars : 0;
            const isUnlocked = index <= latestUnlocked;

            // Cast to LevelButtonView to access our new updateProgress method
            const view = entry.button.parent as LevelButtonView;
            if (view && view.updateState) {
                view.updateState(isUnlocked, stars);
            }
        });
    }


    private refreshButtonVisuals(targetIndex: number): void {
        this.assigned.forEach((entry, i) => {
            if (i <= targetIndex) {
                entry.button.renderable = true;
                // We set interaction to false initially if it's the target level 
                // and we are currently animating.
                if (i === targetIndex && this.isAnimatingPath) {
                    entry.button.disable();
                } else {
                    entry.button.enable();
                }
            } else {
                entry.button.disable();
            }
        });
    }

    /**
     * Checks distance between pin and level buttons.
     * Activates interaction once the pin is within the threshold.
     */
    private checkButtonActivation(pinPos: Point): void {
        const targetEntry = this.assigned[this.currentLevelIndex];
        if (!targetEntry) return;

        const dx = pinPos.x - targetEntry.point.x;
        const dy = pinPos.y - targetEntry.point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < WorldMapView.ACTIVATION_DISTANCE) {
            targetEntry.button.enable();
        }
    }
    public update(delta: number): void {
        if (this.isAnimatingPath) {
            const elapsed = performance.now() - this.moveStartTime;
            this.pathProgress = Math.min(elapsed / this.moveDuration, 1);

            const pointIndex = Math.floor(this.pathProgress * (this.currentSplinePoints.length - 1));
            const currentPos = this.currentSplinePoints[pointIndex];

            if (currentPos && this.pinComponent) {
                // This is fine, but setState has a guard (if this.state === state return)
                // so it won't reset the timer every frame anymore.
                this.pinComponent.setState(PinState.MOVING);

                this.pinComponent.position.set(currentPos.x, currentPos.y);
                this.pinComponent.zIndex = currentPos.y + 1000;

                this.onUpdatePinPosition.dispatch(currentPos.x, currentPos.y);
                this.targetPosition.set(-currentPos.x, -currentPos.y);
                this.checkButtonActivation(currentPos);
            }

            if (this.pathProgress >= 1) {
                this.isAnimatingPath = false;
                this.pinComponent?.setState(PinState.IDLE);
                this.drawSpline(this.controlPointsSorted);

                // Final check to enable the button we just landed on
                if (this.pinComponent) {
                    this.checkButtonActivation(this.pinComponent.position);
                }

                if (this.animationResolver) {
                    this.animationResolver();
                    this.animationResolver = null;
                }
            }
        } else {
            // Ensure that if we aren't animating, the pin knows it's idle
            this.pinComponent?.setState(PinState.IDLE);
        }

        if (this.pinComponent) {
            this.pinComponent.update(delta);
        }

        if (!this.isBeingDragged) {
            // Only run camera Lerp if the user isn't touching the screen
            const constrained = this.getConstrainedPosition(this.targetPosition.x, this.targetPosition.y);

            this.rootWorldContainer.x += (constrained.x - this.rootWorldContainer.x) * this.lerpSpeed;
            this.rootWorldContainer.y += (constrained.y - this.rootWorldContainer.y) * this.lerpSpeed;

            this.rootWorldContainer.x = Math.round(this.rootWorldContainer.x);
            this.rootWorldContainer.y = Math.round(this.rootWorldContainer.y);
        }


        if (this.pathRopeDone) {
            // Example: Move the "done" path texture slowly
            this.pathRopeDone.velocity = 0.5;
            this.pathRopeDone.update(delta);
        }

        if (this.pathRopeTodo) {
            // Maybe the "todo" path doesn't move, or moves differently
            //this.pathRopeTodo.velocity = 5;
            this.pathRopeTodo.update(delta);
        }

        if (this.showDebug) this.drawDebug();
    }



    public setCurrentLevelIndex(index: number): void {
        this.currentLevelIndex = index;
        this.isAnimatingPath = false;

        this.assigned.forEach((entry, i) => {
            if (i <= index) entry.button.enable();
            else entry.button.disable();
        });

        this.refreshAllButtons();
        // Ensure pin snaps to the new level immediately
        this.syncPinToCurrentLevel();

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

    public setViewport(width: number, height: number, anchorX: number, anchorY: number): void {
        this.viewportRect.width = width;
        this.viewportRect.height = height;
        this.viewportAnchor.set(anchorX, anchorY);
    }

    public setBoundaries(boundaries: WorldMapBoundary[]): void {
        // Basic check to avoid recalculating if the data is identical (by ID and count)
        const isSame = this.boundaries.length === boundaries.length &&
            this.boundaries.every((b, i) => b.id === boundaries[i].id);

        if (isSame) return;

        this.boundaries = boundaries;

        if (this.boundaries.length === 0) {
            this.combinedBounds = null;
            return;
        }

        // Calculate the total area covered by all boundary boxes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        this.boundaries.forEach(b => {
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        });

        this.combinedBounds = new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY);
    }
    private getConstrainedPosition(targetX: number, targetY: number): PIXI.Point {
        if (!this.combinedBounds) return new PIXI.Point(targetX, targetY);

        const bounds = this.combinedBounds;

        // 1. Calculate where the WORLD edges are relative to THIS container's (0,0)
        // When rootWorldContainer is at (0,0), the left edge is bounds.x
        // When rootWorldContainer is at (targetX), the left edge is targetX + bounds.x

        // We want: (ThisContainer.x + targetX + bounds.x) <= 0 (Screen Left)
        // And: (ThisContainer.x + targetX + bounds.x + bounds.width) >= ViewportWidth (Screen Right)

        // Solve for targetX:
        const maxAllowedX = -bounds.x - this.x;
        const minAllowedX = (this.viewportRect.width - (bounds.x + bounds.width)) - this.x;

        const maxAllowedY = -bounds.y - this.y;
        const minAllowedY = (this.viewportRect.height - (bounds.y + bounds.height)) - this.y;

        // 2. Apply the clamp
        let finalX = Math.max(minAllowedX, Math.min(maxAllowedX, targetX));
        let finalY = Math.max(minAllowedY, Math.min(maxAllowedY, targetY));

        // 3. Handle "Small Map" logic: If map is thinner than screen, center it
        if (bounds.width < this.viewportRect.width) {
            finalX = (this.viewportRect.width / 2) - (bounds.x + bounds.width / 2) - this.x;
        }
        // If map is shorter than screen, center it
        if (bounds.height < this.viewportRect.height) {
            finalY = (this.viewportRect.height / 2) - (bounds.y + bounds.height / 2) - this.y;
        }

        return new PIXI.Point(finalX, finalY);
    }

    private drawDebug(): void {
        this.debugGraphics.clear();

        // The Green Box: The World Boundaries
        // Since rootWorldContainer is a child of 'this', we draw its bounds relative to 'this'
        if (this.combinedBounds) {
            this.debugGraphics.lineStyle(4, 0x00ff00, 0.5);
            this.debugGraphics.drawRect(
                this.rootWorldContainer.x + this.combinedBounds.x,
                this.rootWorldContainer.y + this.combinedBounds.y,
                this.combinedBounds.width,
                this.combinedBounds.height
            );
        }

        // The Red Box: The Viewport (Screen)
        // The viewport starts at Screen(0,0). Since 'this' is at (this.x, this.y),
        // the screen's (0,0) relative to 'this' is (-this.x, -this.y)
        this.debugGraphics.lineStyle(2, 0xff0000, 1);
        this.debugGraphics.drawRect(
            -this.x,
            -this.y,
            this.viewportRect.width,
            this.viewportRect.height
        );

        // Blue Circle: The "Camera Lens" (where we want the level to be)
        // This is the anchor we passed in: (centerX, anchorY) -> relative to 'this' is (0,0)
        // this.debugGraphics.lineStyle(2, 0x0000ff);
        // this.debugGraphics.drawCircle(0, 0, 15);
    }
}