// CharacterBody.ts
//
// The purely visual/animated half of a third-person character — mesh
// loading, the flat-color material fix (see FALLBACK_COLOR's own doc),
// head-cube attachment, and the idle/run/jump animation state graph. Owns
// no movement, no move-speed config, no jump timer, no player input — those
// live in ThirdPersonCharacter, the player-driven controller that wraps one
// of these (see that file). Kept separate so NPCs can reuse the exact same
// rig/animation setup directly, without dragging along anything
// player-specific (see PizzaScene's idle test NPCs).

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { CubeBuilder, colorForValue } from '../builders/CubeBuilder';
import { TextureBuilder } from '../builders/TextureBuilder';
import { ShopStorage, SHOP_ITEMS, resolveShopImagePath } from '../data/ShopStorage';
import { BendService } from '../services/BendService';
import AnimatorController from './animation/AnimatorController';

const ROTATION_SLERP = 0.15;
/**
 * Cube-head size in REAL world units (same units as the floor/camera —
 * see mountHeadCube(), which divides out the head bone's own inherited
 * scale so this is a true absolute size, not a guess relative to the rig's
 * raw/bone-local scale).
 */
const HEAD_CUBE_SIZE = 120;
/** Head-cube pivot/offset, in the SAME real world units as HEAD_CUBE_SIZE — (0,0,0) sits exactly at the head bone's own origin. Tune here, or live via setHeadOffset(). */
const HEAD_CUBE_OFFSET = new THREE.Vector3(0, 50, 0);

/**
 * This rig's FBX exports have no texture at all — no map, no embedded
 * media, nothing (confirmed: zero texture-filename strings anywhere in the
 * binary) — so the ORIGINAL materials are unusable as-is (whatever's left
 * multiplying the shading — a black base color, possibly baked-in black
 * vertex colors — reads as a flat silhouette no matter what map/color gets
 * bolted onto them). Simplest fix: replace them outright with a plain
 * flat-color MeshStandardMaterial — the exact same recipe
 * CubeBuilder.getSolidMaterial() uses for the cube player (`new
 * THREE.MeshStandardMaterial({ color })`, no map at all) — rather than
 * trying to patch the existing material's map/color/vertexColors.
 */
const FALLBACK_COLOR = 0xffffff;

export default class CharacterBody {
    public readonly container: THREE.Group = new THREE.Group();
    public readonly animator: AnimatorController = new AnimatorController();

    private mixer?: THREE.AnimationMixer;
    private targetRotation = new THREE.Quaternion();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private headCube?: THREE.Mesh;
    /** Wraps headCube — cancels the head bone's own inherited scale so HEAD_CUBE_SIZE/HEAD_CUBE_OFFSET are true world units, and gives setHeadOffset() something to reposition without touching the cube's own scale. */
    private headCubeHolder?: THREE.Group;
    private headBone?: THREE.Object3D;

    public async loadMesh(url: string): Promise<void> {
        const loader = new FBXLoader();
        const object = await loader.loadAsync(url);
        this.applyFallbackMaterial(object);
        this.container.add(object);

        this.mixer = new THREE.AnimationMixer(object);
        this.animator.setMixer(this.mixer);
    }

    /** See FALLBACK_COLOR's own doc — swaps every mesh straight onto a brand-new flat-color material, same recipe the cube player uses, instead of patching whatever the FBX itself shipped with. */
    private applyFallbackMaterial(object: THREE.Object3D): void {
        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) {
                return;
            }

            const materialCount = Array.isArray(child.material) ? child.material.length : 1;
            const flatMaterial = new THREE.MeshStandardMaterial({ color: FALLBACK_COLOR });
            // Hooked to the shared BendService uniform (same one the floor/head cube use)
            // so the whole scene bends/un-bends together from one place — see
            // BendService.setEnabled().
            BendService.applyBend(flatMaterial);

