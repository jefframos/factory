import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import Assets from '../../../Assets';

export class ZoneNotification extends PIXI.Container {
    private static readonly DISPLAY_MS = 1200;

    private tween: gsap.core.Timeline | null = null;
    private letters: PIXI.Text[] = [];

    public constructor() {
        super();

        this.alpha = 0;
        this.scale.set(0.8);
    }

    public show(zoneIndex: number): void {
        this.clearLetters();

        const text = `Zone ${zoneIndex} complete!`;

        const letters: PIXI.Text[] = [];
        const letterWidths: number[] = [];

        let totalWidth = 0;

        for (const char of text) {
            const displayChar = char === ' ' ? '\u00A0' : char;

            const letter = new PIXI.Text(
                displayChar,
                Assets.TextStyles.InfoLabel,
            );

            letter.anchor.set(0.5);
            letter.alpha = 0;

            // Measure before setting scale to zero.
            const width = letter.width;

            letterWidths.push(width);
            totalWidth += width;

            // Animation starts after measurement.
            letter.scale.set(0);

            this.addChild(letter);
            letters.push(letter);
        }

        this.letters = letters;

        let x = -totalWidth * 0.5;

        for (let i = 0; i < letters.length; i++) {
            const letter = letters[i];
            const width = letterWidths[i];

            letter.position.set(
                x + width * 0.5,
                0,
            );

            x += width;
        }

        this.tween?.kill();

        this.alpha = 1;
        this.scale.set(1);

        this.tween = gsap.timeline();

        this.tween
            .to(letters, {
                alpha: 1,
                duration: 0.2,
                stagger: 0.04,
            })
            .to(
                letters.map(letter => letter.scale),
                {
                    x: 1,
                    y: 1,
                    duration: 0.5,
                    ease: 'elastic.out(1, 0.3)',
                    stagger: 0.04,
                },
                '<',
            )
            .to({}, {
                duration: ZoneNotification.DISPLAY_MS / 1000,
            })
            .to(this, {
                alpha: 0,
                duration: 0.25,
            });
    }

    private clearLetters(): void {
        for (const letter of this.letters) {
            letter.destroy();
        }

        this.letters.length = 0;
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.tween?.kill();
        this.clearLetters();

        super.destroy(options ?? { children: true });
    }
}