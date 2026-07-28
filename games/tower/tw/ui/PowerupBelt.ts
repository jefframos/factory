// PowerupBelt.ts

import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { getPowerup, HUD_POWERUP_IDS, SKIP_PIECE_POWERUP_ID } from '../PowerupStorage';
import { getEnabledPowerupIds } from '../PowerupConfig';
import { resolvePieceImagePath } from '../PieceStorage';
import { PowerupButton, type PowerupButtonColor } from './PowerupButton';

/**
 * One color per HUD_POWERUP_IDS entry, same order (lightning/bomb/
 * shrink-ray/skip-piece) — Purple is reserved for PowerupButton's own
 * "active" frame (see ACTIVE_FRAME there), so it's deliberately not used
 * here; skip-piece reuses Blue rather than getting its own color.
 */
const POWERUP_BUTTON_COLORS: readonly PowerupButtonColor[] = ['Yellow', 'Blue', 'Green', 'Blue'];

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
    /**
     * Total span the buttons distribute themselves across — plain mutable
     * static, not a constructor param, so it's a one-line tweak from
     * anywhere (same "just set it" convention as e.g.
     * DEFAULT_FACE_TOWER_CONFIG) rather than needing to thread a value
     * through GameHud's own constructor. Button CENTERS land evenly spaced
     * from 0 to WIDTH (see layoutButtons()) — not a fixed gap between
     * icons — so the belt always spans exactly this width regardless of
     * how many buttons getEnabledPowerupIds() ends up building.
     */
    public static WIDTH = 420;
    private static readonly ICON_SIZE = 75;

    /** Dispatches the tapped button's id (see PowerupStorage.HUD_POWERUP_IDS) — see IslandViewScene.useHudPowerup(), the sole listener. */
    public readonly onUsePowerup: Signal = new Signal();

    private readonly buttons = new Map<string, PowerupButton>();

    public constructor() {
        super();

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
     * Spreads `buttons` flush across [0, WIDTH] — the first button's left
     * edge sits at 0, the last button's left edge sits at WIDTH minus its
     * own width (so it stays flush with WIDTH, not hanging past it), and
     * everything between is evenly interpolated. A single button just
     * centers on WIDTH / 2. This is what makes the belt distribute across
     * a configurable total width instead of a fixed per-button gap.
     */
    private layoutButtons(buttons: readonly PowerupButton[]): void {
        if (buttons.length === 0) {
            return;
        }

        if (buttons.length === 1) {
            buttons[0].position.set(PowerupBelt.WIDTH * 0.5 - buttons[0].width * 0.5, 0);
            return;
        }

        const usableWidth = PowerupBelt.WIDTH - buttons[buttons.length - 1].width;
        const step = usableWidth / (buttons.length - 1);

        buttons.forEach((button, index) => {
            button.position.set(index * step, 0);
        });
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
            const sprite = PIXI.Sprite.from(resolvePieceImagePath(powerup.icon));
            sprite.anchor.set(0.5);
            sprite.width = size;
            sprite.height = size;
            return sprite;
        }

        return PowerupButton.buildPieceIcon(powerup.piece.color, powerup.piece.polygon, size);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onUsePowerup.removeAll();
        super.destroy(options ?? { children: true });
    }
}
