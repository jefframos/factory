// CharacterBody.ts
//
// The purely visual/animated half of a third-person character — mesh
// loading, the flat-color material fix (see FALLBACK_COLOR's own doc), the
// smooth rounded head with a simple face decal, and the idle/walk/run/jump/
// roll animation state graph. Owns no movement, no move-speed config, no
// player input — those live in ThirdPersonCharacter, the player-driven
// controller that wraps one of these.

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BendService } from '../services/BendService';
import AnimatorController from './animation/AnimatorController';
import { loadCompressedFile, releaseObjectURL } from '../utils/GzipLoader';

const ROTATION_SLERP = 0.15;
/** Head size in REAL world units (same units as the floor/camera). */
const HEAD_CUBE_SIZE = 120;
/** Head pivot/offset, in the SAME real world units as HEAD_CUBE_SIZE — (0,0,0) sits exactly at the head bone's own origin. */
const HEAD_CUBE_OFFSET = new THREE.Vector3(0, 50, 0);
/** Face-decal plane, relative to HEAD_CUBE_SIZE — a plane just in front of the head's +Z face. */
const FACE_DECAL_SCALE = 0.85;

/**
 * This rig's FBX exports have no texture at all, so the ORIGINAL materials
 * are unusable as-is — replaced outright with a plain flat-color
 * MeshStandardMaterial instead of trying to patch the existing material.
 */
const FALLBACK_COLOR = 0xffffff;

export default class CharacterBody {
    public readonly container: THREE.Group = new THREE.Group();
    public readonly animator: AnimatorController = new AnimatorController();

    private mixer?: THREE.AnimationMixer;
    private targetRotation = new THREE.Quaternion();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private headCube?: THREE.Mesh;
    /** Wraps headCube — cancels the head bone's own inherited scale so HEAD_CUBE_SIZE/HEAD_CUBE_OFFSET are true world units. */
    private headCubeHolder?: THREE.Group;
    private headBone?: THREE.Object3D;

    public async loadMesh(url: string): Promise<void> {
        const resolvedUrl = await loadCompressedFile(url);
        try {
            const loader = new FBXLoader();
            const object = await loader.loadAsync(resolvedUrl);
            this.applyFallbackMaterial(object);
            this.container.add(object);

            this.mixer = new THREE.AnimationMixer(object);
            this.animator.setMixer(this.mixer);
        } finally {
            releaseObjectURL(resolvedUrl);
        }
    }

    /** See FALLBACK_COLOR's own doc — swaps every mesh onto a brand-new flat-color material. */
    private applyFallbackMaterial(object: THREE.Object3D): void {
        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) {
                return;
            }

            const materialCount = Array.isArray(child.material) ? child.material.length : 1;
            const flatMaterial = new THREE.MeshStandardMaterial({ color: FALLBACK_COLOR });
            BendService.applyBend(flatMaterial);

