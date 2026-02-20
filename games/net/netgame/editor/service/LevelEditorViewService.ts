import * as PIXI from 'pixi.js';
import { LevelConfig } from '../../level/LevelTypes';
import { EditorEntityWrapper } from '../EditorEntityWrapper';

export class LevelEditorViewService {
    private spawnedWrappers: Set<EditorEntityWrapper> = new Set();
    private currentConfig: LevelConfig | null = null;
    private worldContainer: PIXI.Container;

    public onWrapperCreated?: (wrapper: EditorEntityWrapper) => void;

    constructor(container: PIXI.Container) {
        this.worldContainer = container;
    }

    /**
     * Renders the level visually without initializing any physics.
     */
    public buildLevel(config: LevelConfig): void {
        this.clear();
        this.currentConfig = config;

        config.objects.forEach(obj => {
            const wrapper = new EditorEntityWrapper(obj);
            this.worldContainer.addChild(wrapper.view);
            this.spawnedWrappers.add(wrapper);
            this.onWrapperCreated?.(wrapper);
        });

        console.log(`[EditorView] Rendered ${config.objects.length} visual objects.`);
    }

    public update(): void {
        for (const wrapper of this.spawnedWrappers) {
            wrapper.update();
        }
    }

    public getCurrentConfig(): LevelConfig | null {
        return this.currentConfig;
    }

    public clear(): void {
        this.spawnedWrappers.forEach(wrapper => {
            wrapper.destroy();
        });
        this.spawnedWrappers.clear();
    }

    public destroy(): void {
        this.clear();
        this.currentConfig = null;
    }
}