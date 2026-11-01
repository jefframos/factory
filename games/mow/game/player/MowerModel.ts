// MowerModel.ts
//
// A walked mower's placeholder model (ui/mow.json `tools` without `ride`), in its own frame: centred on the cut point,
// on the ground, +Z ahead, `size` = [width, height, length]. Used by MowPlayer (with the world bend) and by the shop's
// icons (ModelIcons.object, without). The editor's Mowers tab builds the same (web/public/mowers.js buildTool()).
//
//   reel     a bladed barrel between two big wheels, a roller behind (the barrel spins: `reel`)
//   other    a long low deck on four wheels, a dark skirt under it, the engine — a cylinder with a cap — in its middle

import * as THREE from 'three';
import { GripDef, ToolDef } from '../data/MowConfig';

/** The push handle: tube radius, and how far the crossbar runs past each hand. */
export const HANDLE_RADIUS = 0.035;
export const BAR_OVERHANG = 0.12;
const UP = new THREE.Vector3(0, 1, 0);

/** Gap between the feet and a pushed tool's back edge (room for the handle and the walk), without the tool's `gap`. */
const TOOL_GAP = 0.7;
/** Where the hands hold a pushed tool's handle, without the tool's `grip`. */
const GRIP: GripDef = { forward: 0.42, height: 0.95, spread: 0.2 };

/** Where the hands hold a tool (its `grip`, or the default). */
export const toolGrip = (tool: ToolDef): GripDef => tool.grip ?? GRIP;

/** How far ahead of the feet a pushed tool's middle is. */
export const pushAhead = (tool: ToolDef): number => (tool.gap ?? TOOL_GAP) + tool.size[2] / 2;

/** The grip and where it is along the mower's own frame (from its middle). */
export function handleOf(tool: ToolDef): { grip: GripDef; gripZ: number } {
    const grip = toolGrip(tool);
    return { grip, gripZ: grip.forward - pushAhead(tool) };
}

/** A reel mower: its barrel's blades, and the wheels' size against the barrel. */
export const REEL_BLADES = 5;
export const REEL_WHEEL = 1.35;

export interface MowerModel {
    group: THREE.Group;
    /** A reel mower's barrel (spun by the distance walked). */
    reel?: THREE.Object3D;
    /** Where the handle's rails start (each side: ±x). */
    base: { x: number; y: number; z: number };
}

const cylinder = (radius: number, height: number, material: THREE.Material, segments = 16) =>
    new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);

/** `prepare` runs on every material (MowPlayer: the world bend). */
export function buildMower(tool: ToolDef, prepare: (material: THREE.Material) => void = () => {}): MowerModel {
    const group = new THREE.Group();
    const [width, height, length] = tool.size;
    const make = (params: THREE.MeshStandardMaterialParameters) => {
        const material = new THREE.MeshStandardMaterial(params);
        prepare(material);
        return material;
    };
    const body = make({ color: tool.color, roughness: 0.5 });
    const dark = make({ color: 0x2b2b30, roughness: 0.8 });
    if (tool.reel) {
        const steel = make({ color: 0xd9dde3, metalness: 0.6, roughness: 0.35 });
        const radius = height / 2;
        const wheelRadius = radius * REEL_WHEEL;
        const barrel = new THREE.Group();
        barrel.position.y = wheelRadius;
        const core = cylinder(radius * 0.35, width, body, 10);
        core.rotation.z = Math.PI / 2;
        barrel.add(core);
        // The blades: bars round the barrel, each slanted a little (the reel's twist).
        for (let i = 0; i < REEL_BLADES; i++) {
            const angle = (i / REEL_BLADES) * Math.PI * 2;
            const blade = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, radius * 0.3), steel);
            blade.position.set(0, Math.sin(angle) * radius * 0.85, Math.cos(angle) * radius * 0.85);
            blade.rotation.set(-angle, 0.18, 0, 'XYZ');
            barrel.add(blade);
        }
        group.add(barrel);
        for (const side of [-1, 1]) {
            const wheel = cylinder(wheelRadius, 0.05, dark);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(side * (width / 2 + 0.03), wheelRadius, 0);
            const hub = cylinder(wheelRadius * 0.45, 0.06, body, 12);
            hub.rotation.z = Math.PI / 2;
            hub.position.copy(wheel.position);
            group.add(wheel, hub);
        }
        const roller = cylinder(0.03, width, dark, 8);
        roller.rotation.z = Math.PI / 2;
        roller.position.set(0, 0.04, -length / 2);
        group.add(roller);
        return { group, reel: barrel, base: { x: width / 2 + 0.07, y: wheelRadius, z: 0 } };
    }

    const engineMetal = make({ color: 0x5a5e66, metalness: 0.5, roughness: 0.45 });
    const wheelRadius = Math.max(0.07, height * 0.2);
    const deckBottom = wheelRadius * 0.55;
    const deckHeight = height * 0.3;
    const deckTop = deckBottom + deckHeight;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, deckHeight, length), body);
    deck.position.y = deckBottom + deckHeight / 2;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(width * 1.04, 0.05, length * 1.03), dark);
    skirt.position.y = deckBottom;
    group.add(deck, skirt);
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const wheel = cylinder(wheelRadius, 0.06, dark);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(sx * (width / 2 + 0.03), wheelRadius, sz * (length / 2 - wheelRadius * 1.1));
            group.add(wheel);
        }
    }
    // The engine in the middle of the deck: a block-like cylinder, a darker cap, a coloured fuel cap.
    const engineRadius = Math.min(width, length) * 0.27;
    const engineHeight = height * 0.45;
    const engine = cylinder(engineRadius, engineHeight, engineMetal, 18);
    engine.position.set(0, deckTop + engineHeight / 2, -length * 0.04);
    const cap = cylinder(engineRadius * 0.72, height * 0.1, dark, 18);
    cap.position.set(0, deckTop + engineHeight + height * 0.05, engine.position.z);
    const fuel = cylinder(engineRadius * 0.18, height * 0.08, body, 10);
    fuel.position.set(engineRadius * 0.35, cap.position.y + height * 0.07, engine.position.z + engineRadius * 0.2);
    group.add(engine, cap, fuel);
    return { group, base: { x: 0, y: deckTop, z: -length / 2 + 0.08 } };
}

/** A handle tube from `a` to `b`. */
function tube(a: THREE.Vector3, b: THREE.Vector3, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, a.distanceTo(b), 8), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    return mesh;
}

/**
 * The push handle on `model`: rails from the deck's back corners (the reel's axle ends) up to a crossbar at the grip,
 * `gripZ` along the mower's frame (the grip's `forward` less how far ahead of the feet the mower's middle is).
 */
export function addHandle(model: MowerModel, tool: ToolDef, grip: GripDef, gripZ: number, material: THREE.Material): void {
    const { base } = model;
    const barHalf = grip.spread + BAR_OVERHANG;
    const railX = tool.reel ? base.x : Math.max(0.08, Math.min(tool.size[0] / 2 - 0.08, barHalf));
    for (const side of [-1, 1]) {
        model.group.add(tube(new THREE.Vector3(side * railX, base.y, base.z), new THREE.Vector3(side * barHalf, grip.height, gripZ), material));
    }
    model.group.add(tube(new THREE.Vector3(-barHalf - HANDLE_RADIUS, grip.height, gripZ), new THREE.Vector3(barHalf + HANDLE_RADIUS, grip.height, gripZ), material));
}