            child.material = materialCount > 1
                ? new Array(materialCount).fill(flatMaterial)
                : flatMaterial;
        });
    }

    public async registerAnimation(id: string, url: string): Promise<void> {
        return this.animator.registerAnimation(id, url);
    }

    /**
     * Registers the idle/walk/run/jump/roll state graph — call once after
     * loadMesh()/registerAnimation() for every clip below have resolved.
     *
     * `idleToWalkSpeed`/`walkToRunSpeed` split vars.speed into three bands
     * (idle / walk / run). vars.speed is the raw move-input magnitude (0-1,
     * see update()), not a world-units/sec speed.
     */
    public setUp(idleToWalkSpeed = 0.01, walkToRunSpeed = 0.75): void {
        this.animator.registerAnimatorBoard('idle');
        const board = this.animator.animatorBoard!;

        board.registerTransition('idle', 'walk', 0.25, (vars) => (vars.speed as number) > idleToWalkSpeed && (vars.speed as number) < walkToRunSpeed && vars.grounded === true);
        board.registerTransition('idle', 'run', 0.25, (vars) => (vars.speed as number) >= walkToRunSpeed && vars.grounded === true);
        board.registerTransition('walk', 'idle', 0.25, (vars) => (vars.speed as number) <= idleToWalkSpeed && vars.grounded === true);
        board.registerTransition('walk', 'run', 0.25, (vars) => (vars.speed as number) >= walkToRunSpeed && vars.grounded === true);
        board.registerTransition('run', 'walk', 0.25, (vars) => (vars.speed as number) < walkToRunSpeed && (vars.speed as number) > idleToWalkSpeed && vars.grounded === true);
        board.registerTransition('run', 'idle', 0.5, (vars) => (vars.speed as number) <= idleToWalkSpeed && vars.grounded === true);

        board.registerTransition('falling', 'run', 0.15, (vars) => (vars.speed as number) >= walkToRunSpeed && vars.grounded === true);
        board.registerTransition('falling', 'walk', 0.15, (vars) => (vars.speed as number) > idleToWalkSpeed && (vars.speed as number) < walkToRunSpeed && vars.grounded === true);
        board.registerTransition('landing', 'idle', 0.15, (vars) => (vars.speed as number) <= idleToWalkSpeed && vars.grounded === true);

        // jumpUp/falling/landing/roll/slide are all one-shot poses (loop=false, the trailing
        // argument below) — they play through once and hold their last frame instead of
        // restarting from frame 0 every time the clip reaches its own end. Without this,
        // whichever of these outlasts its own clip's short duration (jumpUp across a real
        // jump's ascent, falling across however long the actual drop takes) would keep
        // LOOPING for the rest of that state — a visible restart-stutter, not a smooth arc.
        board.registerTransition('any', 'jumpUp', 0.1, undefined, 'jump', false);
        // Real physics gives verticalSpeed a big positive value the instant the jump starts,
        // so a "> 0" check here would fire on the very next tick — cutting jumpUp's own 0.1s
        // crossfade-in off after ~one frame and immediately re-crossfading into falling on
        // top of it (three actions fighting for weight at once), which is what read as a
        // glitch. <= 0 instead waits for the actual apex/descent, giving jumpUp the whole
        // ascent to play and falling a clean, uncontested crossfade of its own.
        board.registerTransition('jumpUp', 'falling', 0.5, (vars) => (vars.verticalSpeed as number) <= 0, undefined, false);
        board.registerTransition('falling', 'landing', 0.25, (vars) => vars.grounded === true, undefined, false);

        board.registerTransition('any', 'roll', 0.1, undefined, 'roll', false);
        board.registerTransition('roll', 'idle', 0.2, (vars) => vars.rolling === false && (vars.speed as number) <= idleToWalkSpeed);
        board.registerTransition('roll', 'walk', 0.2, (vars) => vars.rolling === false && (vars.speed as number) > idleToWalkSpeed && (vars.speed as number) < walkToRunSpeed);
        board.registerTransition('roll', 'run', 0.2, (vars) => vars.rolling === false && (vars.speed as number) >= walkToRunSpeed);

        // Swipe-down slide (see SwipeRunnerController) — its own state, not just reusing
        // 'roll', with its own dedicated clip (see MainPlayer.loadCharacter()).
        board.registerTransition('any', 'slide', 0.1, undefined, 'slide', false);
        board.registerTransition('slide', 'idle', 0.2, (vars) => vars.sliding === false && (vars.speed as number) <= idleToWalkSpeed);
        board.registerTransition('slide', 'walk', 0.2, (vars) => vars.sliding === false && (vars.speed as number) > idleToWalkSpeed && (vars.speed as number) < walkToRunSpeed);
        board.registerTransition('slide', 'run', 0.2, (vars) => vars.sliding === false && (vars.speed as number) >= walkToRunSpeed);
    }

    /** Recolors every body mesh (excluding the head cube) to an explicit hex color. */
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

    /** Colors the body + attaches a smooth (rounded-corner) head with `faceTexture` decaled onto it — the whole cosmetic identity this controller needs (same color+face data as bandit's Character Views, see CharacterViews.ts). */
    public applyCharacterView(color: THREE.ColorRepresentation, faceTexture: THREE.Texture): void {
        this.setBodyColor(color);
        this.mountHeadCube(this.buildHeadMesh(color, faceTexture));
    }

    /** Rounded head mesh, softer-looking than a sharp-edged cube, with a face decal plane in front of its +Z face. */
    private buildHeadMesh(color: THREE.ColorRepresentation, faceTexture: THREE.Texture): THREE.Mesh {
        const geometry = new RoundedBoxGeometry(HEAD_CUBE_SIZE, HEAD_CUBE_SIZE, HEAD_CUBE_SIZE, 4, HEAD_CUBE_SIZE * 0.25);
        const material = new THREE.MeshStandardMaterial({ color });
        BendService.applyBend(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.add(this.buildFaceDecal(HEAD_CUBE_SIZE, faceTexture));
        return mesh;
    }

    /** Thin quad sitting just in front of the head's +Z face, carrying the face decal texture — kept as a separate child mesh so the face art is independent of the head's own body material. */
    private buildFaceDecal(size: number, faceTexture: THREE.Texture): THREE.Mesh {
        const decalSize = size * FACE_DECAL_SCALE;
        const geometry = new THREE.PlaneGeometry(decalSize, decalSize);
        const material = new THREE.MeshStandardMaterial({ map: faceTexture, transparent: false, alphaTest: 0.5 });
        BendService.applyBend(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = size / 2 + size * 0.01;
        return mesh;
    }

    /**
     * Parents `cube` onto whichever bone is actually named "Head", wrapped
     * in a holder that cancels the bone's own inherited scale. No-op if no
     * such bone is found.
     */
    private mountHeadCube(cube: THREE.Mesh): void {
        this.removeHeadCube();

        const headBone = this.findBoneByName('Head');

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
    }

    /** Repositions the head cube live — same real-world units as HEAD_CUBE_SIZE/HEAD_CUBE_OFFSET, (0,0,0) at the head bone's own origin. */
    public setHeadOffset(x: number, y: number, z: number): void {
        HEAD_CUBE_OFFSET.set(x, y, z);
        this.applyHeadTransform();
    }

    /**
     * Bones in this rig carry their own (often large) inherited scale, so a
     * fixed geometry size/offset renders unpredictably depending on which
     * bone it's parented to. Dividing the bone's TRUE cumulative scale out
     * on the HOLDER keeps HEAD_CUBE_SIZE/OFFSET true world units.
     */
    private applyHeadTransform(): void {
        if (!this.headCubeHolder || !this.headBone) {
            return;
        }

        this.headBone.updateWorldMatrix(true, false);
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
        if (!this.headCubeHolder) {
            return;
        }

        this.headCubeHolder.parent?.remove(this.headCubeHolder);
        this.headCube?.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
            }
        });
        this.headCubeHolder = undefined;
        this.headCube = undefined;
    }

    /** Case-insensitive bone lookup by name. */
    private findBoneByName(name: string): THREE.Object3D | undefined {
        let found: THREE.Object3D | undefined;
        const lowerName = name.toLowerCase();

        this.container.traverse((child) => {
            if (found) {
                return;
            }

            if (child.name.toLowerCase() === lowerName) {
                found = child;
            }
        });

        return found;
    }

    /**
     * Call once per frame. `moveInputX`/`moveInputZ` drive facing rotation
     * and the 'speed' animator variable. `extraVars` lets a controller
     * inject additional animator variables (verticalSpeed/grounded for
     * jump, rolling for dodge) before the state machine evaluates this
     * frame's transitions.
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
