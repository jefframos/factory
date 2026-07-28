// PowerupButton.ts

import Assets from '../../Assets';
import * as PIXI from 'pixi.js';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/** Frame name for the "empty" (no count) hexagon background — same for every button regardless of its available-state color. */
const EMPTY_FRAME = 'BubbleFrame01_Hexagon_Bg_Grey';

/** Frame name for the "this is the globally-active powerup" state — same for every button regardless of its own available-state color, and takes priority over empty/available whenever active — see setActive(). */
const ACTIVE_FRAME = 'BubbleFrame01_Hexagon_Bg_Purpple';

/** 9-slice frame behind the count label — only shown while count > 0 (see setCount()). */
const LABEL_FRAME = 'BorderFrame_Round24';
const LABEL_SLICE = 30;
const LABEL_WIDTH = 30;
const LABEL_HEIGHT = 26;

/** Which colored hexagon frame each HUD_POWERUP_IDS entry's "available" state uses — see GameHud.buildPowerupBar(), which passes these in id order (lightning/bomb/shrink-ray/skip-piece → Blue/Green/Yellow/Purple). */
export type PowerupButtonColor = 'Blue' | 'Green' | 'Yellow' | 'Purpple';

/**
 * One square HUD button for a powerup (or the skip-piece action, which
 * isn't a real PowerupDefinition but shares the same "spend one to use it"
 * shape) — swaps between two hexagon-frame background states (available vs
 * empty) and shows how many the player currently owns. Purely a dumb view:
 * GameHud owns the actual inventory count and click→use wiring (see
 * IslandViewScene's onUsePowerup callback), this just renders whatever
 * count it's told and fires onUse() on tap when it has at least one.
 */
export class PowerupButton extends PIXI.Container {
    private static readonly SIZE = 80;

    private readonly bgEmpty: PIXI.Sprite;
    private readonly bgAvailable: PIXI.Sprite;
    private readonly bgActive: PIXI.Sprite;
    private readonly icon: PIXI.Container;
    /** The count label + its 9-slice frame, shown/hidden together — see setCount(). */
    private readonly labelContainer: PIXI.Container;
    private readonly countLabel: PIXI.Text;

    /** -1 (not a real count) so the constructor's setCount(0) below can't short-circuit via the "unchanged" check and skip applying the initial empty-state visuals. */
    private count = -1;
    private active = false;

    public constructor(color: PowerupButtonColor, icon: PIXI.Container, onUse: () => void) {
        super();

        const size = PowerupButton.SIZE;

        this.bgEmpty = PIXI.Sprite.from(EMPTY_FRAME);
        this.bgEmpty.anchor.set(0.5);
        this.bgEmpty.position.set(size * 0.5, size * 0.5);
        this.bgEmpty.width = size;
        this.bgEmpty.height = size;
        this.addChild(this.bgEmpty);

        this.bgAvailable = PIXI.Sprite.from(`BubbleFrame01_Hexagon_Bg_${color}`);
        this.bgAvailable.anchor.set(0.5);
        this.bgAvailable.position.set(size * 0.5, size * 0.5);
        this.bgAvailable.width = size;
        this.bgAvailable.height = size;
        this.addChild(this.bgAvailable);

        this.bgActive = PIXI.Sprite.from(ACTIVE_FRAME);
        this.bgActive.anchor.set(0.5);
        this.bgActive.position.set(size * 0.5, size * 0.5);
        this.bgActive.width = size;
        this.bgActive.height = size;
        this.bgActive.visible = false;
        this.addChild(this.bgActive);

        this.icon = icon;
        this.icon.position.set(size * 0.5, size * 0.42);
        this.addChild(this.icon);

        this.labelContainer = new PIXI.Container();
        this.labelContainer.position.set(size - LABEL_WIDTH * 0.55, size - LABEL_HEIGHT * 0.55);
        this.addChild(this.labelContainer);

        const labelBg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(LABEL_FRAME),
            LABEL_SLICE, LABEL_SLICE, LABEL_SLICE, LABEL_SLICE,
        );
        labelBg.width = LABEL_WIDTH;
        labelBg.height = LABEL_HEIGHT;
        labelBg.pivot.set(LABEL_WIDTH * 0.5, LABEL_HEIGHT * 0.5);
        this.labelContainer.addChild(labelBg);

        this.countLabel = new PIXI.Text('0', {
            ...Assets.TextStyles.PowerupCounter,
        });
        this.countLabel.anchor.set(0.5);
        this.labelContainer.addChild(this.countLabel);

        this.interactive = true;
        this.on('pointertap', () => {
            if (this.count > 0) {
                onUse();
            }
        });

        this.setCount(0);
    }

    /** Reflects `count` immediately — call whenever PowerupInventoryStorage's value for this button changes (IslandViewScene just calls this every frame; cheap no-op if the count hasn't actually changed). */
    public setCount(count: number): void {
        const clamped = Math.max(0, count);

        if (clamped === this.count) {
            return;
        }

        this.count = clamped;
        this.refreshVisuals();
    }

    /** Highlights this button while it's the globally-active powerup — see IslandViewScene's activePowerupId toggle/cancel/switch logic. Swaps to ACTIVE_FRAME (takes priority over empty/available) rather than tinting/scaling, so it reads as an actual different state, not just a hover effect. Purely visual; has no bearing on whether a tap does anything (that's still gated on count > 0). */
    public setActive(active: boolean): void {
        if (active === this.active) {
            return;
        }

        this.active = active;
        this.refreshVisuals();
    }

    private refreshVisuals(): void {
        const hasAny = this.count > 0;

        this.bgActive.visible = this.active;
        this.bgAvailable.visible = !this.active && hasAny;
        this.bgEmpty.visible = !this.active && !hasAny;

        this.icon.alpha = hasAny ? 1 : 0.4;
        this.cursor = hasAny ? 'pointer' : 'default';

        this.labelContainer.visible = hasAny;

        if (hasAny) {
            this.countLabel.text = String(this.count);
        }
    }

    /** Plain rect-or-polygon swatch tinted to a piece's own color — same look PieceDevGui/NextPiecePreview already use for a piece preview, reused here so a real powerup's button icon matches its actual in-game piece instead of needing separate icon art. */
    public static buildPieceIcon(color: string, polygon: { x: number; y: number }[] | undefined, size: number): PIXI.Container {
        const shape = new PIXI.Graphics();

        shape.lineStyle(1.5, 0x000000, 1);
        shape.beginFill(hexStringToNumber(color), 1);

        if (polygon) {
            shape.drawPolygon(polygon.flatMap(p => [(p.x - 0.5) * size, (p.y - 0.5) * size]));
        } else {
            shape.drawRect(-size * 0.5, -size * 0.5, size, size);
        }

        shape.endFill();
        return shape;
    }

    /** Simple double-chevron "skip" glyph — the skip-piece action has no PieceDefinition/piece art to draw from, unlike the real powerups. */
    public static buildSkipIcon(size: number): PIXI.Container {
        const graphic = new PIXI.Graphics();
        graphic.beginFill(0xffffff, 1);

        const half = size * 0.5;
        const chevronWidth = size * 0.28;

        for (const offsetX of [-chevronWidth * 0.6, chevronWidth * 0.6]) {
            graphic.drawPolygon([
                offsetX - chevronWidth * 0.5, -half,
                offsetX + chevronWidth * 0.5, 0,
                offsetX - chevronWidth * 0.5, half,
            ]);
        }

        graphic.endFill();
        return graphic;
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        super.destroy(options ?? { children: true });
    }
}
