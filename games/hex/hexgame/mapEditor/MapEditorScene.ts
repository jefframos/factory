import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import PatternBackground from "@core/ui/PatternBackground";
import * as PIXI from "pixi.js";
import { AssetBrowser } from "./AssetBrowser";
import { BoundaryController } from "./BoundaryController";
import { MapBoundaryLogic } from "./MapBoundaryLogic";
import { MapEditorDomUI } from "./MapEditorDomUI";
import { Point, SplineUtils } from "./SplineUtils";
import { VisualEditorLogic, VisualLayer } from "./VisualEditorLogic";
import { VisualImage, VisualViewController } from "./VisualViewController";

const API_BASE = "http://localhost:3031";
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.0;
const ZOOM_SPEED = 0.1;

interface LevelPoint {
    id: string;
    x: number;
    y: number;
    order: number;
}

interface MapMeta {
    lastTab: "map" | "visual";
    cameraX: number;
    cameraY: number;
    zoom: number;
}
interface WorldBoundary {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface MapData {
    points: LevelPoint[];
    visuals: {
        layers: VisualLayer[];
    };
    worldBoundaries: WorldBoundary[];
}
const STORAGE_KEY = "map_editor_meta";
export default class MapEditorScene extends GameScene {
    private patternBackground?: PatternBackground;
    private ui?: MapEditorDomUI;
    private isMiddleClickPanning: boolean = false;
    // Containers
    private worldContainer: PIXI.Container = new PIXI.Container();
    private splineContainer: PIXI.Container = new PIXI.Container();
    private pointsContainer: PIXI.Container = new PIXI.Container();
    private visualEditor?: VisualEditorLogic;
    private currentMode: "map" | "visual" = "map";
    // Map data
    private layers: VisualLayer[] = [];
    private levelPoints: LevelPoint[] = [];
    private pointGraphics: Map<string, PIXI.Graphics> = new Map();
    private splineRope?: PIXI.SimpleRope;

    // Interaction state
    private isLevelEditMode: boolean = false;
    private draggedPoint: LevelPoint | null = null;
    private isPanning: boolean = false;
    private lastPanPosition: PIXI.Point = new PIXI.Point();

    private splineGraphics: PIXI.Graphics = new PIXI.Graphics();

    // Camera
    private cameraZoom: number = 1.0;
    private cameraPosition: PIXI.Point = new PIXI.Point(0, 0);
    private isDeleteMode: boolean = false;
    // Input tracking
    private visualController!: VisualViewController;
    private assetBrowser!: AssetBrowser;
    private activeLayerId: string | null = null;
    private keysPressed: Set<string> = new Set();
    private selectedSpriteData: { sprite: PIXI.Sprite, layer: VisualLayer, data: VisualImage } | null = null;
    private latestSelectedSpriteData: { sprite: PIXI.Sprite, layer: VisualLayer, data: VisualImage } | null = null;
    private spriteDragOffset: PIXI.Point = new PIXI.Point();

    private boundaryLogic!: MapBoundaryLogic;
    private boundaryController!: BoundaryController;
    private worldBoundaries: any[] = [];

    public build(): void {
        // Background
        this.patternBackground = new PatternBackground({
            background: 0x1a1a1a,
            patternAlpha: 0.3,
            tileSpeedX: 0,
            tileSpeedY: 0
        });
        this.addChild(this.patternBackground);
        this.patternBackground.init();

        this.setupWorldHitArea()

        // World container (this will be zoomed and panned)
        this.addChild(this.worldContainer);
        this.worldContainer.addChild(this.splineContainer);
        this.worldContainer.addChild(this.pointsContainer);

        this.splineContainer.addChild(this.splineGraphics);
        // Center the world container
        this.worldContainer.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2);

        // Setup UI
        this.setupDomUI();

        // Setup interactions
        this.setupInteractions();

        this.visualController = new VisualViewController(this.worldContainer, this.splineContainer, this.pointsContainer);

        this.assetBrowser = new AssetBrowser();
        this.assetBrowser.setVisible(false);

