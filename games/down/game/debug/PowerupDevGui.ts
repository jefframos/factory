import { DevGuiManager } from 'core/utils/DevGuiManager';
import type { FaceTowerGameController } from '../../tw/FaceTowerGameController';
import {
    CLEAR_LOW_TIER_POWERUP_ID,
    TRAPDOOR_POWERUP_ID,
    type PowerupDefinition,
} from '../../tw/PowerupStorage';

/**
 * Dev-only: one dat.GUI button per powerup (see PowerupStorage.POWERUPS) —
 * clicking one triggers its effect, branching on PowerupActivationType same
 * as IslandViewScene.useHudPowerup() does for the real HUD:
 *  - 'drop' (bomb/super-bomb): FaceTowerGameController.spawnPowerup(), same
 *    on-demand-testing role as PieceDevGui's per-piece buttons.
 *  - 'instant' (trapdoor/clear-low-tier): the matching trigger*Powerup() call,
 *    applied immediately.
 *  - 'target' (destroy-piece/upgrade-piece): no dev shortcut yet — picking
 *    a target requires the real targeting-overlay flow this class has no
 *    access to, so the button just logs instead of silently doing nothing
 *    useful.
 */
export class PowerupDevGui {
    public constructor(
        private readonly powerups: readonly PowerupDefinition[],
        private readonly faceTower: FaceTowerGameController,
    ) { }

    /** Registers the "Powerups" dat.GUI folder — one "Spawn <id>" button per powerup. Call once during scene setup. */
    public setup(): void {
        if (this.powerups.length === 0) {
            return;
        }

        const gui = DevGuiManager.instance;
        const folder = 'Powerups';

        for (const powerup of this.powerups) {
            gui.addButton(`Spawn ${powerup.id}`, () => {
                if (powerup.type === 'instant') {
                    if (powerup.id === TRAPDOOR_POWERUP_ID) {
                        this.faceTower.triggerTrapdoorPowerup();
                    } else if (powerup.id === CLEAR_LOW_TIER_POWERUP_ID) {
                        this.faceTower.triggerClearLowTierPowerup();
                    }

                    return;
                }

                if (powerup.type === 'target') {
                    console.log(`PowerupDevGui: '${powerup.id}' needs a tapped target — use the real HUD button instead.`);
                    return;
                }

                this.faceTower.spawnPowerup(powerup.id);
            }, folder);
        }
    }
}
