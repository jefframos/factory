import * as THREE from "three";
import { Area, CardinalDir } from "./Area";
import { AREAS } from "./AreaConfig";
import type { PlayerEntity } from "../entities/PlayerEntity";

// How far past the wall center the player must be before we commit the
// transition and lock the back gate. Must be greater than WALL_D/2 + max
// player radius so the locked gate AABB doesn't immediately push them back.
const TRANSITION_BUFFER = 2.5;

const OPPOSITE: Record<CardinalDir, CardinalDir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export class AreaManager {
    private scene: THREE.Scene;
    private areas: Area[] = [];
    private currentIdx = 0;
    private configIdx = 0;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.areas.push(new Area(AREAS[0], 0, 0, scene));
    }

    private get current(): Area { return this.areas[this.currentIdx]; }

    update(player: PlayerEntity): void {
        this.current.resolveCollisions(
            player.position,
            player.collisionRadius,
            player.value,
        );

        const exitDir = this.detectExit(player.position);
        if (exitDir) this.transition(exitDir);
    }

    /** Food value pool for the current area. */
    get foodValues(): number[] { return this.current.config.foodValues; }

    /** Half-size of the current area for constraining food spawns. */
    get spawnHalfSize(): number { return this.current.config.size / 2 - 5; }

    /** Center of the current area in world XZ. */
    get spawnCenter(): THREE.Vector2 {
        return new THREE.Vector2(this.current.centerX, this.current.centerZ);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private detectExit(pos: THREE.Vector3): CardinalDir | null {
        const a = this.current;
        const s = a.config.size / 2;
        const cx = a.centerX;
        const cz = a.centerZ;
        // Use TRANSITION_BUFFER so we only commit once the player is fully
        // clear of the gate AABB (prevents the newly locked back gate from
        // immediately pushing them back out).
        if (pos.z > cz + s + TRANSITION_BUFFER) return 'N';
        if (pos.z < cz - s - TRANSITION_BUFFER) return 'S';
        if (pos.x > cx + s + TRANSITION_BUFFER) return 'E';
        if (pos.x < cx - s - TRANSITION_BUFFER) return 'W';
        return null;
    }

    private transition(exitDir: CardinalDir): void {
        const old = this.current;
        const oldS = old.config.size / 2;

        this.configIdx = Math.min(this.configIdx + 1, AREAS.length - 1);
        const nextConfig = AREAS[this.configIdx];
        const nextS = nextConfig.size / 2;

        // Place the new area so its outer wall aligns with the old area's outer wall.
        let nextCx = old.centerX;
        let nextCz = old.centerZ;
        const offset = oldS + nextS;
        if (exitDir === 'N') nextCz += offset;
        else if (exitDir === 'S') nextCz -= offset;
        else if (exitDir === 'E') nextCx += offset;
        else                      nextCx -= offset;

        // Seal the exit gate on the old area so the player can't re-enter it.
        old.lockGate(exitDir);

        // Build the new area and lock the gate facing back toward the old area.
        const newArea = new Area(nextConfig, nextCx, nextCz, this.scene);
        newArea.lockGate(OPPOSITE[exitDir]);

        this.areas.push(newArea);
        this.currentIdx = this.areas.length - 1;
    }
}
