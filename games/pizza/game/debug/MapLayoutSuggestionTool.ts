// MapLayoutSuggestionTool.ts
//
// Dev-only tool (see PizzaScene's 'Map Layout Suggestions' dat.GUI folder) —
// draws a ghost overlay of a hand-tuned zone-layout archetype directly on
// top of the live map, at the SAME world-unit scale the real Tiled map uses
// (WORLD_UNITS_PER_TILE, see TileMapConfig.ts) so a designer can eyeball a
// suggested arrangement against whatever's actually placed today, then move
// real zones/objects in Tiled to match. Nothing here spawns real game
// objects or touches the map file — it's a floor-decal sketch, same
// baked-canvas-plane technique DottedLineBuilder already uses for zone
// outlines, cleared with one button.
//
// Three archetypes, not a random scatter — each is a real design stance
// (see ARCHETYPES' own doc), and "Shuffle" only jitters positions WITHIN an
// archetype's own layout rules, never picks a fresh arrangement out of thin
// air.

import * as THREE from 'three';
import { DottedLineBuilder } from '../builders/DottedLineBuilder';
import { WORLD_UNITS_PER_TILE } from '../world/TileMapConfig';

export type MapLayoutArchetype = 'loop' | 'ring' | 'valley';

interface ZoneSpec {
    key: 'spawn' | 'hub' | 'shop' | 'mart' | 'craft' | 'farm' | 'queue' | 'gate' | 'wall';
    col: number;
    row: number;
    w: number;
    h: number;
    /** Distinguishes multiple same-key zones (queue 1 vs queue 2) for path-order lookups. */
    n?: number;
}

interface Archetype {
    label: string;
    /** One-line rationale shown in the console when the suggestion is drawn. */
    blurb: string;
    zones: ZoneSpec[];
    /** Zone keys (optionally suffixed with `n`, e.g. "queue2") walked in order to draw the suggested-path dashed lines. */
    path: string[];
}

const ZONE_COLOR: Record<ZoneSpec['key'], number> = {
    spawn: 0x23282f,
    hub: 0x7a5230,
    shop: 0xc94420,
    mart: 0xc98a2c,
    farm: 0x3f7a5c,
    craft: 0x3f6f8a,
    queue: 0x8a4a78,
    gate: 0xd9622e,
    wall: 0x5c6357,
};

/**
 * Grid coordinates are in TILE units (1 cell = 1 Tiled tile = WORLD_UNITS_PER_TILE world
 * units) so this overlay lines up with the real map's own grid regardless of map size.
 * Same three stances as the standalone map-layout artifact this tool replaces in-editor.
 */
const ARCHETYPES: Record<MapLayoutArchetype, Archetype> = {
    loop: {
        label: 'Compact Loop',
        blurb: 'Everything inside a two-minute walk of spawn — fast pick, quickly hooked.',
        zones: [
            { key: 'spawn', col: 14, row: 10, w: 1, h: 1 },
            { key: 'hub', col: 12, row: 6, w: 4, h: 4 },
            { key: 'shop', col: 17, row: 7, w: 2, h: 2 },
            { key: 'mart', col: 17, row: 11, w: 2, h: 2 },
            { key: 'craft', col: 9, row: 11, w: 3, h: 2 },
            { key: 'farm', col: 8, row: 2, w: 6, h: 4 },
            { key: 'queue', col: 19, row: 5, w: 1, h: 1, n: 1 },
            { key: 'queue', col: 19, row: 14, w: 1, h: 1, n: 2 },
            { key: 'queue', col: 6, row: 9, w: 1, h: 1, n: 3 },
            { key: 'gate', col: 24, row: 10, w: 1, h: 2 },
        ],
        path: ['spawn', 'hub', 'shop', 'mart', 'craft', 'farm'],
    },
    ring: {
        label: 'Ring Around the Keep',
        blurb: 'Wall + gates do real RequirementRegistry work; farm sits outside the walls.',
        zones: [
            { key: 'wall', col: 9, row: 4, w: 12, h: 10 },
            { key: 'spawn', col: 14, row: 13, w: 1, h: 1 },
            { key: 'hub', col: 11, row: 6, w: 5, h: 5 },
            { key: 'shop', col: 17, row: 6, w: 2, h: 2 },
            { key: 'mart', col: 8, row: 10, w: 2, h: 2 },
            { key: 'craft', col: 17, row: 10, w: 2, h: 2 },
            { key: 'gate', col: 13, row: 4, w: 2, h: 1 },
            { key: 'gate', col: 20, row: 8, w: 1, h: 2 },
            { key: 'farm', col: 1, row: 12, w: 6, h: 5 },
            { key: 'queue', col: 14, row: 1, w: 1, h: 1, n: 1 },
            { key: 'queue', col: 23, row: 8, w: 1, h: 1, n: 2 },
        ],
        path: ['spawn', 'hub', 'shop', 'craft', 'mart'],
    },
    valley: {
        label: 'Sprawling Valley',
        blurb: 'Spawn to a far gate, left to right — built for longer sessions / prestige.',
        zones: [
            { key: 'spawn', col: 2, row: 9, w: 1, h: 1 },
            { key: 'queue', col: 5, row: 9, w: 1, h: 1, n: 1 },
            { key: 'shop', col: 8, row: 6, w: 2, h: 2 },
            { key: 'craft', col: 8, row: 11, w: 2, h: 2 },
            { key: 'hub', col: 12, row: 6, w: 4, h: 4 },
            { key: 'mart', col: 18, row: 9, w: 2, h: 2 },
            { key: 'farm', col: 22, row: 4, w: 6, h: 5 },
            { key: 'queue', col: 21, row: 12, w: 1, h: 1, n: 2 },
            { key: 'gate', col: 28, row: 8, w: 1, h: 2 },
        ],
        path: ['spawn', 'queue1', 'shop', 'craft', 'hub', 'mart', 'farm'],
    },
};

