
import ViewUtils from "@core/utils/ViewUtils";
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import * as PIXI from "pixi.js";
import { HexGridView } from "./HexGridView";

// Register the plugin
gsap.registerPlugin(MotionPathPlugin);

export class EndGameService {
    private particleContainer: PIXI.Container;
    private spritePool: PIXI.Sprite[] = [];
    private boxSprite: PIXI.Sprite | null = null;

    constructor(
        private gameRoot: PIXI.Container,
        private gridView: HexGridView
    ) {
        this.particleContainer = new PIXI.Container();
        this.gameRoot.addChild(this.particleContainer);
        this.particleContainer.sortableChildren = true
    }

    private getSprite(): PIXI.Sprite {
        if (this.spritePool.length > 0) {
            const sprite = this.spritePool.pop()!;
            sprite.visible = true;
            return sprite;
        }
        return new PIXI.Sprite();
    }

    private returnSprite(sprite: PIXI.Sprite): void {
        sprite.visible = false;
        this.spritePool.push(sprite);
    }

    private createBox(): PIXI.Sprite {
        const box = new PIXI.Sprite(PIXI.Texture.WHITE);
        box.width = 120;
        box.height = 120;
        box.tint = 0x2c3e50;
        box.anchor.set(0.5);

        const targetX = window.innerWidth / 2;
        const targetY = window.innerHeight - 80;

        box.position.set(targetX, targetY);
        box.alpha = 0;

        this.gameRoot.addChild(box);

        // Animate box in
        gsap.to(box, {
            alpha: 1,
            duration: 0.3,
            ease: "power2.out"
        });

        return box;
    }

    public async execute(totalTime: number = 2.0): Promise<void> {
        const tiles = this.gridView.getAllTiles();
        if (tiles.length === 0) return;

        // Extend time if there are many pieces
        const adjustedTime = tiles.length > 30 ? totalTime + 2.0 : totalTime;

        // Create the box
        this.boxSprite = this.createBox();

        const targetX = window.innerWidth / 2;
        const targetY = window.innerHeight - 80;

        const targetLocal = this.particleContainer.toLocal(new PIXI.Point(targetX, targetY));

        const cTransform = this.particleContainer.worldTransform;
        const containerScaleX = Math.sqrt(cTransform.a * cTransform.a + cTransform.b * cTransform.b) || 1;
        const containerScaleY = Math.sqrt(cTransform.c * cTransform.c + cTransform.d * cTransform.d) || 1;

        const animationPromises: Promise<void>[] = [];
        console.log(this.gridView.scale)

        tiles.forEach((tile, index) => {
            const globalPos = tile.getGlobalPosition();
            const localPos = this.particleContainer.toLocal(globalPos);

            const wt = tile.worldTransform;
            const globalScaleX = Math.sqrt(wt.a * wt.a + wt.b * wt.b);
            const globalScaleY = Math.sqrt(wt.c * wt.c + wt.d * wt.d);
            const globalRotation = Math.atan2(wt.b, wt.a);

            const startScaleX = globalScaleX / containerScaleX;
            const startScaleY = globalScaleY / containerScaleY;

            const sprite = this.getSprite();
            sprite.texture = tile.sprite.texture;
            sprite.anchor.copyFrom(tile.sprite.anchor);

            sprite.position.set(localPos.x, localPos.y);
            sprite.rotation = globalRotation;
            sprite.scale.set(ViewUtils.elementScaler(sprite, tile.sprite.width));
            sprite.width = tile.sprite.width * this.gridView.scale.x
            sprite.height = tile.sprite.height * this.gridView.scale.y

            this.particleContainer.addChild(sprite);
            tile.visible = false;

            const scl = ViewUtils.elementScaler(sprite, tile.sprite.width)
            // Stagger delay based on index and total time
            const delay = (index / tiles.length) * (adjustedTime * 0.5);
            const duration = adjustedTime * 0.7;

            // Bezier control point for arc
            const controlX = (localPos.x + targetLocal.x) / 2 + (Math.random() - 0.5) * 150;
            const controlY = Math.min(localPos.y, targetLocal.y) - (100 + Math.random() * 100);

            const p = new Promise<void>((resolve) => {
                const timeline = gsap.timeline({
                    delay: delay,
                    onStart: () => {
                        sprite.zIndex = index - 100
                    },
                    onComplete: () => {
                        this.particleContainer.removeChild(sprite);
                        this.returnSprite(sprite);
                        resolve();
                    }
                });

                // Pop out and scale up
                const popScale = Math.max(scl, scl) * 1.3;
                timeline.to(sprite.scale, {
                    duration: 0.15,
                    x: popScale,
                    y: popScale,
                    ease: "back.out(2)"
                });

                // Fly to box with bezier curve
                timeline.to(sprite, {
                    duration: duration,
                    motionPath: {
                        path: [
                            { x: localPos.x, y: localPos.y },
                            { x: controlX, y: controlY },
                            { x: targetLocal.x, y: targetLocal.y }
                        ],
                        curviness: 1.5
                    },
                    rotation: globalRotation + (Math.random() - 0.5) * 4,
                    ease: "power1.in"
                }, "-=0.05");

                // Scale down during flight
                timeline.to(sprite.scale, {
                    duration: duration,
                    x: 0.05,
                    y: 0.05,
                    ease: "power1.in"
                }, `-=${duration}`);
            });

            animationPromises.push(p);
        });

        // Wait for all pieces to finish
        await Promise.all(animationPromises);

        // Animate box out
        if (this.boxSprite) {
            await gsap.to(this.boxSprite, {
                alpha: 0,
                scale: 0.8,
                duration: 0.3,
                ease: "power2.in"
            });

            this.boxSprite.destroy();
            this.boxSprite = null;
        }
    }
}