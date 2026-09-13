// PowerupButton.ts

import Assets from '../../Assets';
import * as PIXI from 'pixi.js';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/** The button's own shape/background. */
const BUTTON_FRAME = 'Label_Badge02';

/** Frame name for the "this is the globally-active powerup" state — takes priority over the normal background whenever active — see setActive(). */
const ACTIVE_FRAME = 'BubbleFrame01_Hexagon_Bg_Purpple';

/** 9-slice frame behind the count label — always shown (even at 0, see setCount()), not just once the player owns one. */
const LABEL_FRAME = 'BorderFrame_Round24';
const LABEL_SLICE = 30;
const LABEL_WIDTH = 30;
const LABEL_HEIGHT = 26;

/** Empty margin (px) kept clear around the icon on every side — see the constructor's fit-to-button scaling. */
const ICON_PADDING = 10;

/**
 * One square HUD button for a powerup (or the skip-piece action, which
 * isn't a real PowerupDefinition but shares the same "spend one to use it"
 * shape) — a single fixed background (no separate empty/available look —
 * the count label just reads "0") plus the badge/label showing how many
 * the player currently owns. Purely a dumb view: GameHud owns the actual
 * inventory count and click→use wiring (see IslandViewScene's onUsePowerup
 * callback), this just renders whatever count it's told and fires onUse()
 * on tap when it has at least one.
 */
export class PowerupButton extends PIXI.Container {
    /** Fixed footprint (px) every button occupies — public so layout code (see TopPowerupSlots) can compute positions from this known constant instead of querying live PIXI bounds. */
    public static readonly SIZE = 66;

    private readonly bgAvailable: PIXI.Sprite;
    private readonly bgActive: PIXI.Sprite;
    private readonly icon: PIXI.Container;
    private readonly countLabel: PIXI.Text;

    private count = 0;
    private active = false;

    public constructor(icon: PIXI.Container, onUse: () => void) {
        super();

        const size = PowerupButton.SIZE;

        this.bgAvailable = PIXI.Sprite.from(BUTTON_FRAME);
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
        this.icon.position.set(size * 0.5, size * 0.5);

        // Scale to fit within the button with ICON_PADDING of breathing
        // room on every side, whatever the icon's own natural size happens
        // to be (a real powerup sprite, a drawn piece swatch, the skip
        // chevrons — callers build these at their own convenient sizes,
        // not necessarily aware of PowerupButton.SIZE) — uniform (same
        // factor both axes) so it never distorts, using the icon's CURRENT
        // width/height (already reflecting any scale the caller applied).
        const fitTarget = size - ICON_PADDING * 2;
        const naturalSize = Math.max(this.icon.width, this.icon.height);

        if (naturalSize > 0) {
            const fitScale = fitTarget / naturalSize;
            this.icon.scale.set(this.icon.scale.x * fitScale, this.icon.scale.y * fitScale);
        }

        this.addChild(this.icon);

        const labelBg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(LABEL_FRAME),
            LABEL_SLICE, LABEL_SLICE, LABEL_SLICE, LABEL_SLICE,
        );
        labelBg.width = LABEL_WIDTH;
        labelBg.height = LABEL_HEIGHT;
        labelBg.pivot.set(LABEL_WIDTH * 0.5, LABEL_HEIGHT * 0.5);
        labelBg.position.set(size - LABEL_WIDTH * 0.55, size - LABEL_HEIGHT * 0.55);
        this.addChild(labelBg);

        this.countLabel = new PIXI.Text('0', {
            ...Assets.TextStyles.PowerupCounter,
        });
        this.countLabel.anchor.set(0.5);
        this.countLabel.position.copyFrom(labelBg.position);
        this.addChild(this.countLabel);

        this.interactive = true;
        this.cursor = 'pointer';
        this.on('pointertap', () => {
            if (this.count > 0) {
                onUse();
            }
        });
    }

    /** Reflects `count` immediately — call whenever PowerupInventoryStorage's value for this button changes (IslandViewScene just calls this every frame; cheap no-op if the count hasn't actually changed). */
    public setCount(count: number): void {
        const clamped = Math.max(0, count);

        if (clamped === this.count) {
            return;
        }

        this.count = clamped;
        this.countLabel.text = String(this.count);
    }

    /** Highlights this button while it's the globally-active powerup — see IslandViewScene's activePowerupId toggle/cancel/switch logic. Swaps to ACTIVE_FRAME (takes priority over the normal color background) rather than tinting/scaling, so it reads as an actual different state, not just a hover effect. Purely visual; has no bearing on whether a tap does anything (that's still gated on count > 0). */
    public setActive(active: boolean): void {
        if (active === this.active) {
            return;
        }

        this.active = active;
        this.bgActive.visible = active;
        this.bgAvailable.visible = !active;
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
