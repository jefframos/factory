import BaseButton from "@core/ui/BaseButton";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { AvatarManager } from "../../avatar/AvatarManager";
import { AvatarRegistry } from "../../avatar/AvatarRegistry";
import HexAssets from "../../HexAssets";
import { BasePanel } from "./BasePanel";
import { ShopItem, ShopItemState } from "./ShopItem";

export class AvatarShopPanel extends BasePanel {
    private gridContainer: PIXI.Container;
    private maskGraphic: PIXI.Graphics;
    private prevBtn!: BaseButton;
    private nextBtn!: BaseButton;

    // Tracking array to update states without rebuilding the grid
    private items: ShopItem[] = [];

    private currentPage: number = 0;
    private readonly GRID_SIZE = 4;
    private readonly ITEM_SPACING = 110;
    private readonly ITEMS_PER_PAGE = 16; // 4x4
    private readonly ITEM_SIZE = 100;

    constructor() {
        super(550, 700);
        this.setupPagination();
        this.buildGrid();
    }

    /**
     * Sets up the container, masking for scrolling, and navigation buttons.
     */
    private setupPagination(): void {
        this.gridContainer = new PIXI.Container();
        this.content.addChild(this.gridContainer);

        // Calculate mask size based on grid spacing
        const maskSize = this.GRID_SIZE * this.ITEM_SPACING;

        this.maskGraphic = new PIXI.Graphics();
        this.maskGraphic.beginFill(0xffffff);
        // Center the mask at 0,0 relative to the content area
        this.maskGraphic.drawRect(-maskSize / 2, -maskSize / 2, maskSize, maskSize);
        this.maskGraphic.endFill();

        this.content.addChild(this.maskGraphic);
        this.gridContainer.mask = this.maskGraphic;

        const totalPages = Math.ceil(AvatarRegistry.AVATARS.length / this.ITEMS_PER_PAGE);

        if (totalPages > 1) {
            this.prevBtn = this.createNavBtn(HexAssets.Textures.Icons.Back, -230, () => this.changePage(-1));
            this.nextBtn = this.createNavBtn(HexAssets.Textures.Icons.Back, 230, () => this.changePage(1));
            this.nextBtn.scale.x *= -1; // Flip the back icon to look like "Next"
            this.updateNavButtons();
        }
    }

    /**
     * Populates the grid with ShopItem components.
     */
    private buildGrid(): void {
        // Clear existing items
        this.gridContainer.removeChildren();
        this.items = [];

        const shopTextures = {
            normal: PIXI.Texture.from("Button_SkillBtn_Blue"),
            active: PIXI.Texture.from("Button_SkillBtn_Orange"),
            locked: PIXI.Texture.from("Button_SkillBtn_Dark"),
            lockIcon: PIXI.Texture.from("Icon_Lock03")
        };

        // Offset to ensure the 4x4 group is centered around the container's 0,0
        const totalGridOffset = ((this.GRID_SIZE - 1) * this.ITEM_SPACING) / 2;

        AvatarRegistry.AVATARS.forEach(async (data, i) => {
            const page = Math.floor(i / this.ITEMS_PER_PAGE);
            const indexInPage = i % this.ITEMS_PER_PAGE;
            const col = indexInPage % this.GRID_SIZE;
            const row = Math.floor(indexInPage / this.GRID_SIZE);

            const item = new ShopItem(data, this.ITEM_SIZE, shopTextures);

            // X = Column Position - HalfGrid + Page Offset
            item.x = (col * this.ITEM_SPACING) - totalGridOffset + (page * (this.GRID_SIZE * this.ITEM_SPACING));
            item.y = (row * this.ITEM_SPACING) - totalGridOffset;

            // Check current ownership and selection state
            const isOwned = await AvatarManager.instance.isUnlocked(data.id);
            const isActive = AvatarManager.instance.currentAvatar.id === data.id;

            if (!isOwned) {
                item.setState(ShopItemState.LOCKED);
            } else if (isActive) {
                item.setState(ShopItemState.ACTIVE);
            } else {
                item.setState(ShopItemState.NORMAL);
            }

            // Click Handler
            item.on("pointertap", () => {
                if (item.getState() === ShopItemState.LOCKED) {
                    this.handleLockedItem(data.id);
                } else {
                    this.selectItem(data.id);
                }
            });

            this.items.push(item);
            this.gridContainer.addChild(item);
        });
    }

    /**
     * Swaps the active visual state between items.
     */
    private selectItem(id: number): void {
        this.items.forEach(item => {
            // We only toggle items that are unlocked
            if (item.getState() !== ShopItemState.LOCKED) {
                item.setState(item.id === id ? ShopItemState.ACTIVE : ShopItemState.NORMAL);
            }
        });

        AvatarManager.instance.setAvatar(id);
    }

    /**
     * Optional: Handle behavior when a locked item is clicked (e.g., feedback)
     */
    private handleLockedItem(id: number): void {
        // Find the clicked item to play a "denied" animation
        const item = this.items.find(i => i.id === id);
        if (item) {
            gsap.to(item, { x: item.x + 5, duration: 0.05, repeat: 3, yoyo: true });
        }
        console.log(`Avatar ${id} is locked!`);
    }

    /**
     * Animates the grid container to the relevant page X position.
     */
    private changePage(dir: number): void {
        const totalPages = Math.ceil(AvatarRegistry.AVATARS.length / this.ITEMS_PER_PAGE);
        const newPage = this.currentPage + dir;

        if (newPage >= 0 && newPage < totalPages) {
            this.currentPage = newPage;
            // The shift distance is exactly one "Grid Width"
            const pageWidth = this.GRID_SIZE * this.ITEM_SPACING;
            const targetX = -(this.currentPage * pageWidth);

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
            standard: {
                width: 60,
                height: 60,
                iconTexture: PIXI.Texture.from(tex)
            },
            click: { callback: cb }
        });
        btn.position.set(xPos, 0);
        this.content.addChild(btn);
        return btn;
    }
}