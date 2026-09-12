// PowerupBelt.ts

import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { getPowerup, HUD_POWERUP_IDS, SKIP_PIECE_POWERUP_ID } from '../PowerupStorage';
import { getEnabledPowerupIds } from '../PowerupConfig';
import { PowerupButton, type PowerupButtonColor } from './PowerupButton';
import ViewUtils from 'core/utils/ViewUtils';

/**
 * One color per HUD_POWERUP_IDS entry, same order (bomb/skip-piece) —
 * Purple is reserved for PowerupButton's own "active" frame (see
 * ACTIVE_FRAME there), so it's deliberately not used here.
 */
const POWERUP_BUTTON_COLORS: readonly PowerupButtonColor[] = ['Yellow', 'Blue'];

/**
 * The row of powerup buttons (the 3 real powerups + skip-piece) — owns
 * building/laying out the PowerupButtons and their icons, but no game state
 * itself: counts/active-highlight come in from GameHud (which mirrors
 * PowerupInventoryStorage/IslandViewScene's activePowerupId), and a tap
 * goes OUT via onUsePowerup rather than a constructor callback, so
 * IslandViewScene (or anything else) can listen without this component
 * needing to know who's listening.
 */
export class PowerupBelt extends PIXI.Container {
    private static readonly ICON_SIZE = 55;
    private static readonly BUTTON_SIZE = 70;
    /** Gap (px) between buttons when more than one is enabled — see layoutButtons(). */
    private static readonly BUTTON_GAP = 16;

    /** Dispatches the tapped button's id (see PowerupStorage.HUD_POWERUP_IDS) — see IslandViewScene.useHudPowerup(), the sole listener. */
    public readonly onUsePowerup: Signal = new Signal();

    private readonly buttons = new Map<string, PowerupButton>();

    public constructor() {
        super();

        // No background panel — just the bare button(s), so the belt reads
        // as a single floating icon (bottom-right, see GameHud.layout())
        // rather than a wide bar.

        // Disabled ids (see PowerupConfig.POWERUP_ENABLED) are skipped
        // entirely — no button — rather than just hidden/greyed, so
        // turning one off actually removes it from the belt as asked.
        const built = getEnabledPowerupIds().map((id) => {
            const icon = id === SKIP_PIECE_POWERUP_ID
                ? PowerupButton.buildSkipIcon(PowerupBelt.ICON_SIZE)
                : PowerupBelt.buildPowerupIconFor(id, PowerupBelt.ICON_SIZE);

            // Colors stay keyed off HUD_POWERUP_IDS' own (fixed) order, not
            // the enabled-only list's index — so a given powerup's color
            // never shifts depending on which OTHER ones happen to be
            // enabled.
            const color = POWERUP_BUTTON_COLORS[HUD_POWERUP_IDS.indexOf(id)] ?? POWERUP_BUTTON_COLORS[0];
            const button = new PowerupButton(color, icon, () => this.onUsePowerup.dispatch(id));

            this.addChild(button);
            this.buttons.set(id, button);

            return button;
        });

        this.layoutButtons(built);
    }

    /**
     * Lays `buttons` out left-to-right, tightly packed starting at this
     * container's own local origin (0, 0) with BUTTON_GAP between each —
     * NOT spread across some fixed total span. That matters now that
     * there's no background bar to fill: GameHud.layout() right-aligns the
     * whole belt by doing `bottomRight.x - this.powerupBelt.width - padding`,
     * which only lands correctly if the visible content actually starts
     * flush at local x=0 — anchoring a single button's CENTER on some wider
     * fixed span (the old behavior) left it sitting well to the right of
     * the container's own origin, so that math pushed it off-screen.
     */
    private layoutButtons(buttons: readonly PowerupButton[]): void {
        let x = 0;

        for (const button of buttons) {
            button.position.set(x, 0);
            x += button.width + PowerupBelt.BUTTON_GAP;
        }
    }

    /** Call every frame (or whenever it might have changed) — cheap no-op per button when its count hasn't actually moved, see PowerupButton.setCount(). */
    public updateCounts(counts: Readonly<Record<string, number>>): void {
        for (const [id, button] of this.buttons) {
            button.setCount(counts[id] ?? 0);
        }
    }

    /** Highlights whichever button matches `activeId` (null clears every highlight). */
    public setActive(activeId: string | null): void {
        for (const [id, button] of this.buttons) {
            button.setActive(id === activeId);
        }
    }

    /** Global (stage-space) position of `id`'s button — null if it's disabled/not built (see PowerupConfig.getEnabledPowerupIds()). Purely for pointing a VFX flourish at it (see TowerRewardFlyUtils) — not read anywhere in normal gameplay flow. */
    public getButtonGlobalPosition(id: string): { x: number; y: number } | null {
        const button = this.buttons.get(id);

        if (!button) {
            return null;
        }

        const point = button.getGlobalPosition();
        return { x: point.x, y: point.y };
    }

    /**
     * `powerup.icon` (if set — see PowerupDefinition.icon) wins outright: a
     * plain PNG/webp sprite instead of a drawn piece-shape swatch. Falls
     * back to the drawn shape when omitted, or a plain white square if
     * `id` isn't a configured powerup at all (shouldn't happen with
     * HUD_POWERUP_IDS' own entries, but keeps a bad id from throwing
     * instead of just looking wrong).
     */
    private static buildPowerupIconFor(id: string, size: number): PIXI.Container {
        const powerup = getPowerup(id);

        if (!powerup) {
            return PowerupButton.buildPieceIcon('#ffffff', undefined, size);
        }

        if (powerup.icon) {
            const sprite = PIXI.Sprite.from(powerup.icon);
            sprite.anchor.set(0.5);
            sprite.scale.set(ViewUtils.elementScaler(sprite, size, size));

            return sprite;
        }

        return PowerupButton.buildPieceIcon(powerup.piece.color, powerup.piece.polygon, size);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onUsePowerup.removeAll();
        super.destroy(options ?? { children: true });
    }
}
