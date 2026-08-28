// FarmPlotTile.ts
//
// One croppable CELL of an owned farm plot — see FarmGrid.ts's own doc for
// why a plot is a grid of these instead of one giant patch. Spawned once
// per FarmGrid.computeFarmGrid() cell, only AFTER the plot's own FarmZone
// has been bought (see FarmZone.ts's own doc: buying destroys the whole-
// area FarmZone entity and its single big trigger, replacing it with one
// FarmPlotTile per cell, each with its own small collider) — a plot already
// owned from a previous session spawns straight into this state at boot
// (see PizzaScene.spawnFarmGrid()), no FarmZone/purchase step at all.
//
// Renders FARM_TILE_CONFIG.prepared, sized to exactly one map tile
// (FarmGrid.FARM_GRID_CELL_SIZE) — this is the extension point for actual
// planting/growing/harvesting (CropTypes.ts): a future interaction would
// read/write THIS entity's own per-cell state, not anything on the plot as
// a whole, which is the entire reason the grid exists instead of a single
// plot-wide "prepared" flag. Not implemented yet.
//
// Pops in with a small scale-up tween (see appearDelaySec) instead of a hard
// cut — PizzaScene.spawnFarmGrid() staggers each cell's own delay by its
// index in the grid, so a freshly-bought plot's tiles visibly ripple in one
// after another rather than all snapping into existence on the same frame.
// The collider itself is live from the very first frame regardless (only
// the VISUAL scale animates) — same "cosmetic only" scope as every other
// appear/reveal animation in this game (see ZoneVisibilityManager's own
// rise animation).

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import BoxVisualComponent from '../components/BoxVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { FARM_TILE_CONFIG } from '../data/FarmTypes';
import { resolveEntityView } from './EntityViewRegistry';
import { FARM_GRID_CELL_SIZE } from './FarmGrid';

/** Green — an owned, ready-to-use cell, distinct from FarmZone's own red "not bought yet" outline (see that file's own doc). Hidden by default (see this file's own doc on `setVisible`) rather than removed — a future "select a tile to plant" interaction can flip it back on without rebuilding the component. */
const FARM_TILE_OUTLINE_COLOR = 0x55cc55;
const FARM_TILE_CORNER_RADIUS = 0.2;
const PLACEHOLDER_HEIGHT = 0.1;
const PLACEHOLDER_COLOR = 0x7a5a3a;
const APPEAR_DURATION_SEC = 0.35;

export default class FarmPlotTile extends Entity {
    /** This cell's plot id + grid position — not read by anything yet, kept for whichever future planting interaction needs to key its own per-cell state off a stable identity. */
    public readonly farmId: string;
    public readonly col: number;
    public readonly row: number;
    /** Seconds to wait before this cell's own pop-in tween starts — see this file's own top doc. 0 = no stagger (pops in immediately on its own first frame). */
    private readonly appearDelaySec: number;

    public constructor(position: THREE.Vector3, farmId: string, col: number, row: number, appearDelaySec = 0) {
        super();
        this.farmId = farmId;
        this.col = col;
        this.row = row;
        this.appearDelaySec = appearDelaySec;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        const halfExtents = new THREE.Vector3(FARM_GRID_CELL_SIZE / 2, PLACEHOLDER_HEIGHT, FARM_GRID_CELL_SIZE / 2);
        const centerOffset = new THREE.Vector3(0, halfExtents.y, 0);

        // A trigger, not solid — a planted/growing cell shouldn't block the player from walking
        // over it any more than an empty one does (see FarmZone's own footprint, also
        // trigger-only); this is purely the future interaction area (walk up to plant/harvest).
        this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset,
        }));

        const outline = this.addComponent(new DottedZoneVisualComponent(
            FARM_GRID_CELL_SIZE,
            FARM_GRID_CELL_SIZE,
            FARM_TILE_CORNER_RADIUS,
            { color: FARM_TILE_OUTLINE_COLOR },
        ));
        // Hidden for now (see FARM_TILE_OUTLINE_COLOR's own doc) — kept, not removed, so it's
        // ready to flip back on later with no rebuild.
        outline.setVisible(false);

        this.transform.scale.setScalar(0);
        gsap.to(this.transform.scale, {
            x: 1, y: 1, z: 1,
            duration: APPEAR_DURATION_SEC,
            delay: this.appearDelaySec,
            ease: 'back.out(2)',
        });

        const resolved = resolveEntityView(FARM_TILE_CONFIG.prepared);
        if (resolved) {
            const [offsetX, offsetY, offsetZ] = resolved.offset;
            this.addComponent(new GlbVisualComponent(
                resolved.model,
                new THREE.Vector3(offsetX, offsetY, offsetZ),
                resolved.scale,
                THREE.MathUtils.degToRad(resolved.rotationDeg),
            ));
            return;
        }

        this.addComponent(new BoxVisualComponent(
            new THREE.Vector3(FARM_GRID_CELL_SIZE, PLACEHOLDER_HEIGHT, FARM_GRID_CELL_SIZE),
            PLACEHOLDER_COLOR,
            new THREE.Vector3(0, PLACEHOLDER_HEIGHT / 2, 0),
        ));
    }
}
