import Physics from "@core/phyisics/Physics";
import { PhysicsBodyFactory } from "@core/phyisics/core/PhysicsBodyFactory";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from 'pixi.js';
import { LevelDataManager } from "../level/LevelDataManager";
import { WorldDefinition } from "../level/LevelTypes";
import { ColorPaletteService } from "../services/ColorPaletteService";
import { EntitySceneService } from "../services/EntitySceneService";
import { EditorDomUI } from "./EditorDomUI";
import { EditorToolbarUI } from "./EditorToolbarUI";
import { LevelEditorManager } from "./LevelEditorManager";
import { LevelPropertiesUI } from "./dom/LevelPropertiesUI";
import { EditorCameraService } from "./service/EditorCameraService";
import { LevelEditorViewService } from "./service/LevelEditorViewService";
import { PolygonEditorService } from "./service/PolygonEditorService";
import { TransformGizmoService } from "./service/TransformGizmoService";

export default class LevelEditorScene extends GameScene {
    private worldContainer: PIXI.Container = new PIXI.Container();

    // Services
    private entityService!: EntitySceneService;
    private levelService!: LevelEditorViewService;
    private editorManager!: LevelEditorManager;
    private toolbarUI!: EditorToolbarUI;


    // UIs
    private manifestUI!: EditorDomUI;
    private propsUI!: LevelPropertiesUI;

    // Selection State
    private currentWorldId: string = "";
    private currentLevelIdx: number = 0;

    private cameraService!: EditorCameraService;

    private readonly API_BASE = "http://localhost:3031/api";

    private async loadManifest(): Promise<any> {
        try {
            const res = await fetch(`${this.API_BASE}/load`);
            const data = await res.json();
            if (data.ok) {
                return data.manifest;
            }
        } catch (e) {
            console.error("Failed to load manifest from server:", e);
        }
        return null;
    }
    public async build(): Promise<void> {
        PhysicsBodyFactory.DEFAULT_DEBUG_COLOR = 0xFFFFFF
        PhysicsBodyFactory.FORCE_DEBUG_COLOR = true;
        const manifestData = await this.loadManifest();

        // FIXED: Use the new structure (palettes and activePaletteId)
        // We provide defaults (empty array and "Default") to prevent crashes
        if (manifestData) {
            ColorPaletteService.init(
                manifestData.palettes || [],
                manifestData.activePaletteId || "Default"
            );
        } else {
            // Fallback if server fails entirely
            ColorPaletteService.init([], "Default");
        }
        Physics.init({ gravity: { x: 0, y: 0.5 }, enableSleep: true });
        LevelDataManager.instance.init('game/worlds.json');
        this.addChild(this.worldContainer);

        this.cameraService = new EditorCameraService(this.worldContainer);
        // 1. Initialize Data from PIXI Cache (Source of Truth)
        // Ensure 'game/worlds.json' was preloaded in your loader scene

        // 2. Setup Physics & Entity Services
        this.entityService = new EntitySceneService(this.worldContainer);
        // We pass null to truck if we don't want the player spawned immediately in editor mode
        this.levelService = new LevelEditorViewService(this.worldContainer);

        // 3. Initialize DOM UIs
        this.manifestUI = new EditorDomUI();
        // We nest the Properties UI root inside the manifest UI root for shared z-indexing
        this.propsUI = new LevelPropertiesUI(this.manifestUI.root);
        this.toolbarUI = new EditorToolbarUI(this.manifestUI.root);

        this.toolbarUI.onPaletteChanged = () => {

            // 1. Force the 3D meshes to re-resolve their colors
            this.levelService.refreshColors();

            // 2. Force the Properties UI to rebuild its dropdowns
            // This ensures the new color ID shows up in the 'Palette ID' list immediately
            if (this.propsUI) {
                // this.propsUI.refreshCurrent();
            }
        };

        const gizmos = new TransformGizmoService(this.worldContainer)
        const polyEditor = new PolygonEditorService(this.worldContainer);
        // 4. Initialize the Manager (The Brain)
        this.editorManager = new LevelEditorManager(
            this.levelService,
            this.propsUI,
            this.toolbarUI,
            gizmos,
            polyEditor
        );

        // 5. Setup Event Listeners
        this.setupCallbacks();

        // 6. Initial Selection / Refresh
        if (LevelDataManager.instance.worlds.length > 0) {
            const firstWorld = LevelDataManager.instance.worlds[0];
            this.currentWorldId = firstWorld.id;
        }

        this.refresh();
        this.manifestUI.setStatus("Editor Ready", '#00d0ff');

        this.editorManager.onLevelSelected(this.currentWorldId, this.currentLevelIdx);
        this.refresh();
    }

