import * as THREE from "three";
import { Area, CardinalDir } from "./Area";
import { DungeonMap, DungeonRoom, OPPOSITE_DIR } from "./DungeonMap";
import type { PlayerEntity } from "../entities/PlayerEntity";

const TRANSITION_BUFFER = 2.5;

export interface AreaTransitionData {
    foodValues: number[];
    halfSize: number;
    center: THREE.Vector2;
}

// ── World-space helpers ──────────────────────────────────────────────────────

function roomWorldPos(room: DungeonRoom, map: DungeonMap): { wx: number; wz: number } {
    // Walk the grid starting from start (0,0) at world origin.
    // We need to account for variable room sizes, so we resolve positions by
    // traversing the graph and summing half-sizes along each edge.
    const visited = new Map<number, { wx: number; wz: number }>();
    const queue: Array<{ room: DungeonRoom; wx: number; wz: number }> = [
        { room: map.start, wx: 0, wz: 0 },
    ];
    visited.set(map.start.id, { wx: 0, wz: 0 });

    while (queue.length > 0) {
        const { room: cur, wx, wz } = queue.shift()!;
        for (const [dir, neighbor] of Object.entries(cur.connections) as [CardinalDir, DungeonRoom][]) {
            if (visited.has(neighbor.id)) continue;
            const halfA = cur.config.size / 2;
            const halfB = neighbor.config.size / 2;
            const offset = halfA + halfB;
            let nx = wx, nz = wz;
            // Matches Area.ts convention: N gate is at +Z, S gate at -Z.
            if (dir === 'N') nz += offset;
            if (dir === 'S') nz -= offset;
            if (dir === 'E') nx += offset;
            if (dir === 'W') nx -= offset;
            visited.set(neighbor.id, { wx: nx, wz: nz });
            queue.push({ room: neighbor, wx: nx, wz: nz });
        }
    }

    return visited.get(room.id) ?? { wx: 0, wz: 0 };
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class AreaManager {
    private scene: THREE.Scene;
    private dungeonMap: DungeonMap;

    /** Live Area instances keyed by room id. */
    private liveAreas = new Map<number, Area>();

    private currentRoom: DungeonRoom;
    /** World-space positions keyed by room id. */
    private worldPositions = new Map<number, { wx: number; wz: number }>();

    public onTransition?: (data: AreaTransitionData) => void;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.dungeonMap = new DungeonMap();
        this.currentRoom = this.dungeonMap.start;

        // Pre-compute world positions for all rooms.
        for (const room of this.dungeonMap.rooms) {
            this.worldPositions.set(room.id, roomWorldPos(room, this.dungeonMap));
        }

        // Build the start area.
        const startPos = this.worldPositions.get(this.currentRoom.id)!;
        const startArea = new Area(this.currentRoom.config, startPos.wx, startPos.wz, scene);
        // No gates to lock on the start room initially; gateValue 0 means all gates open.
        this.liveAreas.set(this.currentRoom.id, startArea);
    }

    // ── Public accessors ──────────────────────────────────────────────────────

    get foodValues(): number[] { return this.currentRoom.config.foodValues; }
    get spawnHalfSize(): number { return this.currentRoom.config.size / 2 - 5; }
    get spawnCenter(): THREE.Vector2 {
        const pos = this.worldPositions.get(this.currentRoom.id)!;
        return new THREE.Vector2(pos.wx, pos.wz);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(player: PlayerEntity): void {
        const area = this.liveAreas.get(this.currentRoom.id);
        if (!area) return;

        area.resolveCollisions(player.position, player.collisionRadius, player.value);

        const exitDir = this.detectExit(player.position);
        if (exitDir) this.transition(exitDir);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private detectExit(pos: THREE.Vector3): CardinalDir | null {
        const curPos = this.worldPositions.get(this.currentRoom.id)!;
        const s = this.currentRoom.config.size / 2;
        // Matches Area.ts gate placement: N gate at z = cz+s, S gate at z = cz-s.
        if (pos.z > curPos.wz + s + TRANSITION_BUFFER) return 'N';
        if (pos.z < curPos.wz - s - TRANSITION_BUFFER) return 'S';
        if (pos.x > curPos.wx + s + TRANSITION_BUFFER) return 'E';
        if (pos.x < curPos.wx - s - TRANSITION_BUFFER) return 'W';
        return null;
    }

    private transition(exitDir: CardinalDir): void {
        const nextRoom = this.currentRoom.connections[exitDir];
        if (!nextRoom) return; // no room in that direction

        const oldRoom = this.currentRoom;
        const oldArea = this.liveAreas.get(oldRoom.id)!;

        // Mark old room dirty — lock ALL its gates permanently.
        if (!oldRoom.dirty) {
            oldRoom.dirty = true;
            for (const dir of (['N', 'S', 'E', 'W'] as CardinalDir[])) {
                oldArea.lockGate(dir);
            }
        }

        // Destroy old area geometry (it's fully sealed).
        oldArea.destroy(this.scene);
        this.liveAreas.delete(oldRoom.id);

        // Build the next area if it isn't already live.
        let nextArea = this.liveAreas.get(nextRoom.id);
        if (!nextArea) {
            const nextPos = this.worldPositions.get(nextRoom.id)!;
            nextArea = new Area(nextRoom.config, nextPos.wx, nextPos.wz, this.scene);
            this.liveAreas.set(nextRoom.id, nextArea);
        }

        // Lock the back gate in the new area so the player can't return.
        nextArea.lockGate(OPPOSITE_DIR[exitDir]);

        this.currentRoom = nextRoom;

        const nextPos = this.worldPositions.get(nextRoom.id)!;
        const halfSize = nextRoom.config.size / 2 - 5;
        this.onTransition?.({
            foodValues: nextRoom.config.foodValues,
            halfSize,
            center: new THREE.Vector2(nextPos.wx, nextPos.wz),
        });
    }
}
