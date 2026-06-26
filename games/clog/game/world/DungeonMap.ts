import type { AreaConfig } from './AreaConfig';
import type { CardinalDir } from './Area';

// ── Room node ────────────────────────────────────────────────────────────────

export interface DungeonRoom {
    id: number;
    /** Grid position — each unit maps to (size/2 + neighbor.size/2) world units. */
    gridX: number;
    gridY: number;
    config: AreaConfig;
    /** Rooms reachable from this one keyed by exit direction. */
    connections: Partial<Record<CardinalDir, DungeonRoom>>;
    /** True once the player has left this room; all its gates lock permanently. */
    dirty: boolean;
}

// ── Room configs per depth ───────────────────────────────────────────────────
//
// Non-linear grind: gateValue grows much faster than foodValues, so the
// grind-to-gate ratio (gateValue / min-food) increases with depth.
//
// depth 0 (start): gate 0       → no gate, just the spawn room
// depth 1 (ring 1): gate 16     → food [2,4]  → ~4–8 pickups
// depth 2 (ring 1 alt): gate 32 → food [2,4]  → ~8–16 pickups
// depth 3: gate 128             → food [4]     → ~32 pickups
// depth 4: gate 512             → food [4,8]   → ~64–128 pickups
// depth 5: gate 2048            → food [8]     → ~256 pickups
// depth 6: gate 8192            → food [8,16]  → ~512–1024 pickups

const DEPTH_CONFIGS: AreaConfig[] = [
    { size: 40, gateValue: 0,    foodValues: [2]     }, // 0 — start room, gateValue unused
    { size: 44, gateValue: 16,   foodValues: [2, 4]  }, // 1
    { size: 44, gateValue: 32,   foodValues: [2, 4]  }, // 2
    { size: 52, gateValue: 128,  foodValues: [4]     }, // 3
    { size: 56, gateValue: 512,  foodValues: [4, 8]  }, // 4
    { size: 60, gateValue: 2048, foodValues: [8]     }, // 5
    { size: 64, gateValue: 8192, foodValues: [8, 16] }, // 6
];

// ── Generator ────────────────────────────────────────────────────────────────

const DIRS: CardinalDir[] = ['N', 'S', 'E', 'W'];
const DIR_DELTA: Record<CardinalDir, { dx: number; dy: number }> = {
    N: { dx:  0, dy:  1 },
    S: { dx:  0, dy: -1 },
    E: { dx:  1, dy:  0 },
    W: { dx: -1, dy:  0 },
};
export const OPPOSITE_DIR: Record<CardinalDir, CardinalDir> = {
    N: 'S', S: 'N', E: 'W', W: 'E',
};

export class DungeonMap {
    readonly start: DungeonRoom;
    private allRooms: DungeonRoom[] = [];
    private nextId = 0;

    constructor() {
        this.start = this.generate();
    }

    private makeRoom(gridX: number, gridY: number, depth: number): DungeonRoom {
        const cfgIdx = Math.min(depth, DEPTH_CONFIGS.length - 1);
        const room: DungeonRoom = {
            id: this.nextId++,
            gridX,
            gridY,
            config: DEPTH_CONFIGS[cfgIdx],
            connections: {},
            dirty: false,
        };
        this.allRooms.push(room);
        return room;
    }

    private generate(): DungeonRoom {
        // Start room — depth 0.
        const start = this.makeRoom(0, 0, 0);

        // First ring: 1× depth-1 (gate 16) and 3× depth-2 (gate 32).
        // Assign directions: N → depth 1, S/E/W → depth 2.
        const ring1Dirs: CardinalDir[] = ['N', 'S', 'E', 'W'];
        const ring1Depths = [1, 2, 2, 2];

        ring1Dirs.forEach((dir, i) => {
            const { dx, dy } = DIR_DELTA[dir];
            const child = this.makeRoom(dx, dy, ring1Depths[i]);
            start.connections[dir] = child;
            child.connections[OPPOSITE_DIR[dir]] = start;

            // Each depth-1/2 room gets 1–2 deeper exits (excluding the back door).
            const forwardDirs = DIRS.filter(d => d !== OPPOSITE_DIR[dir]);
            // Give the north (easiest) room 2 exits, others 1.
            const exitCount = dir === 'N' ? 2 : 1;
            let placed = 0;
            for (const fwd of forwardDirs) {
                if (placed >= exitCount) break;
                const { dx: fx, dy: fy } = DIR_DELTA[fwd];
                const nx = child.gridX + fx;
                const ny = child.gridY + fy;
                // Avoid collision with existing rooms.
                if (this.roomAt(nx, ny)) continue;
                const grandchild = this.makeRoom(nx, ny, ring1Depths[i] + 2);
                child.connections[fwd] = grandchild;
                grandchild.connections[OPPOSITE_DIR[fwd]] = child;
                placed++;
            }
        });

        return start;
    }

    private roomAt(gx: number, gy: number): DungeonRoom | undefined {
        return this.allRooms.find(r => r.gridX === gx && r.gridY === gy);
    }

    /** All rooms, useful for debugging/minimap. */
    get rooms(): readonly DungeonRoom[] { return this.allRooms; }
}
