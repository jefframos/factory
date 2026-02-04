import BaseButton from "@core/ui/BaseButton";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { InGameProgress } from "../../data/InGameProgress";
import MergeAssets from "../../MergeAssets";
import { RoomId, RoomRegistry } from "../../rooms/RoomRegistry";
import { NotificationIcon } from "../shop/NotificationIcon";
import { RoomSelectorItem } from "./RoomSelectorItem";

export class RoomSelector extends PIXI.Container {
    public readonly onRoomSelected: Signal = new Signal();
    public readonly onChangeRoom: Signal = new Signal();

    private mapWindow: PIXI.Container;
    private mapButton: BaseButton;
    private closeButton: BaseButton;
    private roomListContainer: PIXI.Container;
    private bg!: PIXI.NineSlicePlane;
    private isOpened: boolean = false;

    private lastPlayerLevel: number = 0;
    private currentRoomId: RoomId | null = null;

    private items: RoomSelectorItem[] = [];

    constructor(private roomIds: RoomId[]) {
        super();

        // Main Map Toggle Button
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

        const collectionNotificationIcon = new NotificationIcon(
            () => RoomRegistry.anyRoomAvailableAndEmpty(["room_0"]),
            InGameProgress.instance.onXpChange
        );

        this.mapButton.addChild(collectionNotificationIcon);
        collectionNotificationIcon.x = 10;
        collectionNotificationIcon.y = 10;

        this.setupMapWindow();
        this.buildRoomList();
    }

    private setupMapWindow(): void {
        this.mapWindow = new PIXI.Container();
        this.mapWindow.visible = false;
        this.mapWindow.x = 0; // Start at left edge

        this.bg = new PIXI.NineSlicePlane(PIXI.Texture.from(MergeAssets.Textures.UI.MapPanel), 32, 32, 32, 32);
        this.mapWindow.addChild(this.bg);

        const title = new PIXI.Text("LOCATIONS", { ...MergeAssets.MainFontTitle, fontSize: 32, fill: 0xFFFFFF });
        title.anchor.set(0.5, 0);
        title.name = "windowTitle";
        this.mapWindow.addChild(title);

        // Close Button
        this.closeButton = new BaseButton({
            standard: {
                width: 60, height: 60,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Red),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Close),
                iconSize: { width: 40, height: 40 },
                centerIconHorizontally: true, centerIconVertically: true
            },
            click: { callback: () => this.toggleMap(false) }
        });
        this.mapWindow.addChild(this.closeButton);

        this.roomListContainer = new PIXI.Container();
        this.mapWindow.addChild(this.roomListContainer);
        this.addChildAt(this.mapWindow, 0);
    }

    private buildRoomList(): void {
        const itemWidth = 450;
        const itemHeight = 150;
        const topPadding = 70;
        const sidePadding = 40;

        this.roomIds.forEach((id, index) => {
            const item = new RoomSelectorItem(id, itemWidth, itemHeight, sidePadding);
            item.y = index * itemHeight;

            item.on('pointertap', () => {
                if (id === this.currentRoomId) return;

                if (RoomRegistry.isUnlocked(id, this.lastPlayerLevel)) {
                    this.onRoomSelected.dispatch(id);
                    this.toggleMap(false);
                }
            });

            this.roomListContainer.addChild(item);
            this.items.push(item);
        });

        // Background sizing
        this.bg.width = itemWidth;
        this.bg.height = (this.roomIds.length * itemHeight) + topPadding + 30;
        // Position background at top-left (0, 0)
        this.bg.y = 0;

        // Position Title
        const title = this.mapWindow.getChildByName("windowTitle") as PIXI.Text;
        title.position.set(this.bg.width / 2, 25);

        // Position Close Button at top-right
        this.closeButton.position.set(this.bg.width - 70, 10);

        this.roomListContainer.position.set(sidePadding, topPadding + (itemHeight / 2));
    }

    public toggleMap(show: boolean): void {
        this.isOpened = show;
        // When closed: move off-screen to the left (-width - offset)
        // When open: move to x = 0 (visible)
        const targetX = show ? 0 : -(this.bg.width + 20);

        if (show) {
            MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.OpenPopup)
            // Optional: Bring to front when opened
            if (this.parent) this.parent.addChild(this);
            this.mapWindow.visible = true;
        } else {

            MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.ClosePopup)
        }

        gsap.to(this.mapWindow, {
            x: targetX,
            duration: 0.5,
            ease: show ? "back.out(1.1)" : "back.in(1.1)",
            onComplete: () => {
                if (!show) this.mapWindow.visible = false;
            }
        });
    }

    public refresh(playerLevel: number, currentRoomId: RoomId): void {
        this.lastPlayerLevel = playerLevel;
        this.currentRoomId = currentRoomId;

        this.items.forEach(item => {
            item.updateState(playerLevel, item.roomId === currentRoomId);
        });
    }
}