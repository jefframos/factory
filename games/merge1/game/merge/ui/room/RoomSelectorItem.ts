import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";
import { RoomId, RoomRegistry } from "../../rooms/RoomRegistry";
import GameStorage from "../../storage/GameStorage";
import { TextureBaker } from "../../vfx/TextureBaker";

export class RoomSelectorItem extends PIXI.Container {
    public readonly highlight: PIXI.NineSlicePlane;
    public readonly unHighlight: PIXI.NineSlicePlane;
    public readonly icon: PIXI.Sprite;
    public readonly lock: PIXI.Sprite;
    public readonly text: PIXI.Text;
    public readonly levelBadge: PIXI.Container;

    private readonly currentLabel: PIXI.Text;
    private readonly goArrow: PIXI.Sprite;

    // Entity Counter UI
    private readonly entityCounter: PIXI.Container;
    private readonly entityCountText: PIXI.Text;
    private readonly entityIcon: PIXI.Sprite;

    constructor(
        public readonly roomId: RoomId,
        width: number,
        height: number,
        sidePadding: number
    ) {
        super();

        const def = RoomRegistry.get(roomId);
        const rectW = width - sidePadding;
        const rectH = height - 10;
        const rectX = -sidePadding / 2;
        const rectY = -rectH / 2;

        // 1. Hit Zone
        const hitZone = new PIXI.Graphics();
        hitZone.beginFill(0xFFFFFF, 0.001);
        hitZone.drawRect(rectX, rectY, rectW, rectH);
        hitZone.endFill();
        this.addChild(hitZone);

        // 2. Highlight
        this.unHighlight = new PIXI.NineSlicePlane(PIXI.Texture.from("ItemFrame01_Single_Gray"), 30, 30, 30, 30);
        this.unHighlight.width = rectW;
        this.unHighlight.height = rectH;
        this.unHighlight.position.set(rectX, rectY);
        this.unHighlight.visible = true;
        // 2. Highlight
        this.highlight = new PIXI.NineSlicePlane(PIXI.Texture.from("ItemFrame01_Single_Green"), 30, 30, 30, 30);
        this.highlight.width = rectW;
        this.highlight.height = rectH;
        this.highlight.position.set(rectX, rectY);
        this.highlight.visible = false;

        // 3. Room Icon (Left)
        this.icon = PIXI.Sprite.from(def.icon);
        this.icon.anchor.set(0.5);
        this.icon.scale.set(ViewUtils.elementScaler(this.icon, height * 0.7));
        this.icon.x = 40;

        // 4. Room Name
        this.text = new PIXI.Text(def.displayName, { ...MergeAssets.MainFont, fontSize: 28, fill: 0xffffff });
        this.text.position.set(100, this.highlight.y + this.highlight.height / 2);
        this.text.anchor.y = 0.5

        // 5. "CURRENT AREA" Label
        this.currentLabel = new PIXI.Text("CURRENT AREA", {
            ...MergeAssets.MainFont,
            fontSize: 18,
            fill: 0xFFD700
        });
        this.currentLabel.position.set(100, 20);
        this.currentLabel.visible = false;

        // 6. Entity Counter (Container for Icon + Number)
        this.entityCounter = new PIXI.Container();

        // Use a generic entity icon or one based on the room's entityType
        this.entityIcon = PIXI.Sprite.from(TextureBaker.getTexture('ENTITY_1')); // Make sure this key exists
        this.entityIcon.anchor.set(0, 0.5);
        this.entityIcon.scale.set(ViewUtils.elementScaler(this.entityIcon, 60));

        this.entityCountText = new PIXI.Text("0", {
            ...MergeAssets.MainFont,
            fontSize: 22,
            fill: 0xFFFFFF
        });
        this.entityCountText.position.set(25, -12); // Offset from icon center

        this.entityCounter.addChild(this.entityIcon, this.entityCountText);
        // Positioned between the name and the right-side arrow/badge
        this.entityCounter.position.set(this.highlight.x + this.highlight.width - 80, this.highlight.y + this.highlight.height - 80);
        this.entityCounter.visible = false;

        // 7. Go Arrow
        this.goArrow = PIXI.Sprite.from(MergeAssets.Textures.Icons.ArrowRight);
        this.goArrow.anchor.set(0.5);
        this.goArrow.scale.set(0.5);
        this.goArrow.position.set(width - 110, 0);
        this.goArrow.visible = false;

        // 8. Lock & Level Badge
        this.lock = PIXI.Sprite.from(MergeAssets.Textures.Icons.Lock);
        this.lock.anchor.set(0.5);
        this.lock.visible = false;
        this.lock.x = this.icon.x

        this.levelBadge = new PIXI.Container();
        const badgeBg = PIXI.Sprite.from(PIXI.Texture.from(MergeAssets.Textures.Icons.BadgeMain));
        badgeBg.anchor.set(0.5);
        badgeBg.width = badgeBg.height = 60;
        const badgeText = new PIXI.Text(def.unlockLevel.toString(), { ...MergeAssets.MainFont, fontSize: 26, fill: 0xffffff });
        badgeText.anchor.set(0.5);
        this.levelBadge.addChild(badgeBg, badgeText);
        this.levelBadge.position.set(width - 110, 0);

        // Interaction
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.hitArea = new PIXI.Rectangle(rectX, rectY, rectW, rectH);

        this.addChild(this.unHighlight, this.highlight, this.icon, this.lock, this.text, this.currentLabel, this.entityCounter, this.levelBadge);
    }

