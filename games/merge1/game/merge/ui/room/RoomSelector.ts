import BaseButton from "@core/ui/BaseButton";
import ViewUtils from "@core/utils/ViewUtils";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import MergeAssets from "../../MergeAssets";
import { RoomId, RoomRegistry } from "../../rooms/RoomRegistry";

export class RoomSelector extends PIXI.Container {
    public readonly onRoomSelected: Signal = new Signal();
    private mapWindow: PIXI.Container;
    private mapButton: BaseButton;
    private roomListContainer: PIXI.Container;
    private bg!: PIXI.NineSlicePlane;
    private isOpened: boolean = false;
    private lastPlayerLevel: number = 0;

    private roomItems: Map<RoomId, {
        container: PIXI.Container,
        icon: PIXI.Sprite,
        lock: PIXI.Sprite,
        text: PIXI.Text,
        highlight: PIXI.NineSlicePlane, // Changed to NineSlice
        levelBadge: PIXI.Container     // New indicator
    }> = new Map();

    constructor(private roomIds: RoomId[]) {
        super();

        this.mapButton = new BaseButton({
            standard: {
                width: 100, height: 100,
                texture: PIXI.Texture.from("Icon_MapPoint"),
                iconSize: { width: 100, height: 100 },
                centerIconHorizontally: true, centerIconVertically: true
            },
            click: { callback: () => this.toggleMap(!this.isOpened) }
        });

        this.mapButton.pivot.set(50, 50);
        this.addChild(this.mapButton);

        this.setupMapWindow();
        this.buildRoomList();
    }

    private setupMapWindow(): void {
        this.mapWindow = new PIXI.Container();
        this.mapWindow.visible = false;
        this.mapWindow.x = 50;

        const bgTexture = PIXI.Texture.from('ItemFrame01_Single_Blue');
        this.bg = new PIXI.NineSlicePlane(bgTexture, 32, 60, 32, 32);
        this.mapWindow.addChild(this.bg);

        const title = new PIXI.Text("LOCATIONS", {
            ...MergeAssets.MainFontTitle,
            fontSize: 32,
            fill: 0xFFFFFF,
        });
        title.anchor.set(0.5, 0);
        title.name = "windowTitle";
        this.mapWindow.addChild(title);

        this.roomListContainer = new PIXI.Container();
        this.mapWindow.addChild(this.roomListContainer);

        this.addChildAt(this.mapWindow, 0);
    }

    private buildRoomList(): void {
        // --- EASY SETUP CONFIG ---
        const itemWidth = 450;
        const itemHeight = 150;
        const topPadding = 70;
        const sidePadding = 40;
        const bottomPadding = 30;
        const badgeTexture = PIXI.Texture.from(MergeAssets.Textures.Icons.Badge2); // Change this texture key as needed
        const highlightTexture = PIXI.Texture.from("ItemFrame01_Single_Green"); // Nine-slice texture for active state

        this.roomIds.forEach((id, index) => {
            const def = RoomRegistry.get(id);
            const item = new PIXI.Container();
            item.y = index * itemHeight;

            // 1. Nine-Sliced Highlight
            const highlight = new PIXI.NineSlicePlane(highlightTexture, 30, 30, 30, 30);
            highlight.width = itemWidth - sidePadding;
            highlight.height = itemHeight - 10;
            highlight.position.set(-sidePadding / 2, -highlight.height / 2);
            highlight.visible = false;

            // 2. Room Icon
            const icon = PIXI.Sprite.from(def.icon);
            icon.anchor.set(0.5);

            icon.scale.set(ViewUtils.elementScaler(icon, itemHeight * 0.7))
            icon.x = 40;

            // 3. Bigger Lock
            const lock = PIXI.Sprite.from(MergeAssets.Textures.Icons.Lock);
            lock.anchor.set(0.5);
            lock.scale.set(0.75); // Made lock bigger
            lock.visible = false;

            // 4. Room Name / Unlock Text
            const text = new PIXI.Text(def.displayName, { ...MergeAssets.MainFont, fontSize: 24, fill: 0xffffff });
            text.position.set(90, -15);

            // 5. Level Indicator Sprite Container
            const levelBadge = new PIXI.Container();
            const badgeBg = PIXI.Sprite.from(badgeTexture);
            badgeBg.anchor.set(0.5);
            badgeBg.width = badgeBg.height = 60;

            const badgeText = new PIXI.Text("0", { ...MergeAssets.MainFont, fontSize: 26, fill: 0xffffff });
            badgeText.anchor.set(0.5);
            badgeText.name = "val";

            levelBadge.addChild(badgeBg, badgeText);
            levelBadge.position.set(itemWidth - 100, 0);
            levelBadge.visible = false;

            item.eventMode = 'static';
            item.cursor = 'pointer';
            item.on('pointertap', () => {
                if (RoomRegistry.isUnlocked(id, this.lastPlayerLevel)) {
                    this.onRoomSelected.dispatch(id);
                    this.toggleMap(false);
                }
            });

            item.addChild(highlight, icon, lock, text, levelBadge);
            this.roomListContainer.addChild(item);
            this.roomItems.set(id, { container: item, icon, lock, text, highlight, levelBadge });
        });

        // Dynamic Sizing
        this.bg.width = itemWidth;
        this.bg.height = (this.roomIds.length * itemHeight) + topPadding + bottomPadding;
        this.bg.y = -this.bg.height / 2;

        const title = this.mapWindow.getChildByName("windowTitle") as PIXI.Text;
        title.position.set(this.bg.width / 2, this.bg.y + 25);

        this.roomListContainer.position.set(sidePadding, this.bg.y + topPadding + (itemHeight / 2));
    }

    public toggleMap(show: boolean): void {
        this.isOpened = show;
        if (show) {
            this.mapWindow.visible = true;
            gsap.to(this.mapWindow, {
                x: -this.bg.width - 20,
                duration: 0.5,
                ease: "back.out(1.1)"
            });
        } else {
            gsap.to(this.mapWindow, {
                x: 50,
                duration: 0.4,
                ease: "power2.in",
                onComplete: () => { this.mapWindow.visible = false; }
            });
        }
    }

    public refresh(playerLevel: number, currentRoomId: RoomId): void {
        this.lastPlayerLevel = playerLevel;

        this.roomItems.forEach((item, id) => {
            const def = RoomRegistry.get(id);
            const unlocked = RoomRegistry.isUnlocked(id, playerLevel);
            const isActive = id === currentRoomId;

            if (!unlocked) {
                item.icon.tint = 0x000000;
                item.lock.visible = true;
                item.text.text = "Unlock at Level";
                item.text.style.fill = 0xffffff;

                item.levelBadge.visible = true;
                (item.levelBadge.getChildByName("val") as PIXI.Text).text = def.unlockLevel.toString();

                item.highlight.visible = false;
            } else {
                item.icon.tint = isActive ? 0xffffff : 0xbbbbbb;
                item.lock.visible = false;
                item.text.text = def.displayName;
                item.text.style.fill = isActive ? 0xFFD700 : 0xFFFFFF;

                item.levelBadge.visible = false;
                item.highlight.visible = isActive;
            }

            item.text.scale.set(Math.min(1, ViewUtils.elementScaler(item.text, 230)))
        });
    }
}