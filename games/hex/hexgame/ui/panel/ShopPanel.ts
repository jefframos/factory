import BaseButton from "@core/ui/BaseButton";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { AvatarManager } from "../../avatar/AvatarManager";
import { AvatarRegistry } from "../../avatar/AvatarRegistry";
import HexAssets from "../../HexAssets";
import { BasePanel } from "./BasePanel";

export class ShopPanel extends BasePanel {
    private gridContainer: PIXI.Container;
    private maskGraphic: PIXI.Graphics;
    private prevBtn!: BaseButton;
    private nextBtn!: BaseButton;

    private currentPage: number = 0;
    private readonly GRID_SIZE = 4;
    private readonly ITEM_SPACING = 110;
    private readonly ITEMS_PER_PAGE = 16; // 4x4

    constructor() {
        super(550, 700); // Adjusted size for 4x4
        this.setupPagination();
        this.buildGrid();
    }

    private setupPagination(): void {
        this.gridContainer = new PIXI.Container();
        this.content.addChild(this.gridContainer);

        // 1. Create Mask
        const maskW = this.GRID_SIZE * this.ITEM_SPACING;
        const maskH = this.GRID_SIZE * this.ITEM_SPACING;
        this.maskGraphic = new PIXI.Graphics();
        this.maskGraphic.beginFill(0xffffff);
        this.maskGraphic.drawRect(-maskW / 2, -maskH / 2, maskW, maskH);
        this.maskGraphic.endFill();
        this.content.addChild(this.maskGraphic);
        this.gridContainer.mask = this.maskGraphic;

        // 2. Navigation Buttons (Only if needed)
        const totalPages = Math.ceil(AvatarRegistry.AVATARS.length / this.ITEMS_PER_PAGE);

        if (totalPages > 1) {
            this.prevBtn = this.createNavBtn(HexAssets.Textures.Icons.Back, -220, () => this.changePage(-1));
            this.nextBtn = this.createNavBtn(HexAssets.Textures.Icons.Back, 220, () => this.changePage(1));
            this.nextBtn.scale.x *= -1; // Flip for "Next"
            this.updateNavButtons();
        }
    }

    // Inside ShopPanel...
    private buildGrid(): void {
        // The center of the content is 0,0. 
        // We calculate the offset so the 4x4 block sits around 0,0.
        const totalGridWidth = (this.GRID_SIZE - 1) * this.ITEM_SPACING;
        const startX = -totalGridWidth / 2;
        const startY = -totalGridWidth / 2;

        AvatarRegistry.AVATARS.forEach((data, i) => {
            const page = Math.floor(i / this.ITEMS_PER_PAGE);
            const indexInPage = i % this.ITEMS_PER_PAGE;
            const col = indexInPage % this.GRID_SIZE;
            const row = Math.floor(indexInPage / this.GRID_SIZE);

            const item = new PIXI.Container();
            const icon = PIXI.Sprite.from(data.texture);
            icon.anchor.set(0.5);
            icon.interactive = true;
            icon.on("pointertap", () => {
                AvatarManager.instance.setAvatar(data.id);
                //PanelManager.instance.closePanel();
            });

            // X = Start + Column + (Page offset)
            item.x = startX + (col * this.ITEM_SPACING) + (page * (this.GRID_SIZE * this.ITEM_SPACING));
            item.y = startY + (row * this.ITEM_SPACING);

            item.addChild(icon);
            this.gridContainer.addChild(item);
        });
    }
    private changePage(dir: number): void {
        const totalPages = Math.ceil(AvatarRegistry.AVATARS.length / this.ITEMS_PER_PAGE);
        const newPage = this.currentPage + dir;

        if (newPage >= 0 && newPage < totalPages) {
            this.currentPage = newPage;
            const targetX = -(this.currentPage * (this.GRID_SIZE * this.ITEM_SPACING));
            gsap.to(this.gridContainer, { x: targetX, duration: 0.4, ease: "power2.out" });
            this.updateNavButtons();
        }
    }

    private updateNavButtons(): void {
        const totalPages = Math.ceil(AvatarRegistry.AVATARS.length / this.ITEMS_PER_PAGE);
        if (this.prevBtn) this.prevBtn.visible = this.currentPage > 0;
        if (this.nextBtn) this.nextBtn.visible = this.currentPage < totalPages - 1;
    }

    private createNavBtn(tex: string, xPos: number, cb: () => void): BaseButton {
        const btn = new BaseButton({
            standard: { width: 60, height: 60, iconTexture: PIXI.Texture.from(tex) },
            click: { callback: cb }
        });
        btn.position.set(xPos, 0);
        this.content.addChild(btn);
        return btn;
    }
}