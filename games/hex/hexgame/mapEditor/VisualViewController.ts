import * as PIXI from "pixi.js";

export interface VisualImage {
    id: string;
    url: string;
    x: number;
    y: number;
    scaleX?: number;
    scaleY?: number;
}

export interface VisualLayer {
    id: string;
    name: string;
    index: number;
    visible: boolean;
    isBelowSpline: boolean;
    opacity: number;
    images: VisualImage[];
}

export class VisualViewController {
    private layerContainers: Map<string, PIXI.Container> = new Map();
    private layerDataRef: VisualLayer[] = [];

    constructor(
        private backgroundContainer: PIXI.Container,
        private splineContainer: PIXI.Container,
        private objectsContainer: PIXI.Container
    ) {
        this.backgroundContainer.label = "Root_Background";
        this.objectsContainer.label = "Root_Objects";
    }

    // --- CORE HIERARCHY MANAGEMENT ---

    public updateLayers(layers: VisualLayer[]) {
        this.layerDataRef = layers;

        for (const layer of layers) {
            let container = this.layerContainers.get(layer.id);

            if (!container) {
                container = new PIXI.Container();
                container.label = `Layer_${layer.name}`;
                this.layerContainers.set(layer.id, container);
            }

            container.visible = layer.visible;
            container.alpha = layer.opacity ?? 1;

            const targetRoot = layer.isBelowSpline ? this.backgroundContainer : this.objectsContainer;
            const sortedInBucket = this.getSortedLayersInBucket(layer.isBelowSpline);
            const internalIndex = sortedInBucket.findIndex(l => l.id === layer.id);

            this.ensureContainerAt(targetRoot, container, internalIndex);
        }
        this.sortAll();
    }

    private getSortedLayersInBucket(isBelow: boolean): VisualLayer[] {
        return this.layerDataRef
            .filter(l => !!l.isBelowSpline === isBelow)
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }

    private ensureContainerAt(parent: PIXI.Container, child: PIXI.Container, index: number): void {
        if (child.parent !== parent) parent.addChild(child);
        const currentIndex = parent.getChildIndex(child);
        const clamped = Math.max(0, Math.min(index, parent.children.length - 1));
        if (currentIndex !== clamped) parent.setChildIndex(child, clamped);
    }

    // --- IMAGE & LAYER CRUD ---

    public async addImageToLayer(layerId: string, url: string, worldX: number, worldY: number): Promise<VisualImage | null> {
        let layerInfo = this.layerDataRef.find(l => l.id === layerId);
        let container = this.layerContainers.get(layerId);

        if (!container || !layerInfo) return null;

        const imgData: VisualImage = {
            id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            url, x: worldX, y: worldY, scaleX: 1, scaleY: 1
        };

        layerInfo.images.push(imgData);
        const sprite = await this.createSprite(imgData);
        container.addChild(sprite);

        this.sortLayer(container, layerInfo);
        return imgData;
    }

    public removeLayer(layerId: string) {
        const container = this.layerContainers.get(layerId);
        if (container) {
            container.destroy({ children: true });
            this.layerContainers.delete(layerId);
        }
        this.layerDataRef = this.layerDataRef.filter(l => l.id !== layerId);
    }

    public removeImageFromLayer(layerId: string, imageId: string) {
        const container = this.layerContainers.get(layerId);
        const layerInfo = this.layerDataRef.find(l => l.id === layerId);
        if (!container || !layerInfo) return;

        layerInfo.images = layerInfo.images.filter(img => img.id !== imageId);
        const spriteToDelete = container.children.find(child => (child as any).imageId === imageId);

        if (spriteToDelete) {
            spriteToDelete.destroy();
        }
    }

    // --- TRANSFORMS & HELPERS ---

    public setImageScale(layerId: string, imageId: string, sx: number, sy: number): void {
        const layerInfo = this.layerDataRef.find(l => l.id === layerId);
        const container = this.layerContainers.get(layerId);
        if (!layerInfo || !container) return;

        const data = layerInfo.images.find(i => i.id === imageId);
        if (data) {
            data.scaleX = sx;
            data.scaleY = sy;
            const sprite = container.children.find(c => (c as any).imageId === imageId) as PIXI.Sprite;
            if (sprite) sprite.scale.set(sx, sy);
        }
    }

    public resetImageScale(layerId: string, imageId: string): void {
        this.setImageScale(layerId, imageId, 1, 1);
    }

    // --- HIT DETECTION ---

    public getSpriteAtGlobal(globalPos: PIXI.PointData): { sprite: PIXI.Sprite, layer: VisualLayer, data: VisualImage } | null {
        const searchOrder = [this.objectsContainer, this.backgroundContainer];
        for (const root of searchOrder) {
            for (let i = root.children.length - 1; i >= 0; i--) {
                const container = root.children[i] as PIXI.Container;
                if (!container.visible || container.alpha <= 0) continue;

                const layerId = Array.from(this.layerContainers.entries()).find(([_, c]) => c === container)?.[0];
                const layer = this.layerDataRef.find(l => l.id === layerId);
                if (!layer) continue;

                for (let j = container.children.length - 1; j >= 0; j--) {
                    const sprite = container.children[j] as PIXI.Sprite;
                    if (!sprite.visible || sprite.alpha <= 0) continue;

                    if (sprite.containsPoint(globalPos)) {
                        const data = layer.images.find(img => img.id === (sprite as any).imageId);
                        if (data) return { sprite, layer, data };
                    }
                }
            }
        }
        return null;
    }

    // --- INITIALIZATION & SORTING ---

    private async createSprite(data: VisualImage): Promise<PIXI.Sprite> {
        let texture: PIXI.Texture;

        if (PIXI.utils.TextureCache[data.url]) {
            texture = PIXI.utils.TextureCache[data.url];
        } else {
            //console.warn(`Loading texture asynchronously: ${data.url}`);
            // Assets.load is the modern (Pixi v7+) way to ensure the image is ready
            texture = await PIXI.Assets.load(data.url);
        }

        const sprite = new PIXI.Sprite(texture);
        (sprite as any).imageId = data.id;
        sprite.anchor.set(0.5, 1);
        sprite.position.set(data.x, data.y);
        sprite.scale.set(data.scaleX ?? 1, data.scaleY ?? 1);

        console.log(sprite.x, sprite.y, sprite.width, sprite.height);

        return sprite;
    }

    public async deserializeNoWipe(layers: VisualLayer[]) {
        this.updateLayers(layers);
        layers.forEach(layer => {
            const container = this.layerContainers.get(layer.id);
            if (!container) return;
            layer.images.forEach(async (img): Promise<void> => {
                const sprite = await this.createSprite(img);
                container.addChild(sprite)
                this.sortLayer(container, layer);
            });
        });
    }

    public deserialize(layers: VisualLayer[]) {
        this.layerContainers.forEach(c => c.destroy({ children: true }));
        this.layerContainers.clear();
        this.updateLayers(layers);
        layers.forEach(layer => {
            const container = this.layerContainers.get(layer.id);
            if (!container) return;
            layer.images.forEach(async (img): Promise<void> => {
                const sprite = await this.createSprite(img);
                container.addChild(sprite)
                this.sortLayer(container, layer);
            });
        });
    }

    private sortLayer(container: PIXI.Container, info: VisualLayer) {
        if (!info.isBelowSpline) {
            container.children.sort((a, b) => a.y - b.y);
        }
    }

    public sortAll() {
        this.layerDataRef.forEach(info => {
            const container = this.layerContainers.get(info.id);
            if (container) this.sortLayer(container, info);
        });
    }
}