/** mulberry32 — deterministic per (archetype, seed) so "Shuffle" is reproducible, not just noisy. */
function rng(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeLabel(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2 + 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.2, 0.55, 1);
    sprite.renderOrder = 20;
    return sprite;
}

export class MapLayoutSuggestionTool {
    public static readonly settings: { archetype: MapLayoutArchetype; seed: number } = {
        archetype: 'loop',
        seed: 1,
    };

    private static group: THREE.Group | null = null;

    /** Draws (replacing any existing overlay) the currently selected archetype at the current seed. */
    public static show(scene: THREE.Scene): void {
        MapLayoutSuggestionTool.clear();

        const archetype = ARCHETYPES[MapLayoutSuggestionTool.settings.archetype];
        const rand = rng(MapLayoutSuggestionTool.settings.seed * 977);
        const unit = WORLD_UNITS_PER_TILE;

        const group = new THREE.Group();
        group.name = 'MapLayoutSuggestion';

        // Wall and gates keep the archetype's exact rules — jittering them could open a gate
        // into open air or bend a wall around nothing. Every other zone gets a small nudge so
        // "Shuffle" reads as a fresh variant, not the same fixed screenshot every time.
        const placed = archetype.zones.map(z => {
            const jitterAmount = z.key === 'wall' || z.key === 'gate' ? 0 : 1;
            const jitter = () => Math.round((rand() - 0.5) * 2 * jitterAmount);
            return { ...z, col: z.col + jitter(), row: z.row + jitter() };
        });

        const centerOf = (z: ZoneSpec) => new THREE.Vector2((z.col + z.w / 2) * unit, (z.row + z.h / 2) * unit);

        for (const zone of placed) {
            const color = ZONE_COLOR[zone.key];
            const center = centerOf(zone);

            if (zone.key === 'spawn') {
                const marker = DottedLineBuilder.buildCircle(0.6, { color, y: 0.12 });
                marker.position.set(center.x, 0, center.y);
                group.add(marker);
                continue;
            }

            const width = zone.w * unit;
            const depth = zone.h * unit;
            const lineWidth = zone.key === 'wall' ? 0.35 : 0.15;
            const outline = DottedLineBuilder.buildRoundedRect(width, depth, 0.4, {
                color,
                y: 0.12,
                lineWidth,
                dashLength: zone.key === 'wall' ? 0.6 : 0.25,
                gapLength: zone.key === 'wall' ? 0.3 : 0.2,
            });
            outline.position.set(center.x, 0, center.y);
            group.add(outline);

            if (zone.key !== 'gate') {
                const label = makeLabel(zone.key + (zone.n ?? ''), color);
                label.position.set(center.x, 1.4, center.y);
                group.add(label);
            }
        }

        const zoneAt = (ref: string) => {
            const match = ref.match(/\d+$/);
            const n = match ? Number(match[0]) : undefined;
            const key = ref.replace(/\d+$/, '') as ZoneSpec['key'];
            return placed.find(z => z.key === key && (n === undefined || z.n === n));
        };

        let prev = zoneAt('spawn');
        for (const ref of archetype.path.slice(1)) {
            const next = zoneAt(ref);
            if (prev && next) {
                const line = DottedLineBuilder.buildLine(centerOf(prev), centerOf(next), {
                    color: 0x23282f, opacity: 0.4, y: 0.09, lineWidth: 0.1,
                });
                group.add(line);
            }
            prev = next ?? prev;
        }

        scene.add(group);
        MapLayoutSuggestionTool.group = group;
        console.log(`[MapLayoutSuggestionTool] ${archetype.label} (seed ${MapLayoutSuggestionTool.settings.seed}) — ${archetype.blurb}`);
    }

    /** Re-rolls the seed and redraws the same archetype — no-op if nothing's currently shown. */
    public static reroll(scene: THREE.Scene): void {
        if (!MapLayoutSuggestionTool.group) {
            return;
        }
        MapLayoutSuggestionTool.settings.seed += 1;
        MapLayoutSuggestionTool.show(scene);
    }

    /** Removes the overlay, disposing every baked material/geometry it owns (the DottedLineBuilder textures themselves are cached/shared — see that file's own doc — and are never disposed here). */
    public static clear(): void {
        if (!MapLayoutSuggestionTool.group) {
            return;
        }
        MapLayoutSuggestionTool.group.traverse(child => {
            if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
                child.geometry?.dispose?.();
                const material = child.material as THREE.Material | THREE.Material[];
                (Array.isArray(material) ? material : [material]).forEach(m => m.dispose());
            }
        });
        MapLayoutSuggestionTool.group.removeFromParent();
        MapLayoutSuggestionTool.group = null;
    }
}
