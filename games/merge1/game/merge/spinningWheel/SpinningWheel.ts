import Pool from "@core/Pool";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { CurrencyType } from "../data/InGameEconomy";
import MergeAssets from "../MergeAssets";
import WheelSlice from "./WheelSlice";

export interface WheelPrize {
    prizeType: CurrencyType;
    amount: number;
    level?: number;
    id?: string;
}


export default class SpinningWheel extends PIXI.Container {
    public readonly onSpinComplete: Signal = new Signal();
    private wheelContent: PIXI.Container;
    private flap: PIXI.Sprite;
    private slices: WheelSlice[] = [];
    private sliceAngle: number;
    private isSpinning: boolean = false;

    constructor(
        private prizes: WheelPrize[],
        private colors: number[],
        private getEntityTexture: (id: string) => PIXI.Texture,
        private frameTexture: PIXI.Texture,
        private sliceDividerTexture: PIXI.Texture,
        private flapTexture: PIXI.Texture
    ) {
        super();
        this.sliceAngle = 360 / prizes.length;
        this.setupWheel();
    }

    private setupWheel(): void {
        const frame = new PIXI.Sprite(this.frameTexture);
        frame.anchor.set(0.5);
        this.addChild(frame);

        this.wheelContent = new PIXI.Container();
        this.addChild(this.wheelContent);

        const radius = 350//(frame.width / 2) * 0.95;

        this.prizes.forEach((prize, i) => {
            const slice = Pool.instance.getElement(WheelSlice);
            const tex = this.getPrizeTexture(prize);

            slice.setup(
                prize,
                this.colors[i % this.colors.length],
                i * this.sliceAngle,
                this.sliceAngle,
                radius,
                tex,
                this.sliceDividerTexture
            );

            this.wheelContent.addChild(slice);
            this.slices.push(slice);
        });

        this.flap = new PIXI.Sprite(this.flapTexture);
        this.flap.anchor.set(0.5, 0);
        this.flap.y = -radius - 5;
        this.addChild(this.flap);
    }

    private getPrizeTexture(prize: WheelPrize): PIXI.Texture {
        if (prize.prizeType === CurrencyType.ENTITY && prize.id) {
            // This uses the callback you passed in the constructor
            return this.getEntityTexture(prize.id);
        }

        // Direct mapping to your MergeAssets structure
        switch (prize.prizeType) {
            case CurrencyType.MONEY:
                return PIXI.Texture.from(MergeAssets.Textures.Icons.Coin);
            case CurrencyType.GEMS:
                return PIXI.Texture.from(MergeAssets.Textures.Icons.Gem);
            default:
                return PIXI.Texture.WHITE; // Fallback so it's not invisible
        }
    }

    public spin(targetIndex: number): void {
        if (this.isSpinning) return;
        this.isSpinning = true;

        this.wheelContent.rotation %= Math.PI * 2;
        const extraSpins = 6;
        const targetRotation = (this.wheelContent.rotation) - (extraSpins * Math.PI * 2) -
            ((targetIndex * this.sliceAngle + (this.sliceAngle / 2)) * Math.PI / 180) - (Math.PI / 2);

        let lastActiveIndex = -1;

        gsap.to(this.wheelContent, {
            rotation: targetRotation,
            duration: 4,
            ease: "circ.out",
            onUpdate: () => {
                // Calculate which slice is at -90 degrees (Top) relative to world
                const rotationDeg = (-this.wheelContent.rotation * 180 / Math.PI) + 270;
                const activeIndex = Math.floor((rotationDeg % 360) / this.sliceAngle) % this.prizes.length;

                if (activeIndex !== lastActiveIndex) {
                    this.slices.forEach((s, idx) => s.setHighlight(idx === activeIndex));
                    this.playFlapTick();
                    lastActiveIndex = activeIndex;
                }
            },
            onComplete: () => {
                this.isSpinning = false;
                this.onSpinComplete.dispatch(this.prizes[targetIndex]);
            }
        });
    }

    private playFlapTick(): void {
        gsap.fromTo(this.flap, { rotation: 0.4 }, { rotation: 0, duration: 0.15 });

    }

    public destroyWheel(): void {
        this.slices.forEach(s => {
            this.wheelContent.removeChild(s);
            Pool.instance.returnElement(s);
        });
        this.slices = [];
        this.destroy();
    }
}