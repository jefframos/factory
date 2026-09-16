// PowerupButton.ts

import ViewUtils from 'core/utils/ViewUtils';
import Assets from '../../Assets';
import * as PIXI from 'pixi.js';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/** The button's own shape/background. */
const BUTTON_FRAME = 'Label_Badge02';

/** Frame name for the "this is the globally-active powerup" state — takes priority over the normal background whenever active — see setActive(). */
const ACTIVE_FRAME = 'BubbleFrame01_Hexagon_Bg_Purpple';

/** 9-slice frame behind the cost badge — see updateCost(). */
const BADGE_FRAME = 'BorderFrame_Round24';
const BADGE_SLICE = 31;
const BADGE_HEIGHT = 28;
const BADGE_PADDING_X = 10;
const BADGE_ICON_SIZE = 20;
const BADGE_ICON_GAP = 1;
/** Gap between the button's own bottom edge and the badge sitting under it. */
const BADGE_GAP_Y = -8;

const GEM_ICON_FRAME = 'ResourceBar_Single_Icon_Gem';
/** Same frame every other rewarded-video button in this game uses (GameOverPopup/PowerupConfirmPopup). */
const VIDEO_ICON_FRAME = 'ItemIcon_Video-2';

/** Badge background tint when the player can't afford this powerup's cost (see updateCost()) — same green "free/get one" convention the old count badge used at 0. */
const FREE_BADGE_COLOR = 0x3ddc61;
/** "FREE" text fill — white against FREE_BADGE_COLOR's green. */
const FREE_TEXT_COLOR = 0xffffff;
/** Cost text fill when affordable — dark against the badge's white background. */
const AFFORD_TEXT_COLOR = 0x000000;

/** Empty margin (px) kept clear around the icon on every side — see the constructor's fit-to-button scaling. */
const ICON_PADDING = 10;

/**
 * One square HUD button for a powerup (or the skip-piece action, which
 * isn't a real PowerupDefinition but shares the same "spend gems to use it"
 * shape) — a single fixed background plus a cost badge centered underneath
 * it (see updateCost()) showing either the gem icon + this powerup's gem
 * cost (affordable) or the video icon + "FREE" (not affordable — a tap
 * offers a rewarded video instead). Purely a dumb view: GameHud/
 * IslandViewScene own the actual gem balance and click→use wiring (see
 * IslandViewScene's onUsePowerup callback), this just renders whatever
 * updateCost() is told and fires onUse() on every tap regardless of
 * affordability — an unaffordable tap still opens the confirm popup (see
 * IslandViewScene.beginPowerupConfirm()), just offering WATCH VIDEO instead
 * of USE.
 */
export class PowerupButton extends PIXI.Container {
    /** Fixed footprint (px) every button occupies — public so layout code (see TopPowerupSlots) can compute positions from this known constant instead of querying live PIXI bounds. */
    public static readonly SIZE = 66;

    private readonly bgAvailable: PIXI.Sprite;
    private readonly bgActive: PIXI.Sprite;
    private readonly icon: PIXI.Container;
    private readonly badgeBg: PIXI.NineSlicePlane;
    private readonly badgeIcon: PIXI.Sprite;
    private readonly badgeText: PIXI.Text;

    /** -1 so the very first updateCost() call still applies its styling instead of short-circuiting on "already this cost". */
    private cost = -1;
    private canAfford = false;
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

