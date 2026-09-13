// TopPowerupSlots.ts

import ViewUtils from 'core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import {
    CLEAR_LOW_TIER_POWERUP_ID,
    DESTROY_PIECE_POWERUP_ID,
    UPGRADE_PIECE_POWERUP_ID,
    WIND_POWERUP_ID,
    getPowerup,
} from '../PowerupStorage';
import { PowerupButton } from './PowerupButton';

const BUTTON_GAP = 16;
const ICON_SIZE = 55;
const SLOTS_PER_SIDE = 2;
/** Fixed, known-in-advance footprint of one side's pair — used instead of a live PIXI bounds query (see layout()'s own doc for why). */
const GROUP_WIDTH = SLOTS_PER_SIDE * PowerupButton.SIZE + (SLOTS_PER_SIDE - 1) * BUTTON_GAP;

/**
 * Fixed 4-slot powerup row anchored to the top of the screen: the LEFT pair
 * are the two environment-wide ones (wind, clear-low-tier — see
 * PowerupStorage.WIND_POWERUP_ID/CLEAR_LOW_TIER_POWERUP_ID), the RIGHT pair
 * are the two single-piece-targeted ones (destroy-piece, upgrade-piece —
 * see PieceTargetingOverlay, which is what actually handles picking the
 * target once one of these is tapped). Y for both pairs comes from
 * FaceTowerConfig.powerupSlotsScreenY (see layout(), called from
 * GameHud.layout()). Separate from the existing bottom-right PowerupBelt
 * rather than replacing it — this is a new, additional row.
 */
export class TopPowerupSlots extends PIXI.Container {
    private readonly leftGroup = new PIXI.Container();
    private readonly rightGroup = new PIXI.Container();

    /** Dispatches the tapped button's id. */
    public readonly onUsePowerup: Signal = new Signal();

    private readonly buttons = new Map<string, PowerupButton>();

    public constructor() {
        super();

        this.addChild(this.leftGroup, this.rightGroup);

        this.buildSlot(this.leftGroup, 0, WIND_POWERUP_ID);
        this.buildSlot(this.leftGroup, 1, CLEAR_LOW_TIER_POWERUP_ID);
        this.buildSlot(this.rightGroup, 0, DESTROY_PIECE_POWERUP_ID);
        this.buildSlot(this.rightGroup, 1, UPGRADE_PIECE_POWERUP_ID);
    }

    /**
     * Call every frame — see GameHud.layout(). `leftX`/`rightX` are the
     * screen's own left/right edges (already padded); `y` is the shared
     * top-edge Y both pairs sit at.
     *
     * Uses GROUP_WIDTH (a fixed constant) rather than
     * `this.rightGroup.width` to right-align the right pair — both are
     * numerically identical once built, but a live PIXI bounds query
     * recomputes from every child's current geometry every single call,
     * which is needless work AND one more thing that could someday read
     * transiently wrong (e.g. mid-rebuild); a plain constant can't.
     */
    public layout(leftX: number, rightX: number, y: number): void {
        this.leftGroup.position.set(leftX, y);
        this.rightGroup.position.set(rightX - GROUP_WIDTH, y);
    }

    /** Call every frame (or whenever it might have changed) — mirrors PowerupBelt.updateCounts(). Ids with no assigned button (the 3 empty slots) simply have no entry in `buttons`, so this is a no-op for them. */
    public updateCounts(counts: Readonly<Record<string, number>>): void {
        for (const [id, button] of this.buttons) {
            button.setCount(counts[id] ?? 0);
        }
    }

    /** Highlights whichever button matches `activeId` (null clears every highlight) — mirrors PowerupBelt.setActive(). */
    public setActive(activeId: string | null): void {
        for (const [id, button] of this.buttons) {
            button.setActive(id === activeId);
        }
    }

    /** Global (stage-space) position of `id`'s button — null if it's not one of the assigned slots. Mirrors PowerupBelt.getButtonGlobalPosition() — purely for pointing a VFX flourish at it (see TowerRewardFlyUtils), not read anywhere in normal gameplay flow. */
    public getButtonGlobalPosition(id: string): { x: number; y: number } | null {
        const button = this.buttons.get(id);

        if (!button) {
            return null;
        }

        const point = button.getGlobalPosition();
        return { x: point.x, y: point.y };
    }

    /** `index` is this slot's fixed position within its own group (0 or 1, per SLOTS_PER_SIDE) — used to place it deterministically rather than measuring however many buttons already got added, same reasoning as GROUP_WIDTH's own doc. */
    private buildSlot(group: PIXI.Container, index: number, powerupId: string | undefined): void {
        const icon = powerupId
            ? TopPowerupSlots.buildIconFor(powerupId)
            : new PIXI.Container();

        const button = new PowerupButton(icon, () => {
            if (powerupId) {
                this.onUsePowerup.dispatch(powerupId);
            }
        });

        button.position.set(index * (PowerupButton.SIZE + BUTTON_GAP), 0);
        group.addChild(button);

        if (powerupId) {
            this.buttons.set(powerupId, button);
        }
    }

    /** Same icon-resolution rule PowerupBelt.buildPowerupIconFor() uses — kept as its own small copy here rather than shared, since each widget's icon SIZE differs and there's nothing else in common worth factoring out. */
    private static buildIconFor(id: string): PIXI.Container {
        const powerup = getPowerup(id);

        if (!powerup) {
            return PowerupButton.buildPieceIcon('#ffffff', undefined, ICON_SIZE);
        }

        if (powerup.icon) {
            const sprite = PIXI.Sprite.from(powerup.icon);
            sprite.anchor.set(0.5);
            sprite.scale.set(ViewUtils.elementScaler(sprite, ICON_SIZE, ICON_SIZE));

            return sprite;
        }

        return PowerupButton.buildPieceIcon(powerup.piece.color, powerup.piece.polygon, ICON_SIZE);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onUsePowerup.removeAll();
        super.destroy(options ?? { children: true });
    }
}
