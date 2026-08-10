// GateManager.ts
//
// Owns every live Gate in the scene and is the ONLY thing that decides when
// to check a gate's requirement and play its unlock sequence — see
// WorldProgressionHost.ts's own doc for why that has to be centralized
// rather than each Gate reacting to BuildingStorage.onLevelUp on its own
// (two gates unlocking off the same level-up would otherwise fight over the
// camera). PizzaScene calls processBuildingLevelUp() from its
// notifyBuildingLevelUp() (the WorldProgressionHost implementation), after
// the triggering building's own level-up sequence has fully played out.

import { BuildingId } from '../data/BuildingTypes';
import { CameraFocusHost } from '../camera/CameraFocusHost';
import World from '../ecs/World';
import Gate from './Gate';

export default class GateManager {
    private readonly world: World;
    private readonly cameraFocusHost: CameraFocusHost;
    private readonly gates: Gate[] = [];

    public constructor(world: World, cameraFocusHost: CameraFocusHost) {
        this.world = world;
        this.cameraFocusHost = cameraFocusHost;
    }

    /** Call once per spawned, still-locked Gate — see PizzaScene.setupGates(). Already-unlocked gates are never spawned at all, so there's nothing to register for them. */
    public register(gate: Gate): void {
        this.gates.push(gate);
    }

    /**
     * Checks every still-registered gate tied to `buildingId` and, for each whose requirement
     * is now met, plays its full unlock sequence — ONE AT A TIME, awaited in order, never
     * concurrently, so two gates unlocking off the same level-up don't both grab the camera at
     * once. Each unlocked gate is removed from `world` (and this manager's own list) once its
     * sequence finishes, before the next one (if any) starts.
     */
    public async processBuildingLevelUp(buildingId: BuildingId, _level: number): Promise<void> {
        // Snapshotted up front, not re-read mid-loop — remove() mutates `this.gates` as each
        // gate finishes, and iterating a live array while splicing it would skip entries.
        const candidates = this.gates.filter(gate => gate.requiresBuilding(buildingId));

        for (const gate of candidates) {
            if (!gate.isRequirementMet()) {
                continue;
            }

            await gate.playUnlockSequence(this.cameraFocusHost);
            this.remove(gate);
        }
    }

    private remove(gate: Gate): void {
        this.world.remove(gate);
        const index = this.gates.indexOf(gate);
        if (index !== -1) {
            this.gates.splice(index, 1);
        }
    }
}