        this.badgeBg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BADGE_FRAME),
            BADGE_SLICE, BADGE_SLICE, BADGE_SLICE, BADGE_SLICE,
        );
        this.addChild(this.badgeBg);

        this.badgeIcon = PIXI.Sprite.from(GEM_ICON_FRAME);
        this.badgeIcon.anchor.set(0.5);
        this.addChild(this.badgeIcon);

        this.badgeText = new PIXI.Text('', {
            ...Assets.TextStyles.PowerupCounter,
        });
        this.badgeText.anchor.set(0, 0.5);
        this.addChild(this.badgeText);

        // Starts styled for cost 0 (see updateCost()'s own doc for why
        // `cost` itself starts at -1) so there's no one-frame flash of the
        // wrong look before the first real updateCost() call lands.
        this.updateCost(0, true);

        this.interactive = true;
        this.cursor = 'pointer';
        // Fires regardless of affordability now — an unaffordable tap
        // still opens the confirm popup (see
        // IslandViewScene.beginPowerupConfirm()), just with a WATCH VIDEO
        // option instead of USE. onUse itself decides what that does; this
        // button no longer silently swallows it.
        this.on('pointertap', () => {
            onUse();
        });
    }

    /**
     * Reflects `cost`/`canAfford` immediately — call whenever the player's
     * gem balance (or this powerup's own cost) changes (IslandViewScene
     * just calls this every frame; cheap no-op if nothing actually
     * changed). Affordable: gem icon + `cost`, white badge. Not affordable:
     * video icon + "FREE" (white text on FREE_BADGE_COLOR's green) — reads
     * as "watch a video instead" and pops against the button's normal look
     * rather than just showing a cost the player can't pay. The badge sits
     * centered under the button (see the size/badgeWidth math below), not
     * tucked into a corner like the old inventory-count badge was.
     */
    public updateCost(cost: number, canAfford: boolean): void {
        if (cost === this.cost && canAfford === this.canAfford) {
            return;
        }

        this.cost = cost;
        this.canAfford = canAfford;

        this.badgeIcon.texture = PIXI.Texture.from(canAfford ? GEM_ICON_FRAME : VIDEO_ICON_FRAME);
        this.badgeIcon.scale.set(BADGE_ICON_SIZE / Math.max(this.badgeIcon.texture.width, this.badgeIcon.texture.height));


        this.badgeText.style.stroke = 0
        this.badgeText.style.strokeThickness = canAfford ? 0 : 3
        this.badgeText.text = canAfford ? String(cost) : 'FREE';
        this.badgeText.style.fill = canAfford ? AFFORD_TEXT_COLOR : FREE_TEXT_COLOR;
        this.badgeBg.tint = canAfford ? 0xffffff : FREE_BADGE_COLOR;

        this.badgeText.scale.set(Math.min(1, ViewUtils.elementScaler(this.badgeText, 40)))
        const size = PowerupButton.SIZE;
        const badgeWidth = BADGE_PADDING_X * 2 + this.badgeIcon.width + BADGE_ICON_GAP + this.badgeText.width;
        const badgeX = size * 0.5 - badgeWidth * 0.5;
        const badgeY = size + BADGE_GAP_Y;

        this.badgeBg.width = badgeWidth;
        this.badgeBg.height = BADGE_HEIGHT;
        this.badgeBg.position.set(badgeX, badgeY);

        this.badgeIcon.position.set(badgeX + BADGE_PADDING_X + this.badgeIcon.width * 0.5, badgeY + BADGE_HEIGHT * 0.5);
        this.badgeText.position.set(this.badgeIcon.x + this.badgeIcon.width * 0.5 + BADGE_ICON_GAP, badgeY + BADGE_HEIGHT * 0.5);
    }

    /** Highlights this button while it's the globally-active powerup — see IslandViewScene's activePowerupId toggle/cancel/switch logic. Swaps to ACTIVE_FRAME (takes priority over the normal color background) rather than tinting/scaling, so it reads as an actual different state, not just a hover effect. Purely visual; has no bearing on whether a tap does anything. */
    public setActive(active: boolean): void {
        if (active === this.active) {
            return;
        }

        this.active = active;
        this.bgActive.visible = active;
        this.bgAvailable.visible = !active;
    }

    /**
     * Plain rect-or-polygon swatch tinted to a piece's own color — same look
     * PieceDevGui/NextPiecePreview already use for a piece preview, reused
     * here so a real powerup's button icon matches its actual in-game piece
     * instead of needing separate icon art. `icon` (a bare frame name, same
     * PIXI.Sprite.from() convention as PowerupDefinition.icon) takes
     * priority over drawing the shape at all when set — no colored shape
     * behind it, since the icon image is already the complete piece art —
     * with `iconScale` multiplying its default size.
     */
    public static buildPieceIcon(
        color: string,
        polygon: { x: number; y: number }[] | undefined,
        size: number,
        icon?: string,
        iconScale?: { x: number; y: number },
    ): PIXI.Container {
        if (icon) {
            const scale = iconScale ?? { x: 1, y: 1 };
            const sprite = PIXI.Sprite.from(icon);

            sprite.anchor.set(0.5);
            sprite.width = size * scale.x;
            sprite.height = size * scale.y;
            return sprite;
        }

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
