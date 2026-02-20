import * as PIXI from 'pixi.js';
import { LevelDataManager } from "../level/LevelDataManager";
import { LevelConfig, LevelObject } from "../level/LevelTypes";
import { EditorEntityWrapper } from "./EditorEntityWrapper";
import { LevelPropertiesUI } from "./LevelPropertiesUI";
import { LevelEditorViewService } from "./service/LevelEditorViewService";
import { TransformGizmoService } from "./service/TransformGizmoService";

export class LevelEditorManager {
    private selectedObject: EditorEntityWrapper | null = null;
    constructor(
        private viewService: LevelEditorViewService,
        private propsUI: LevelPropertiesUI,
        private gizmo: TransformGizmoService
    ) {
        this.registerCallbacks();
    }

    private registerCallbacks(): void {
        this.viewService.onWrapperCreated = (wrapper) => {
            // Ensure this is 'pointerdown'
            wrapper.view.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
                this.selectObject(wrapper, e);
            });
        };

        this.gizmo.onTransformUpdate = (data) => {
            this.propsUI.showObjectProperties(data);
        };
        // Wire up the UI events directly to this manager's methods
        this.propsUI.onAddRandomBox = () => this.handleAddRandomBox();
        this.propsUI.onDeleteSelected = () => this.deleteCurrentObject();

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Ensure we aren't typing in an input field
                if (document.activeElement?.tagName !== 'INPUT') {
                    this.deleteCurrentObject();
                }
            }
        });
    }
    private selectObject(wrapper: EditorEntityWrapper, event: PIXI.FederatedPointerEvent) {
        this.selectedObject = wrapper;
        // CRITICAL: Pass 'event' here
        this.gizmo.select(wrapper, event);
        this.propsUI.showObjectProperties(wrapper.data);
    }
    private deleteCurrentObject() {
        if (!this.selectedObject) return;

        const config = this.viewService.getCurrentConfig();
        if (!config) return;

        // 1. Remove from the data array
        const index = config.objects.indexOf(this.selectedObject.data);
        if (index > -1) {
            config.objects.splice(index, 1);
            console.log("Deleted object from data array");
        }

        // 2. Cleanup visuals
        this.gizmo.select(null); // Hide gizmo
        this.propsUI.hide();     // Hide props panel

        // 3. Rebuild the visual level (simplest way to sync)
        this.viewService.buildLevel(config);

        this.selectedObject = null;
    }
    /**
     * Called by the Scene when a selection changes
     */
    public onLevelSelected(worldId: string, levelIdx: number): void {
        // Find world by ID from the manager
        const world = LevelDataManager.instance.worlds.find(w => w.id === worldId);
        const config = world?.levels?.[levelIdx];

        this.selectedObject = null;

        if (config) {
            this.loadLevel(config);
            this.propsUI.show(config.name, config.objects.length);
        } else {
            this.propsUI.hide();
        }
    }

    private handleAddRandomBox(): void {
        const config = this.viewService.getCurrentConfig();
        if (!config) return;

        const newBox: LevelObject = {
            type: 'box',
            x: Math.random() * 800,
            y: 0,
            width: 800,
            height: 40,
            isStatic: true,
            label: 'editor_box'
        };

        config.objects.push(newBox);
        this.viewService.buildLevel(config);
        this.propsUI.updateStats(config.objects.length);
    }

    public loadLevel(config: LevelConfig): void {
        this.patchMandatoryNodes(config);
        this.viewService.buildLevel(config);
    }

    private patchMandatoryNodes(config: LevelConfig): void {
        const hasStart = config.objects.some(o => o.label === 'start_node');
        const hasFinish = config.objects.some(o => o.label === 'finish_node');


        if (!hasStart) {
            config.objects.push({ type: 'sensor', x: 150, y: 0, width: 60, height: 200, label: 'start_node', debugColor: 0xFF2222 });
        }
        if (!hasFinish) {
            config.objects.push({ type: 'sensor', x: 500, y: 0, width: 60, height: 200, label: 'finish_node', debugColor: 0xFF22ff });
        }
    }
}