import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import MergeAssets from "../../MergeAssets";
import { RoomId, RoomRegistry } from "../../rooms/RoomRegistry";

export class RoomSelector extends PIXI.Container {
    public readonly onRoomSelected: Signal = new Signal();
    private buttons: Map<RoomId, BaseButton> = new Map();

    constructor(roomIds: RoomId[]) {
        super();
        // Create buttons and stack them vertically (bottom-up logic)
        roomIds.reverse().forEach((id, index) => {
            const btn = this.createRoomButton(id);
            btn.y = -(index * 60); // Stack upwards
            this.addChild(btn);
            this.buttons.set(id, btn);
        });
    }

    private createRoomButton(roomId: RoomId): BaseButton {
        const def = RoomRegistry.get(roomId);
        const btn = new BaseButton({
            standard: {
                width: 90, height: 50,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Blue),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 14 })
            },
            over: { tint: 0xeeeeee },
            click: { callback: () => this.onRoomSelected.dispatch(roomId) }
        });

        const label = new PIXI.Text(def.name, { ...MergeAssets.MainFont, fontSize: 14 });
        label.anchor.set(0.5);
        label.position.set(45, 25);
        btn.addChild(label);
        (btn as any).__label = label;
        return btn;
    }

    public refresh(playerLevel: number, currentRoomId: RoomId): void {
        this.buttons.forEach((btn, id) => {
            const unlocked = RoomRegistry.isUnlocked(id, playerLevel);
            const label = (btn as any).__label;
            const def = RoomRegistry.get(id);

            if (!unlocked) {
                btn.alpha = 0.5;
                label.text = `Lvl ${def.unlockLevel}`;
            } else {
                btn.alpha = id === currentRoomId ? 1.0 : 0.8;
                label.text = def.name;
                (btn as any).tint = id === currentRoomId ? 0xffffff : 0xcccccc;
            }
        });
    }
}