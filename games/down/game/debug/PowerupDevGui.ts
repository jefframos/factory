import { DevGuiManager } from 'core/utils/DevGuiManager';
import type { FaceTowerGameController } from '../../tw/FaceTowerGameController';
import type { PowerupDefinition } from '../../tw/PowerupStorage';

/**
 * Dev-only: one dat.GUI button per powerup (see PowerupStorage.POWERUPS) —
 * clicking one spawns that powerup's effect via
 * FaceTowerGameController.spawnPowerup(), same on-demand-testing role as
 * PieceDevGui's per-piece buttons.
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
                this.faceTower.spawnPowerup(powerup.id);
            }, folder);
        }
    }
}
