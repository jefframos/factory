import Physics from "@core/phyisics/Physics";
import { GameScene } from "@core/scene/GameScene";
import * as PIXI from 'pixi.js';
import { LevelDataManager, WorldDefinition } from "../level/LevelDataManager";
import { EntitySceneService } from "../services/EntitySceneService";
import { EditorDomUI } from "./EditorDomUI";
import { LevelEditorManager } from "./LevelEditorManager";
import { LevelPropertiesUI } from "./LevelPropertiesUI";
import { EditorCameraService } from "./service/EditorCameraService";
import { LevelEditorViewService } from "./service/LevelEditorViewService";
import { TransformGizmoService } from "./service/TransformGizmoService";

export default class LevelEditorScene extends GameScene {
    private worldContainer: PIXI.Container = new PIXI.Container();

    // Services
    private entityService!: EntitySceneService;
    private levelService!: LevelEditorViewService;
    private editorManager!: LevelEditorManager;

    // UIs
    private manifestUI!: EditorDomUI;
    private propsUI!: LevelPropertiesUI;

    // Selection State
    private currentWorldId: string = "";
    private currentLevelIdx: number = 0;

    private cameraService!: EditorCameraService;

    private readonly API_BASE = "http://localhost:3031/api";

    public async build(): Promise<void> {
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

        const gixmos = new TransformGizmoService(this.worldContainer)
        // 4. Initialize the Manager (The Brain)
        this.editorManager = new LevelEditorManager(
            this.levelService,
            this.propsUI,
            gixmos
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

        const worlds = LevelDataManager.instance.worlds;
        const worldsData: Record<string, any> = {};

        // Prepare payload for the server
        const manifest = {
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