    public updateState(playerLevel: number, isActive: boolean): void {
        const def = RoomRegistry.get(this.roomId);

        const unlocked = RoomRegistry.isUnlocked(this.roomId, playerLevel);

        // Use the new helper
        const animalStats = GameStorage.instance.getRoomAnimalStats(this.roomId);
        const entityCount = animalStats.count

        if (unlocked) {
            // Show count
            this.entityCountText.text = animalStats.count.toString();
            this.entityCounter.visible = animalStats.count > 0;


            // If you have a "Highest Level" badge, you can update it here
            if (animalStats.highestLevel > 0) {
                if (this.entityIcon) {
                    const tex = TextureBaker.getTexture('ENTITY_' + animalStats.highestLevel)
                    if (tex) {

                        this.entityIcon.texture = tex
                    }
                }
                // e.g., this.levelBadgeText.text = "Lvl " + animalStats.highestLevel;
            }
        }

        // Reset visibility
        this.levelBadge.visible = false;
        this.lock.visible = false;
        this.currentLabel.visible = false;
        this.goArrow.visible = false;
        this.highlight.visible = false;
        this.entityCounter.visible = false;

        if (!unlocked) {
            this.icon.tint = 0x000000;
            this.lock.visible = true;
            this.text.text = "Unlock at Level";
            this.text.anchor.x = 1
            this.text.y = this.highlight.y + this.highlight.height / 2
            this.text.x = this.levelBadge.x - 40
            this.levelBadge.visible = true;

            this.unHighlight.texture = PIXI.Texture.from("ItemFrame01_Single_Gray")

        } else {
            this.icon.tint = 0xffffff;
            this.text.text = def.displayName;
            this.text.anchor.x = 0
            this.text.position.set(100, this.highlight.y + this.highlight.height / 2 - 10);
            this.unHighlight.texture = PIXI.Texture.from("ItemFrame01_Single_Navy")


            // Update and show entity count for all unlocked rooms
            this.entityCountText.text = ''//entityCount.toString();
            this.entityCounter.visible = true;

            if (isActive) {
                this.highlight.visible = true;
                this.currentLabel.visible = true;
                this.text.style.fill = 0xFFD700;
            } else {
                this.goArrow.visible = true;
                this.text.style.fill = 0xFFFFFF;
            }
        }
        this.text.scale.set(Math.min(1, ViewUtils.elementScaler(this.text, 200)));
    }
}