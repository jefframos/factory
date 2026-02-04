import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { StarBurst } from '../entity/StarBurst';
import MergeAssets from '../MergeAssets';
import { TextureBaker } from './TextureBaker';

export class NewEntityDiscoveredView extends PIXI.Container {
    private badge: PIXI.Sprite;
    private shine: PIXI.Sprite;
    private portrait: PIXI.Sprite;
    private stars: StarBurst;

    // New Text Container Elements
    private titleContainer: PIXI.Container;
    private titleBg: PIXI.NineSlicePlane;
    private textContainer: PIXI.Container;
    private textBg: PIXI.NineSlicePlane;
    private titleText: PIXI.Text;
    private nameText: PIXI.Text;

    private isAnimating: boolean = false;

    private dimmer: PIXI.Graphics;

    constructor() {
        super();


        this.dimmer = new PIXI.Graphics();
        this.dimmer.beginFill(MergeAssets.Textures.UI.BlockerColor, 0.5); // Black with 70% opacity
        // Using a very large size to ensure it covers all screen ratios
        this.dimmer.drawRect(-2000, -2000, 4000, 4000);
        this.dimmer.endFill();
        this.dimmer.alpha = 0;
        this.addChild(this.dimmer);
        // 1. Shine
        this.shine = PIXI.Sprite.from(MergeAssets.Textures.UI.Shine);
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0;
        this.shine.scale.set(2)
        this.addChild(this.shine);
        // 0. Dimmer (Darken the area)
        // Using a 1x1 white texture tinted black, or a specific dark texture
        this.badge = PIXI.Sprite.from('Label_Badge01_Purple');
        //  this.dimmer.tint = MergeAssets.Textures.UI.BlockerColor;
        this.badge.anchor.set(0.5);
        this.badge.width = 200; // Large enough to cover screen
        this.badge.height = 200;
        this.badge.alpha = 0;
        this.addChild(this.badge);


        // 2. Stars
        this.stars = new StarBurst(PIXI.Texture.from(MergeAssets.Textures.Particles.Star));
        this.addChild(this.stars);

        // 3. Portrait
        this.portrait = new PIXI.Sprite();
        this.portrait.anchor.set(0.5);
        this.portrait.scale.set(0);
        this.addChild(this.portrait);

        // 4. Title Container
        this.titleContainer = new PIXI.Container();
        this.titleBg = new PIXI.NineSlicePlane(PIXI.Texture.from('ItemFrame01_Single_Gray'), 30, 30, 30, 30);
        this.titleText = new PIXI.Text('NEW DISCOVERY!', { ...MergeAssets.MainFontTitle, fontSize: 28, fill: 0xffffff });
        this.titleText.anchor.set(0.5, 0);
        this.titleContainer.addChild(this.titleBg, this.titleText);
        this.addChild(this.titleContainer);
        this.titleContainer.pivot.y = this.titleContainer.height / 2

        // 5. Name Container
        this.textContainer = new PIXI.Container();
        this.textBg = new PIXI.NineSlicePlane(PIXI.Texture.from('ItemFrame01_Single_Green'), 30, 30, 30, 30);
        this.nameText = new PIXI.Text('', { ...MergeAssets.MainFontTitle, fontSize: 32, stroke: 0xFFFFFF });
        this.nameText.anchor.set(0.5, 0);
        this.textContainer.addChild(this.textBg, this.nameText);
        this.addChild(this.textContainer);
        this.textContainer.pivot.y = this.textContainer.height / 2

        this.visible = false;
    }

    private updateTextLayout(): void {
        const paddingH = 60;
        const paddingV = 20;

        // Title Layout
        this.titleBg.width = this.titleText.width + paddingH;
        this.titleBg.height = this.titleText.height + paddingV;
        this.titleBg.x = -this.titleBg.width / 2;
        this.titleText.y = paddingV / 2;

        // Name Layout
        this.textBg.width = this.nameText.width + paddingH;
        this.textBg.height = this.nameText.height + paddingV;
        this.textBg.x = -this.textBg.width / 2;
        this.nameText.y = paddingV / 2;

        this.titleContainer.y = -110;
        this.textContainer.y = 170;
    }

