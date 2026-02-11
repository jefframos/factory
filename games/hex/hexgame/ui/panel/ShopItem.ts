import * as PIXI from "pixi.js";

export enum ShopItemState {
    NORMAL,
    ACTIVE,
    LOCKED
}

export class ShopItem extends PIXI.Container {
    private bg: PIXI.NineSlicePlane;
    private icon: PIXI.Sprite;
    private lockIcon: PIXI.Sprite | null = null;

    public readonly id: number; // Changed to number to match AvatarManager
    private _state: ShopItemState = ShopItemState.NORMAL;


    public getState(): ShopItemState {
        return this._state;
    }

    private readonly textures: {
        normal: PIXI.Texture,
        active: PIXI.Texture,
        locked: PIXI.Texture,
        lockIcon: PIXI.Texture
    };

    constructor(data: { id: string, texture: string }, size: number, textures: any) {
        super();
        this.id = data.id;
        this.textures = textures;

        // 1. Setup NineSlice Background
        // Assuming a 20px corner for the nineslice logic
        this.bg = new PIXI.NineSlicePlane(textures.normal, 20, 20, 20, 20);
        this.bg.width = size;
        this.bg.height = size;
        this.bg.pivot.set(size / 2, size / 2);
        this.addChild(this.bg);

        // 2. Main Item Icon
        this.icon = PIXI.Sprite.from(data.texture);
        this.icon.anchor.set(0.5);
        this.fitIcon(size * 0.7); // Occupy 70% of the space
        this.addChild(this.icon);

        this.interactive = true;
        this.cursor = 'pointer';
    }

    public setState(state: ShopItemState): void {
        this._state = state;

        // Reset effects
        this.icon.alpha = 1;
        this.icon.filters = [];

        switch (state) {
            case ShopItemState.NORMAL:
                this.bg.texture = this.textures.normal;
                this.showLock(false);
                break;
            case ShopItemState.ACTIVE:
                this.bg.texture = this.textures.active;
                this.showLock(false);
                break;
            case ShopItemState.LOCKED:
                this.bg.texture = this.textures.locked;
                this.icon.alpha = 0.5; // Dim the item icon
                this.showLock(true);
                break;
        }
    }

    private showLock(visible: boolean): void {
        if (visible && !this.lockIcon) {
            this.lockIcon = new PIXI.Sprite(this.textures.lockIcon);
            this.lockIcon.anchor.set(0.5);
            this.lockIcon.scale.set(0.5); // Adjust based on your asset size
            this.addChild(this.lockIcon);
        }
        if (this.lockIcon) this.lockIcon.visible = visible;
    }

    private fitIcon(maxSize: number): void {
        const aspect = this.icon.width / this.icon.height;
        if (aspect > 1) {
            this.icon.width = maxSize;
            this.icon.scale.y = this.icon.scale.x;
        } else {
            this.icon.height = maxSize;
            this.icon.scale.x = this.icon.scale.y;
        }
    }
}