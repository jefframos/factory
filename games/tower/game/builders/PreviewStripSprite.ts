import * as THREE from 'three';
import { resolvePieceImagePath } from '../../tw/PieceStorage';
import { TextureBuilder } from './TextureBuilder';

/**
 * The 3D "landing preview" glow for the currently held tower piece — a
 * single standalone THREE.Sprite (always faces the camera), using
 * vfx/grad.webp (opaque at the top, fading to transparent) tinted to the
 * held piece's color. NOT attached to any piece's own mesh — there is
 * exactly one of these per scene, shown/repositioned/hidden by
 * TowerBlockSync3D as the held piece changes, moves, or gets dropped —
 * mirrors FaceTowerBlockController's 2D `previewStrip` field.
 */
export class PreviewStripSprite {
    private readonly sprite: THREE.Sprite;
    private readonly material: THREE.SpriteMaterial;

    public constructor(scene: THREE.Scene) {
        this.material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
        this.sprite = new THREE.Sprite(this.material);

        // Anchored at the sprite's own TOP edge (not center) so `show()`'s
        // (x, baseY) lands exactly on the piece's base and the strip
        // extends downward from there, toward the floor.
        this.sprite.center.set(0.5, 1);
        this.sprite.visible = false;

        scene.add(this.sprite);

        TextureBuilder.load(resolvePieceImagePath('vfx/grad.webp'))
            .then(texture => {
                this.material.map = texture;
                this.material.needsUpdate = true;
            })
            .catch(() => { /* keep the flat-tint fallback if art is missing */ });
    }

    public show(x: number, baseY: number, z: number, width: number, stripHeight: number, color: THREE.ColorRepresentation): void {
        this.material.color.set(color);
        this.sprite.scale.set(width, stripHeight, 1);
        this.sprite.position.set(x, baseY, z);
        this.sprite.visible = true;
    }

    public hide(): void {
        this.sprite.visible = false;
    }

    public destroy(): void {
        this.sprite.removeFromParent();
        this.material.dispose();
        // The texture itself comes from TextureBuilder's own cache (shared
        // with anything else that loads the same path) and is intentionally
        // left undisposed here.
    }
}