    private setupCallbacks() {
        // --- Selection & Loading ---
        this.manifestUI.onSelectLevel = (worldId, idx) => {
            this.currentWorldId = worldId;
            this.currentLevelIdx = idx;
            this.cameraService.recenter();
            // Manager handles building the physics and showing the Props UI
            this.editorManager.onLevelSelected(worldId, idx);
            this.refresh();
        };

        // --- Create / Add ---
        this.manifestUI.onAddWorld = () => {
            const id = "world_" + Date.now();
            const newWorld: WorldDefinition = {
                id,
                name: "New World",
                icon: "icon_default",
                background: "bg_default",
                enabled: true,
                levelFile: `00_${id}.json`,
                customData: {},
                levels: []
            };
            LevelDataManager.instance.worlds.push(newWorld);
            this.currentWorldId = id;
            this.currentLevelIdx = 0;
            this.refresh();
        };

        this.manifestUI.onAddLevel = (worldId) => {
            const world = LevelDataManager.instance.worlds.find(w => w.id === worldId);
            if (!world) return;
            if (!world.levels) world.levels = [];

            world.levels.push({
                id: "lvl_" + Date.now(),
                name: "New Level",
                spawnPoint: { x: 0, y: 0 },
                objects: []
            });
            this.refresh();
        };

        // --- Reordering ---
        this.manifestUI.onMoveWorld = (worldId, dir) => {
            const worlds = LevelDataManager.instance.worlds;
            const idx = worlds.findIndex(w => w.id === worldId);
            const next = idx + dir;
            if (next < 0 || next >= worlds.length) return;

            [worlds[idx], worlds[next]] = [worlds[next], worlds[idx]];
            this.refresh();
        };

        this.manifestUI.onMoveLevel = (worldId, index, dir) => {
            const world = LevelDataManager.instance.worlds.find(w => w.id === worldId);
            if (!world || !world.levels) return;

            const next = index + dir;
            if (next < 0 || next >= world.levels.length) return;

            [world.levels[index], world.levels[next]] = [world.levels[next], world.levels[index]];

            // Sync selection if the moved level was the active one
            if (this.currentWorldId === worldId && this.currentLevelIdx === index) {
                this.currentLevelIdx = next;
            }
            this.refresh();
        };

        // --- Deletion ---
        this.manifestUI.onDeleteWorld = (worldId) => {
            const worlds = LevelDataManager.instance.worlds;
            const idx = worlds.findIndex(w => w.id === worldId);
            if (idx === -1) return;

            worlds.splice(idx, 1);
            if (this.currentWorldId === worldId) {
                this.currentWorldId = worlds[0]?.id || "";
                this.currentLevelIdx = 0;
                this.propsUI.hide();
            }
            this.refresh();
        };

        this.manifestUI.onDeleteLevel = (worldId, levelIdx) => {
            const world = LevelDataManager.instance.worlds.find(w => w.id === worldId);
            if (world && world.levels) {
                world.levels.splice(levelIdx, 1);
                if (this.currentWorldId === worldId && this.currentLevelIdx === levelIdx) {
                    this.currentLevelIdx = Math.max(0, levelIdx - 1);
                }
                this.refresh();
            }
        };

        // --- Persistence ---
        this.manifestUI.onSaveServer = () => this.handleSave();
    }

    private async handleSave() {
        this.manifestUI.setStatus("Saving...", 'rgba(35, 130, 199, 0.13)');

        this.editorManager.onSave();
        const worlds = LevelDataManager.instance.worlds;
        this.sanitizeLevelData(worlds);
        const worldsData: Record<string, any> = {};


        // Prepare payload for the server
        const manifest = {
            palettes: ColorPaletteService.getAllPalettes(),
            activePaletteId: ColorPaletteService.getActiveId(),
            worlds: worlds.map((w, index) => {
                const prefix = (index + 1).toString().padStart(2, '0');
                const fileName = `${prefix}_${w.id}.json`;

                // Collect level data for the separate file
                worldsData[fileName] = { id: w.id, levels: w.levels || [] };

                return {
                    id: w.id,
                    name: w.name,
                    icon: w.icon,
                    background: w.background,
                    enabled: w.enabled,
                    levelFile: fileName,
                    customData: w.customData
                };
            })
        };

        try {
            const res = await fetch(`${this.API_BASE}/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manifest, worldsData })
            });

            if (res.ok) {
                this.manifestUI.setStatus("Saved to Server ✅", '#48bc48');
            } else {
                this.manifestUI.setStatus("Save Failed ❌", '#d82b2b');
            }
        } catch (e) {
            this.manifestUI.setStatus("Server Offline", '#d82b2b');
        }
    }

    private sanitizeLevelData(worlds: WorldDefinition[]): void {
        worlds.forEach(world => {
            world.levels?.forEach(level => {
                level.objects.forEach(obj => {
                    // If view3d is missing, inject defaults
                    if (!obj.physics) {
                        obj.physics = {
                            isStatic: obj.isStatic !== undefined ? obj.isStatic : true,
                            isSensor: obj.isSensor !== undefined ? obj.isSensor : false,
                            mass: 1,
                            friction: 0.1,
                            restitution: 0.5,
                            density: 0.001
                        };
                    }
                    if (!obj.view3d) {
                        obj.view3d = {
                            color: obj.color || 0x7CFF01, // Fallback to old color property
                            colorSlot: 1,                 // Default to the first palette slot
                            isSmooth: true,
                            opacity: 1.0
                        };
                    }
                });
            });
        });
    }

    private refresh() {
        // Reconstruct the nested worldsData structure that the UI expects
        const worlds = LevelDataManager.instance.worlds;
        const worldsDataView: Record<string, any> = {};

        worlds.forEach(w => {
            worldsDataView[w.levelFile] = { levels: w.levels || [] };
        });

        this.manifestUI.refreshAccordion(
            { worlds },
            worldsDataView,
            this.currentWorldId,
            this.currentLevelIdx
        );
    }

    public update(delta: number): void {
        this.entityService?.update(delta);
        this.levelService?.update(delta);
    }

    public destroy() {
        this.manifestUI.destroy();
        this.entityService.destroy();
        super.destroy();
    }
}