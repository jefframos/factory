import * as PIXI from 'pixi.js';
import { LevelConfig } from '../../level/LevelTypes';
import { ColorPaletteService } from '../../services/ColorPaletteService';
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

            // Initial color resolution
            const initialColor = ColorPaletteService.resolveViewColor(obj.view3d || {}, obj.color || 0x7CFF01);
            this.applyTint(wrapper.view, initialColor);

            this.worldContainer.addChild(wrapper.view);
            this.spawnedWrappers.add(wrapper);
            this.onWrapperCreated?.(wrapper);
        });
    }

    public refreshColors(): void {
        for (const wrapper of this.spawnedWrappers) {
            const obj = wrapper.data; // Assuming wrapper stores the original object data
            const view = obj.view3d || {};

            // Resolve the color using our hierarchy logic
            const finalColor = ColorPaletteService.resolveViewColor(view, obj.color || 0x7CFF01);

            // Apply to PIXI view (recursive check in case the wrapper has multiple sprites)
            this.applyTint(wrapper.view, finalColor);
        }
    }
    private applyTint(displayObject: PIXI.DisplayObject, color: number): void {
        // If it's a container, check children
        if (displayObject instanceof PIXI.Container) {
            displayObject.children.forEach(child => this.applyTint(child, color));
        }

        // Apply tint to Sprites or Graphics
        if (displayObject instanceof PIXI.Sprite || displayObject instanceof PIXI.Graphics) {
            displayObject.tint = color;
        }
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