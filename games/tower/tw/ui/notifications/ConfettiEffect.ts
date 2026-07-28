// ConfettiEffect.ts

import * as PIXI from 'pixi.js';

interface ConfettiPiece {
    sprite: PIXI.Graphics;
    vx: number;
    vy: number;
    spin: number;
    life: number;
}

const COLORS = [0xffe066, 0x2ecc71, 0x5dade2, 0xff6bb0, 0xffffff, 0xff9f43];
const PIECE_COUNT = 150;
const GRAVITY = 900;
const LIFETIME = 2.5;
/** Piece alpha only starts fading once life drops below this — keeps confetti solid for most of its fall instead of fading the whole time. */
const FADE_WINDOW = 0.8;

/**
 * A burst of falling/tumbling rects from the top of the screen — one per
 * level-up (see LevelUpNotification.show()). Self-driven via
 * updateTransform() (same no-explicit-update-call convention
 * GameOverPopup's fade uses), so nothing external needs to tick it every
 * frame.
 */
export class ConfettiEffect extends PIXI.Container {
    private pieces: ConfettiPiece[] = [];
    private lastTime = 0;

    public constructor(private readonly spawnWidth: number) {
        super();
    }

    /** Spawns a fresh burst, discarding whatever's left of a previous one. */
    public play(): void {
        this.clearPieces();

        for (let i = 0; i < PIECE_COUNT; i++) {
            const sprite = new PIXI.Graphics();
            const color = COLORS[Math.floor(Math.random() * COLORS.length)];
            const w = 6 + Math.random() * 6;
            const h = 10 + Math.random() * 6;

            sprite.beginFill(color, 1);
            sprite.drawRect(-w * 0.5, -h * 0.5, w, h);
            sprite.endFill();

            const y = -20 - Math.pow(Math.random(), 3) * 800;
            sprite.position.set(Math.random() * this.spawnWidth, y);
            sprite.rotation = Math.random() * Math.PI * 2;

            this.addChild(sprite);

            this.pieces.push({
                sprite,
                vx: (Math.random() - 0.5) * 220,
                vy: 120 + Math.random() * 160,
                spin: (Math.random() - 0.5) * 8,
                life: LIFETIME,
            });
        }

        this.lastTime = performance.now();
    }

    private clearPieces(): void {
        for (const piece of this.pieces) {
            piece.sprite.destroy();
        }

        this.pieces = [];
    }

    public override updateTransform(): void {
        if (this.pieces.length > 0) {
            const now = performance.now();
            const delta = Math.min(0.05, (now - this.lastTime) / 1000);
            this.lastTime = now;

            for (const piece of [...this.pieces]) {
                piece.life -= delta;
                piece.vy += GRAVITY * delta;
                piece.sprite.x += piece.vx * delta;
                piece.sprite.y += piece.vy * delta;
                piece.sprite.rotation += piece.spin * delta;
                piece.sprite.alpha = Math.max(0, Math.min(1, piece.life / FADE_WINDOW));

                if (piece.life <= 0) {
                    piece.sprite.destroy();
                    this.pieces.splice(this.pieces.indexOf(piece), 1);
                }
            }
        }

        super.updateTransform();
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.clearPieces();
        super.destroy(options ?? { children: true });
    }
}
