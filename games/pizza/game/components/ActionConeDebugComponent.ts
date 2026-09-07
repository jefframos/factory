// ActionConeDebugComponent.ts
//
// Dev-only visualization for PlayerActionController's live hit cone (see
// AutoGatherController.getConeTargets(), the actual query this mirrors) —
// draws a flat wireframe pie-slice, radius hitRangeMeters, aperture
// hitAngleDeg, matching the character's actual visual forward — the same
// "real rotation, not the idealized facing target" direction
// getConeTargets() itself reads (see that method's own doc for why those
// can differ mid-swing). Rebuilt from ACTION_CONFIG every frame rather than
// only on change, since a shop upgrade mutates it live (see
// ShopTypes.applyShopLevel()) and this is debug-only — the rebuild cost
// doesn't matter here.
//
// Parented to entity.transform (world-space, scale always 1 — see
// Entity.ts), NOT to CharacterBody's own container: MainPlayer.ts scales
// that container down by CHARACTER_SCALE (0.0075) to fit the rig's own
// oversized FBX units, which would shrink a real hitRangeMeters-sized
// sector down to a barely-visible dot if parented there directly. Only the
// container's world ROTATION (its actual facing) is copied over each
// frame, never its scale.
//
// Gated behind PHYSICS_TRIGGER_DEBUG, the same "Debug Triggers" toggle the
// pizza web editor header already exposes (see PhysicsConstants.ts) — this
// is a hit-detection debug aid, not player-facing, and shares that flag
// rather than inventing a third one.

import * as THREE from 'three';
import Component from '../ecs/Component';
import CharacterVisualComponent from './CharacterVisualComponent';
import { ACTION_CONFIG, ActionType } from '../actions/ActionTypes';
import { PHYSICS_TRIGGER_DEBUG } from '../physics/PhysicsConstants';

/** Points along the arc — enough for a smooth-reading curve on a debug aid, no need for more. */
const ARC_SEGMENTS = 32;

export default class ActionConeDebugComponent extends Component {
    /** Which action's cone to draw — Chop (the axe) by default, since that's the one with a live shop ladder to verify against (see ToolRegistry.ts's TOOL_LIBRARY.axe.attributes). */
    private readonly action: ActionType;
    private line?: THREE.Line;

    public constructor(action: ActionType = ActionType.Chop) {
        super();
        this.action = action;
    }

    public update(): void {
        const character = this.entity.getComponent(CharacterVisualComponent)?.character;
        if (!PHYSICS_TRIGGER_DEBUG || !character) {
            this.removeLine();
            return;
        }

        const config = ACTION_CONFIG[this.action];
        const halfAngleRad = (config.hitAngleDeg * Math.PI / 180) / 2;
        const range = config.hitRangeMeters;

        // Local +Z is forward (parented to container — see this file's own doc): sin(angle)
        // sweeps sideways (X), cos(angle) sweeps forward (Z), swept from -halfAngle to
        // +halfAngle around that forward axis. Starts/ends at the origin so the sector reads
        // as a closed pie-slice, not just a bare arc.
        const points: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
        for (let i = 0; i <= ARC_SEGMENTS; i++) {
            const angle = -halfAngleRad + (2 * halfAngleRad) * (i / ARC_SEGMENTS);
            points.push(new THREE.Vector3(range * Math.sin(angle), 0, range * Math.cos(angle)));
        }
        points.push(new THREE.Vector3(0, 0, 0));

        if (!this.line) {
            this.line = new THREE.Line(
                new THREE.BufferGeometry(),
                new THREE.LineBasicMaterial({ color: 0x00ffff }),
            );
            this.entity.transform.add(this.line);
        }
        this.line.geometry.dispose();
        this.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
        // World rotation only — see this file's own doc for why the container's own scale must
        // NOT come along for the ride.
        character.container.getWorldQuaternion(this.line.quaternion);
    }

    private removeLine(): void {
        if (!this.line) {
            return;
        }
        this.line.geometry.dispose();
        (this.line.material as THREE.Material).dispose();
        this.line.removeFromParent();
        this.line = undefined;
    }

    public destroy(): void {
        this.removeLine();
    }
}