    public update(delta: number): void {
        if (this.visible) {
            this.shine.rotation += 0.5 * delta;
            this.stars.update(delta * 25);
        }
    }

    public async playNew(entityId: number, entityName: string, entityColor: number, targetContainer: PIXI.Container) {
        if (this.isAnimating) return;
        this.isAnimating = true;

        this.portrait.texture = TextureBaker.getTexture(`ENTITY_${entityId}`);
        this.nameText.text = entityName.toUpperCase();
        this.nameText.style.fill = 0x252525//entityColor;

        this.updateTextLayout();

        MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.NewDiscovery)

        // RESET
        this.visible = true;
        this.badge.alpha = 0;
        this.shine.alpha = 0;
        this.dimmer.alpha = 0;
        this.portrait.scale.set(0);
        this.titleContainer.alpha = 0;
        this.titleContainer.scale.set(0.5);
        this.textContainer.alpha = 0;
        this.textContainer.scale.set(0.5);

        this.portrait.alpha = 1
        this.portrait.y = -10

        const tl = gsap.timeline();

        // 1. Entrance
        tl.to(this.dimmer, { alpha: 1, duration: 0.2, ease: "power2.out" });
        tl.to(this.badge, { alpha: 1, duration: 0.2 });


        // Correct scale tweening for PIXI
        tl.to(this.portrait.scale, { x: 1, y: 1, duration: 0.8, ease: "elastic.out(1, 0.5)" }, "-=0.2");

        // 2. Effects
        tl.to(this.shine, { alpha: 0.6, duration: 1.2, ease: "power2.out" }, "-=0.6");
        tl.to(this.shine.scale, { x: 2, y: 2, duration: 1.2, ease: "power2.out" }, "<");
        tl.add(() => this.stars.burst(), "-=1.5");

        // 3. Text Boxes
        tl.to(this.titleContainer, { alpha: 1, duration: 0.5 }, "-=0.7");
        tl.to(this.titleContainer.scale, { onStart: () => { MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Grab) }, x: 1, y: 1, duration: 0.5, ease: "back.out(1.7)" }, "<");

        tl.to(this.textContainer, { alpha: 1, duration: 0.5 }, "-=0.5");
        tl.to(this.textContainer.scale, { onStart: () => { MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Grab) }, x: 1, y: 1, duration: 0.5, ease: "back.out(1.7)" }, "<");

        tl.to({}, { duration: 1.5 }); // HOLD

        // 4. Clean Fade Out
        tl.to([this.badge, this.shine, this.titleContainer, this.textContainer], {
            alpha: 0,
            duration: 0.15,

        });

        tl.to([this.dimmer, this.shine, this.titleContainer, this.textContainer], {
            alpha: 0,
            duration: 0.4,
            ease: "power2.inOut"
        });

        const globalTarget = targetContainer.getGlobalPosition();
        const localTarget = this.parent.toLocal(globalTarget);

        tl.to(this, {
            onStart: () => {
                MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.FlyAnim)

            },
            x: localTarget.x,
            y: localTarget.y,
            duration: 0.8,
            ease: "power2.inOut",
            onComplete: () => {
                this.hitTarget(targetContainer);
            }
        });
    }
    private hitTarget(targetContainer: PIXI.Container) {

        MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.MeowAngry)

        gsap.to(this.portrait.scale, {
            x: 0,
            y: 0,
            duration: 0.3,
            ease: "back.in(2)",
            // 4. Clean Fade Out       
            onComplete: () => {
                this.visible = false;
                this.isAnimating = false;

                gsap.fromTo(targetContainer.scale,
                    { x: 1, y: 1 },
                    { x: 1.4, y: 1.4, duration: 0.1, yoyo: true, repeat: 1 }
                );
            }
        });
    }
}