            child.material = materialCount > 1
                ? new Array(materialCount).fill(flatMaterial)
                : flatMaterial;
        });
    }

    public async registerAnimation(id: string, url: string): Promise<void> {
        return this.animator.registerAnimation(id, url);
    }

    /** Registers the idle/run/jump state graph — call once after loadMesh()/registerAnimation() for every clip below have resolved. NPCs that only ever register 'idle' can still call this safely: transitions referencing unregistered clips simply never fire (speed stays 0, grounded/verticalSpeed are never set to anything by an idling body — see update()). */
    public setUp(): void {
        this.animator.registerAnimatorBoard('idle');
        const board = this.animator.animatorBoard!;

        board.registerTransition('idle', 'run', 0.25, (vars) => (vars.speed as number) > 0.01 && vars.grounded === true);
        board.registerTransition('run', 'idle', 0.5, (vars) => (vars.speed as number) <= 0.01 && vars.grounded === true);

        board.registerTransition('falling', 'run', 0.15, (vars) => (vars.speed as number) > 0.01 && vars.grounded === true);
        board.registerTransition('landing', 'idle', 0.15, (vars) => (vars.speed as number) <= 0.01 && vars.grounded === true);

        board.registerTransition('any', 'jumpUp', 0.1, undefined, 'jump');
        board.registerTransition('jumpUp', 'falling', 0.5, (vars) => (vars.verticalSpeed as number) > 0.01);
        board.registerTransition('falling', 'landing', 0.25, (vars) => vars.grounded === true);
    }

    /** Recolors every body mesh (excluding the head cube) to an explicit hex color — shared by both the value-palette player path and the flat-tint NPC path below. */
    public setBodyColor(color: THREE.ColorRepresentation): void {
        this.container.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || child === this.headCube) {
                return;
            }

            const materials = Array.isArray(child.material) ? child.material : [child.material];

            for (const material of materials) {
                if (material instanceof THREE.MeshStandardMaterial) {
                    material.color.set(color);
                }
            }
        });
    }

    /**
     * Player path: colors the body + attaches a CubeBuilder cube (same
     * look/number/FACE as the real player cube — see CubeBuilder.buildPlayer)
     * matching `value`'s palette color (see colorForValue), with its face
     * decal kept in sync with the currently-equipped shop skin.
     */
    public applyValueColor(value: number): void {
        this.setBodyColor(colorForValue(value));
        this.mountHeadCube(CubeBuilder.buildPlayer(value, HEAD_CUBE_SIZE), true);
    }

    /**
     * NPC path: colors the body + attaches a plain flat-color cube head —
     * no face decal, no equipped-skin syncing (NPCs don't have a shop
     * skin). See PizzaScene's enemy test NPCs for the intended use — a
     * flat red tone to visually mark them as hostile.
     */
    public applyFlatColor(color: number): void {
        this.setBodyColor(color);

        const geometry = new THREE.BoxGeometry(HEAD_CUBE_SIZE, HEAD_CUBE_SIZE, HEAD_CUBE_SIZE);
        const material = new THREE.MeshStandardMaterial({ color });
        BendService.applyBend(material);
        this.mountHeadCube(new THREE.Mesh(geometry, material), false);
    }

    /**
     * Parents `cube` onto whichever bone is actually named "Head", wrapped
     * in a holder that cancels the bone's own inherited scale — replaces
     * any previously-attached one. No-op (leaves the FBX's own head
     * showing) if no such bone is found. `syncEquippedFace` opts into the
     * live equipped-shop-skin face decal (player only — see
     * applyValueColor/applyFlatColor).
     */
    private mountHeadCube(cube: THREE.Mesh, syncEquippedFace: boolean): void {
        this.removeHeadCube();

        const headBone = this.findHeadBone();

        if (!headBone) {
            console.warn('CharacterBody: no "Head" bone found — skipping cube head.');
            return;
        }

        this.headBone = headBone;

        const holder = new THREE.Group();
        headBone.add(holder);
        holder.add(cube);

        this.headCubeHolder = holder;
        this.headCube = cube;

        this.applyHeadTransform();

        if (syncEquippedFace) {
            // Same equipped-skin texture PlayerEntity.applyEquippedSkin() puts
            // on the real player cube's face — kept in sync live via
            // ShopStorage.onEquipChanged, so the head cube never shows a
            // different face than the actual player.
            void this.applyEquippedFace();
            ShopStorage.onEquipChanged.add(this.applyEquippedFace, this);
        }
    }

    /** Loads whichever skin is CURRENTLY equipped (ignores `itemId` — always re-reads ShopStorage.getEquippedSkinId(), so this doubles as both the initial load and the onEquipChanged live-update handler) and swaps it onto the head cube's face decal. */
    private applyEquippedFace = async (): Promise<void> => {
        if (!this.headCube) {
            return;
        }

        const item = SHOP_ITEMS.find(i => i.id === ShopStorage.getEquippedSkinId());

        if (!item) {
            return;
        }

        try {
            const texture = await TextureBuilder.load(resolveShopImagePath(item.texture));
            CubeBuilder.setFaceTexture(this.headCube, texture);
        } catch (e) {
            console.error('CharacterBody: failed to load equipped skin texture', e);
        }
    };

    /**
     * Repositions the head cube live — same real-world units as
     * HEAD_CUBE_SIZE/HEAD_CUBE_OFFSET, (0,0,0) at the head bone's own
     * origin. No-op if applyValueColor()/applyFlatColor() hasn't run yet.
     */
    public setHeadOffset(x: number, y: number, z: number): void {
        HEAD_CUBE_OFFSET.set(x, y, z);
        this.applyHeadTransform();
    }

    /**
     * Bones in this rig carry their own (often large) inherited scale, so a
     * fixed geometry size/offset renders unpredictably depending on which
     * bone it's parented to. getWorldScale() gives the bone's TRUE
     * cumulative scale (all ancestors, all the way up) — dividing it out on
     * the HOLDER (not the cube itself) means HEAD_CUBE_SIZE stays exactly
     * what the cube was actually built with (so the face decal/number glyph
     * aren't stretched), while HEAD_CUBE_OFFSET is still a true world-unit
     * position — not a guess that has to be re-tuned every time the rig or
     * its parent scale changes.
     */
    private applyHeadTransform(): void {
        if (!this.headCubeHolder || !this.headBone) {
            return;
        }

        const boneWorldScale = new THREE.Vector3();
        this.headBone.getWorldScale(boneWorldScale);

        this.headCubeHolder.scale.set(1 / boneWorldScale.x, 1 / boneWorldScale.y, 1 / boneWorldScale.z);
        this.headCubeHolder.position.set(
            HEAD_CUBE_OFFSET.x / boneWorldScale.x,
            HEAD_CUBE_OFFSET.y / boneWorldScale.y,
            HEAD_CUBE_OFFSET.z / boneWorldScale.z,
        );
    }

    private removeHeadCube(): void {
        ShopStorage.onEquipChanged.remove(this.applyEquippedFace, this);

        if (!this.headCubeHolder) {
            return;
        }

        this.headCubeHolder.parent?.remove(this.headCubeHolder);
        this.headCube?.geometry.dispose();
        this.headCubeHolder = undefined;
        this.headCube = undefined;
    }

    private findHeadBone(): THREE.Object3D | undefined {
        let found: THREE.Object3D | undefined;

        this.container.traverse((child) => {
            if (found) {
                return;
            }

            if (child.name === 'Head' || child.name.toLowerCase() === 'head') {
                found = child;
            }
        });

        return found;
    }

    /**
     * Call once per frame. `moveInputX`/`moveInputZ` drive facing rotation
     * and the 'speed' animator variable (both default to 0 — an idle NPC
     * can just call `body.update(delta)` every frame and never rotate or
     * leave its initial 'idle' state). `extraVars` lets a controller inject
     * additional animator variables (e.g. verticalSpeed/grounded for jump)
     * before the state machine evaluates this frame's transitions.
     */
    public update(delta: number, moveInputX: number = 0, moveInputZ: number = 0, extraVars: Record<string, number | boolean> = {}): void {
        if (moveInputX !== 0 || moveInputZ !== 0) {
            this.targetRotation.setFromAxisAngle(this.up, Math.atan2(moveInputX, moveInputZ));
        }
        this.container.quaternion.slerp(this.targetRotation, ROTATION_SLERP);

        const speed = Math.hypot(moveInputX, moveInputZ);
        this.animator.animatorBoard?.setVariable('speed', speed);

        for (const [name, value] of Object.entries(extraVars)) {
            this.animator.animatorBoard?.setVariable(name, value);
        }

        this.animator.update(delta);
    }

    public destroy(): void {
        this.removeHeadCube();
        this.container.parent?.remove(this.container);
        this.mixer?.stopAllAction();
    }
}