        this.setupDropZone();

        this.boundaryController = new BoundaryController(this.worldContainer);
        this.boundaryLogic = new MapBoundaryLogic(this.ui!.root);

        this.boundaryLogic.onBoundariesChanged = (data) => {
            this.worldBoundaries = data; // Keep local ref
            this.boundaryController.render(data, (id, updates) => {
                this.boundaryLogic.updateBoundary(id, updates);
            });
        };

        // Load map data
        void this.loadMapData();
    }
    // Inside MapEditorScene.ts -> build()
    private setupWorldHitArea() {
        const hitArea = new PIXI.Graphics();
        // Create a massive rectangle (e.g., 20k pixels) to cover any panning
        hitArea.beginFill(0x000000, 0); // Completely transparent
        hitArea.drawRect(-10000, -10000, 20000, 20000);
        hitArea.endFill();

        hitArea.eventMode = 'static';
        // Ensure this is at the very bottom of the world container
        this.worldContainer.addChildAt(hitArea, 0);
    }
    // Inside MapEditorScene.ts -> setupDropZone()
    private setupDropZone() {
        window.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = "copy";
        });

        window.addEventListener("drop", (e: DragEvent) => {
            if (this.currentMode !== "visual" || !this.activeLayerId) return;
            e.preventDefault();

            const url = e.dataTransfer?.getData("text/plain");
            if (!url) return;

            const app = this.game.app;

            // 1) DOM client coords -> PIXI global coords (renderer space)
            const global = new PIXI.Point();

            // Pixi v7:
            const eventsAny = (app.renderer as any).events;
            if (eventsAny?.mapPositionToPoint) {
                eventsAny.mapPositionToPoint(global, e.clientX, e.clientY);
            } else {
                // Pixi v6 fallback:
                const interaction = (app.renderer as any).plugins?.interaction;
                if (interaction?.mapPositionToPoint) {
                    interaction.mapPositionToPoint(global, e.clientX, e.clientY);
                } else {
                    // last resort: manual mapping (better than nothing)
                    const canvas = app.view as HTMLCanvasElement;
                    const rect = canvas.getBoundingClientRect();
                    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
                    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
                    global.set(x, y);
                }
            }

            // 2) Global -> worldContainer local
            // IMPORTANT: pass the correct "from" container (stage is safest)
            const worldPos = this.worldContainer.toLocal(global, app.stage);

            this.visualController.addImageToLayer(this.activeLayerId, url, worldPos.x, worldPos.y);
            this.visualEditor?.renderLayers();
        });
    }

    private setupDomUI(): void {
        this.ui = new MapEditorDomUI();

        this.ui.onTypeChanged = async (newType) => {
            if (!this.latestSelectedSpriteData) return;
            const { layer, data, sprite } = this.latestSelectedSpriteData;

            // 1. Update the data type
            data.type = newType;
            if (newType !== "sprite") {
                data.width = data.width || 100;
                data.height = data.height || 100;
            }

            // 2. Remove old sprite from PIXI
            const container = sprite.parent as PIXI.Container;
            sprite.destroy();

            // 3. Create the new correct PIXI object using your controller
            // Note: You'll need to expose a method or use deserialize to refresh
            const newSprite = await (this.visualController as any).createSprite(data);
            container.addChild(newSprite);

            // 4. Update the reference
            this.latestSelectedSpriteData.sprite = newSprite;
        };

        this.ui.onSizeChanged = (w, h) => {
            if (!this.latestSelectedSpriteData) return;
            const { sprite, data } = this.latestSelectedSpriteData;

            if (w !== null) { data.width = w; sprite.width = w; }
            if (h !== null) { data.height = h; sprite.height = h; }
        };

        this.ui.onToggleBoundaries = (enabled) => {
            this.boundaryLogic.setEnabled(enabled);
            this.boundaryController.setVisible(enabled);

            // If enabled and empty, create a default box
            if (enabled && this.worldBoundaries.length === 0) {
                this.boundaryLogic.setData([{ id: 'init', x: -500, y: -500, width: 1000, height: 1000 }]);
                this.boundaryLogic.onBoundariesChanged!(this.worldBoundaries);
            }
        };
        this.ui.onSelectedScaleChanged = (scale) => {
            if (!this.latestSelectedSpriteData) return;

            const { layer, data, sprite } = this.latestSelectedSpriteData;
            // Apply immediately
            sprite.scale.set(scale, scale);

            // Persist
            data.scaleX = scale;
            data.scaleY = scale;

            // Optional: if you want a single source of truth, call controller helper instead:
            this.visualController.setImageScale(layer.id, data.id, scale, scale);

            //void this.saveMapData();
        };

        this.ui.onResetSelectedScale = () => {
            if (!this.latestSelectedSpriteData) return;

            const { layer, data, sprite } = this.latestSelectedSpriteData;

            sprite.scale.set(1, 1);
            data.scaleX = 1;
            data.scaleY = 1;

            //void this.saveMapData();
        };


        this.visualEditor = new VisualEditorLogic(this.ui.getVisualHUDParent());
        this.visualEditor.onSaveRequested = (layers) => {
            this.layers = layers;
            void this.saveMapData();
        };
        this.visualEditor.onLayerDeleted = (id: string) => {
            // 1. Clean up PIXI visuals
            this.visualController.removeLayer(id);

            // 2. Clear active layer if it was the one deleted
            if (this.activeLayerId === id) {
                this.activeLayerId = this.layers.length > 0 ? this.layers[this.layers.length - 1].id : null;
            }

            // 3. Save the new state
            void this.saveMapData();
        };
        this.visualEditor.onLayerSelected = (id) => {
            this.activeLayerId = id;
        };

        this.visualEditor.onLayersChanged = (layers) => {
            this.layers = layers;
            this.visualController.updateLayers(this.layers);
            void this.saveMapData();
        };
        this.visualEditor.onImageDelete = (layerId: string, imageId: string) => {
            // This connects the UI "X" click to the PIXI engine removal
            this.visualController.removeImageFromLayer(layerId, imageId);
            console.log(`Deleted image ${imageId} from layer ${layerId}`);
        };

        this.ui.onMoveSelectedImage = (direction) => {
            // We need a selected sprite and its associated layer/data
            if (!this.latestSelectedSpriteData) return;

            const { layer, data } = this.latestSelectedSpriteData;
            const imageList = layer.images;
            const currentIndex = imageList.findIndex(img => img.id === data.id);

            if (currentIndex === -1) return;

            let targetIndex = currentIndex;

            if (direction === "up") {
                // "Up" in visual terms means moving it towards the end of the array (drawn last)
                if (currentIndex < imageList.length - 1) {
                    targetIndex = currentIndex + 1;
                }
            } else if (direction === "down") {
                // "Down" means moving it towards the start of the array (drawn first)
                if (currentIndex > 0) {
                    targetIndex = currentIndex - 1;
                }
            } else if (direction === "top") {
                targetIndex = imageList.length - 1;
            } else if (direction === "bottom") {
                targetIndex = 0;
            }

            if (targetIndex !== currentIndex) {
                // 1. Swap/Move in the data array
                const [movedItem] = imageList.splice(currentIndex, 1);
                imageList.splice(targetIndex, 0, movedItem);

                // 2. Refresh the PIXI containers to reflect the new array order
                // We use deserialize to force a full re-ordering of children inside the containers
                this.visualController.deserialize(this.layers);

                // 3. Re-sync the selection reference 
                // After deserialize, the PIXI.Sprite instance changes, so we find the new one
                // const hit = this.visualController.getSpriteAtGlobal(this.lastMouseGlobal || { x: 0, y: 0 });
                // if (hit) this.latestSelectedSpriteData = hit;

                console.log(`Moved image ${data.id} to index ${targetIndex}`);

                // Optional: Auto-save if desired
                // void this.saveMapData();
            }
        };
        this.ui.onModeChange = (mode) => {
            this.currentMode = mode;
            this.assetBrowser.setVisible(mode === "visual");
            if (mode === "visual") {
                // Force exit edit mode when leaving map editor
                this.isLevelEditMode = false;
                this.ui!.levelEditToggle.checked = false;
                console.log("Entered Visual Editor");
            }
        };
        this.ui.onLayerSelected = (id: string) => {
            this.activeLayerId = id;
        };
        this.ui.onToggleLevelEdit = (enabled) => {
            if (this.currentMode !== "map") return;
            this.isLevelEditMode = enabled;
        };

        this.ui.onToggleDeleteMode = (enabled) => {
            this.isDeleteMode = enabled;
        }; if (this.isLevelEditMode) {
            const clickedPoint = this.getPointAtPosition(worldPos.x, worldPos.y);

            if (clickedPoint) {
                if (this.isDeleteMode) {
                    // DELETE LOGIC
                    this.deleteLevelPoint(clickedPoint.id);
                } else {
                    // DRAG LOGIC
                    this.draggedPoint = clickedPoint;
                }
                return;
            }
        }
        this.ui.onToggleLevelEdit = (enabled) => {
            this.isLevelEditMode = enabled;
            console.log("Level Edit Mode:", enabled);
        };

        this.ui.onSaveMap = () => {
            void this.saveMapData();
        };
    }

    private setupInteractions(): void {
        // Make the stage interactive
        this.eventMode = "static";
        this.hitArea = new PIXI.Rectangle(-100000, -100000, 200000, 200000);

        // Mouse/pointer events
        this.on("pointertap", this.onPointerTap, this);
        this.on("pointerdown", this.onPointerDown, this);
        this.on("pointermove", this.onPointerMove, this);
        this.on("pointerup", this.onPointerUp, this);
        this.on("pointerupoutside", this.onPointerUp, this);
        this.on("wheel", this.onWheel, this);

        // Keyboard events
        window.addEventListener("keydown", this.onKeyDown.bind(this));
        window.addEventListener("keyup", this.onKeyUp.bind(this));
    }
    private onPointerTap(event: PIXI.FederatedPointerEvent): void {
        if (!this.isLevelEditMode || event.detail !== 2 || event.button !== 0) return;

        const worldPos = this.screenToWorld(event.global);
        const existingPoint = this.getPointAtPosition(worldPos.x, worldPos.y);
        if (existingPoint) return;

        // 1. Try to find if we clicked near the spline
        const threshold = 15; // How close to the line you must click
        let bestDist = Infinity;
        let insertIndex = -1;

        // We check segments between consecutive sorted points
        const sorted = [...this.levelPoints].sort((a, b) => a.order - b.order);

        for (let i = 0; i < sorted.length - 1; i++) {
            const p1 = sorted[i];
            const p2 = sorted[i + 1];

            // Check distance to the straight-line segment between control points
            // (This is a simplified check; for high precision you'd check spline points)
            const result = SplineUtils.staticgetDistanceToSegment(worldPos, p1, p2);

            if (result.dist < threshold && result.dist < bestDist) {
                bestDist = result.dist;
                insertIndex = i + 1; // Insert after p1
            }
        }

        if (insertIndex !== -1) {
            this.insertLevelPoint(worldPos.x, worldPos.y, insertIndex);
        } else {
            // Fallback: Just add to the end if not near the spline
            this.addLevelPoint(worldPos.x, worldPos.y);
        }
    }
    private insertLevelPoint(x: number, y: number, index: number): void {
        const id = `point_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Shift the order of points that come after the insertion index
        this.levelPoints.forEach(p => {
            if (p.order >= index) p.order++;
        });

        const newPoint: LevelPoint = { id, x, y, order: index };
        this.levelPoints.push(newPoint);

        // Refresh everything
        this.createPointGraphics(newPoint);
        this.levelPoints.forEach(p => this.updatePointGraphics(p));
        this.updateSpline();
    }

    private onKeyDown(e: KeyboardEvent): void {
        this.keysPressed.add(e.key.toLowerCase());
    }

    private onKeyUp(e: KeyboardEvent): void {
        this.keysPressed.delete(e.key.toLowerCase());
    }

    private isKeyPressed(key: string): boolean {
        return this.keysPressed.has(key.toLowerCase());
    }

    private onPointerDown(event: PIXI.FederatedPointerEvent): void {
        const worldPos = this.screenToWorld(event.global);

        // 1. Middle Mouse Button (Scroll Wheel) for panning


        if (this.currentMode === "visual" && event.button === 0) {
            const hit = this.visualController.getSpriteAtGlobal(event.global);

            if (hit) {
                this.selectedSpriteData = hit;
                this.latestSelectedSpriteData = hit;
                const sx = hit.data.scaleX ?? 1;
                this.ui?.setSelectedSpriteScale(sx);
                // Use WORLD coords for dragging (so drag works under zoom/pan)
                const worldPos = this.worldContainer.toLocal(event.global);

                this.spriteDragOffset.set(
                    hit.sprite.x - worldPos.x,
                    hit.sprite.y - worldPos.y
                );

                this.activeLayerId = hit.layer.id;
                this.ui?.setActiveLayerUI(hit.layer.id);
                return;
            } else {
                this.latestSelectedSpriteData = null;
                this.ui?.setSelectedSpriteScale(null);

            }
        }
        if (event.button === 1) {
            this.isMiddleClickPanning = true;
            this.lastPanPosition.copyFrom(event.global);
            return;
        }
        // 2. Dragging points (Edit mode + Left Click)
        if (this.isLevelEditMode && event.button === 0) {
            const clickedPoint = this.getPointAtPosition(worldPos.x, worldPos.y);
            if (clickedPoint) {
                if (this.isDeleteMode) {
                    // DELETE LOGIC
                    console.log("Deleting point:", clickedPoint.id);
                    this.deleteLevelPoint(clickedPoint.id);
                } else {
                    // DRAG LOGIC
                    this.draggedPoint = clickedPoint;
                }
                return;
            }
        }

    }

    private onPointerMove(event: PIXI.FederatedPointerEvent): void {
        const worldPos = this.screenToWorld(event.global);
        this.ui?.updateCoordinates(worldPos.x, worldPos.y, this.cameraZoom);
        if (this.selectedSpriteData) {
            const { sprite, data, layer } = this.selectedSpriteData;

            sprite.x = worldPos.x + this.spriteDragOffset.x;
            sprite.y = worldPos.y + this.spriteDragOffset.y;

            // Sync to raw data for saving
            data.x = sprite.x;
            data.y = sprite.y;

            // Sort if foreground
            if (!layer.isBelowSpline) {
                sprite.parent.children.sort((a, b) => a.y - b.y);
            }
            return;
        }
        // Updated Panning Logic
        if (this.isPanning || this.isMiddleClickPanning) {
            const dx = event.global.x - this.lastPanPosition.x;
            const dy = event.global.y - this.lastPanPosition.y;

            this.cameraPosition.x += dx;
            this.cameraPosition.y += dy;

            this.lastPanPosition.copyFrom(event.global);
            this.updateCamera();
            return;
        }

        // Handle point dragging
        if (this.draggedPoint && this.isLevelEditMode) {
            this.draggedPoint.x = worldPos.x;
            this.draggedPoint.y = worldPos.y;
            this.updatePointGraphics(this.draggedPoint);
            this.updateSpline();
        }
    }

    private onPointerUp(event: PIXI.FederatedPointerEvent): void {
        if (event.button === 1) this.isMiddleClickPanning = false;
        this.isPanning = false;
        this.draggedPoint = null;
        this.selectedSpriteData = null;
    }

    private onWheel(event: PIXI.FederatedWheelEvent): void {
        const delta = event.deltaY > 0 ? -ZOOM_SPEED : ZOOM_SPEED;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.cameraZoom + delta));
        if (newZoom === this.cameraZoom) return;

        // 1) world point under cursor BEFORE zoom
        const worldBefore = this.worldContainer.toLocal(event.global);

        // 2) apply zoom
        this.cameraZoom = newZoom;
        this.worldContainer.scale.set(this.cameraZoom);

        // 3) screen position of that SAME world point AFTER zoom
        const screenAfter = this.worldContainer.toGlobal(worldBefore);

        // 4) shift camera so cursor stays on the same content
        const dx = event.global.x - screenAfter.x;
        const dy = event.global.y - screenAfter.y;

        this.cameraPosition.x += dx;
        this.cameraPosition.y += dy;

        this.updateCamera();
    }


    private screenToWorld(screenPos: PIXI.IPointData): PIXI.Point {
        // This maps a global (screen) point directly to the local space 
        // of the container that holds your points.
        return this.worldContainer.toLocal(screenPos);
    }

    private updateCamera(): void {
        this.worldContainer.scale.set(this.cameraZoom);
        this.worldContainer.position.set(
            Game.DESIGN_WIDTH / 2 + this.cameraPosition.x,
            Game.DESIGN_HEIGHT / 2 + this.cameraPosition.y
        );
    }

    private addLevelPoint(x: number, y: number): void {
        const id = `point_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const order = this.levelPoints.length;

        const point: LevelPoint = { id, x, y, order };
        this.levelPoints.push(point);

        this.createPointGraphics(point);
        this.updateSpline();

        console.log(`Added point at (${Math.round(x)}, ${Math.round(y)})`);
    }

    private createPointGraphics(point: LevelPoint): void {
        const g = new PIXI.Graphics();
        g.eventMode = "static";
        g.cursor = "pointer";

        // Draw the point
        this.renderPoint(g, point);

        // Add click handler for deletion (right-click)
        g.on("rightclick", (e: PIXI.FederatedPointerEvent) => {
            e.stopPropagation();
            this.deleteLevelPoint(point.id);
        });

        this.pointGraphics.set(point.id, g);
        this.pointsContainer.addChild(g);
    }

    private renderPoint(g: PIXI.Graphics, point: LevelPoint): void {
        g.clear();
        g.position.set(point.x, point.y);

        // Outer circle (white border)
        g.beginFill(0xffffff);
        g.drawCircle(0, 0, 18);
        g.endFill();

        // Inner circle (colored)
        g.beginFill(0x4CAF50);
        g.drawCircle(0, 0, 15);
        g.endFill();

        // Order number
        const text = new PIXI.Text(String(point.order + 1), {
            fontSize: 12,
            fill: 0xffffff,
            fontWeight: "bold"
        });
        text.anchor.set(0.5);
        g.addChild(text);
    }

    private updatePointGraphics(point: LevelPoint): void {
        const g = this.pointGraphics.get(point.id);
        if (g) {
            this.renderPoint(g, point);
        }
    }

    private deleteLevelPoint(id: string): void {
        // Remove from array
        const index = this.levelPoints.findIndex(p => p.id === id);
        if (index === -1) return;

        this.levelPoints.splice(index, 1);

        // Re-assign order numbers
        this.levelPoints.forEach((p, i) => {
            p.order = i;
        });

        // Remove graphics
        const g = this.pointGraphics.get(id);
        if (g) {
            g.destroy();
            this.pointGraphics.delete(id);
        }

        // Update remaining point graphics to show new order numbers
        this.levelPoints.forEach(p => this.updatePointGraphics(p));

        // Update spline
        this.updateSpline();

        console.log(`Deleted point ${id}`);
    }

    private getPointAtPosition(x: number, y: number, radius: number = 20): LevelPoint | null {
        for (const point of this.levelPoints) {
            const dx = point.x - x;
            const dy = point.y - y;
            const distSq = dx * dx + dy * dy;

            if (distSq <= radius * radius) {
                return point;
            }
        }
        return null;
    }

    private updateSpline(): void {
        this.splineGraphics.clear();

        if (this.levelPoints.length < 2) return;

        const sortedPoints = [...this.levelPoints].sort((a, b) => a.order - b.order);
        const controlPoints: Point[] = sortedPoints.map(p => ({ x: p.x, y: p.y }));

        // Increase resolution (e.g., 50) for smoother curves
        const splinePoints = SplineUtils.generateCatmullRomSpline(controlPoints, 50, 0.5);

        this.splineGraphics.lineStyle(8, 0x2196F3, 0.6);
        this.splineGraphics.moveTo(splinePoints[0].x, splinePoints[0].y);

        for (let i = 1; i < splinePoints.length; i++) {
            this.splineGraphics.lineTo(splinePoints[i].x, splinePoints[i].y);
        }
    }

    private async loadMapData(): Promise<void> {
        try {
            this.ui?.setServerStatus("Loading...", true);

            const response = await fetch(`${API_BASE}/api/loadMap`);
            const result = await response.json();

            if (result.ok && result.data) {
                const mapData: MapData = result.data;
                this.levelPoints = mapData.points || [];
                this.layers = mapData.visuals?.layers || [];
                this.visualEditor?.setData(this.layers);

                this.visualController.updateLayers(this.layers);

                // 3. Render the existing images from the data
                this.visualController.deserialize(this.layers);

                this.worldBoundaries = result.data.worldBoundaries || [];
                this.boundaryLogic.setData(this.worldBoundaries);
                // and trigger the initial render
                this.boundaryLogic.onBoundariesChanged?.(this.worldBoundaries);

                // Create graphics for all points
                this.levelPoints.forEach(point => {
                    this.createPointGraphics(point);
                });

                // Update spline
                this.updateSpline();

                const savedMeta = localStorage.getItem(STORAGE_KEY);
                if (savedMeta) {
                    const meta: MapMeta = JSON.parse(savedMeta);

                    this.cameraPosition.set(meta.cameraX, meta.cameraY);
                    this.cameraZoom = meta.zoom || 1.0;

                    if (meta.lastTab) {
                        this.currentMode = meta.lastTab;
                        this.ui?.setTab(meta.lastTab);

                        this.assetBrowser.setVisible(meta.lastTab === "visual");
                    }
                }

                this.updateCamera();

                this.ui?.setServerStatus(`Loaded ${this.levelPoints.length} points`, true);
                console.log("Map loaded:", this.levelPoints.length, "points");
            } else {
                // No map data, start fresh
                this.ui?.setServerStatus("New map (no data found)", true);
                console.log("No existing map data, starting fresh");
            }
        } catch (err) {
            this.ui?.setServerStatus("Server connection failed", false);
            console.error("Failed to load map:", err);
        }
    }

    private async saveMapData(): Promise<void> {
        try {
            this.ui?.setServerStatus("Saving...", true);

            const mapData = {
                points: this.levelPoints,
                visuals: {
                    layers: this.layers // Save the layer stack here
                },
                worldBoundaries: this.worldBoundaries
            };

            const response = await fetch(`${API_BASE}/api/saveMap`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: mapData })
            });


            const meta: MapMeta = {
                lastTab: this.currentMode,
                cameraX: this.cameraPosition.x,
                cameraY: this.cameraPosition.y,
                zoom: this.cameraZoom
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));

            const result = await response.json();

            if (result.ok) {
                this.ui?.setServerStatus(`Saved ${this.levelPoints.length} points ✅`, true);
                console.log("Map saved successfully");
            } else {
                this.ui?.setServerStatus("Save failed ❌", false);
                console.error("Save failed:", result.error);
            }
        } catch (err) {
            this.ui?.setServerStatus("Server connection failed", false);
            console.error("Failed to save map:", err);
        }
    }

    public update(delta: number): void {
        this.patternBackground?.update(delta);

        const centerX = Game.DESIGN_WIDTH / 2;
        const centerY = Game.DESIGN_HEIGHT / 2;
        this.patternBackground?.position?.set(centerX, centerY);
    }

    public destroy(): void {
        window.removeEventListener("keydown", this.onKeyDown.bind(this));
        window.removeEventListener("keyup", this.onKeyUp.bind(this));

        this.ui?.destroy();
        this.pointGraphics.forEach(g => g.destroy());
        this.pointGraphics.clear();

        super.destroy();
    }
}
