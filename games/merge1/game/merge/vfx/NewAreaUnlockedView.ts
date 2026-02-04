import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { StarBurst } from '../entity/StarBurst';
import MergeAssets from '../MergeAssets';
import { IRoomConfig } from '../rooms/RoomRegistry';

export class NewAreaUnlockedView extends PIXI.Container {
    private dimmer: PIXI.Graphics;
    private shine: PIXI.Sprite;
    private areaIcon: PIXI.Sprite;
    private stars: StarBurst;

    private titleContainer: PIXI.Container;
    private titleBg: PIXI.NineSlicePlane;
    private nameContainer: PIXI.Container;
    private nameBg: PIXI.NineSlicePlane;
    private titleText: PIXI.Text;
    private nameText: PIXI.Text;

    private isAnimating: boolean = false;

    constructor() {
        super();

        // 0. Background Dimmer
        this.dimmer = new PIXI.Graphics();
        this.dimmer.beginFill(0x000000, 0.7);
        this.dimmer.drawRect(-2000, -2000, 4000, 4000);
        this.dimmer.endFill();
        this.dimmer.alpha = 0;
        this.addChild(this.dimmer);

        // 1. Visual Effects
        this.shine = PIXI.Sprite.from(MergeAssets.Textures.UI.Shine);
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0;
        this.addChild(this.shine);

        this.stars = new StarBurst(PIXI.Texture.from(MergeAssets.Textures.Particles.Star));
        this.addChild(this.stars);

        // 2. Area Icon (Replacing Portrait)
        this.areaIcon = new PIXI.Sprite();
        this.areaIcon.anchor.set(0.5);
        this.areaIcon.scale.set(0);
        this.addChild(this.areaIcon);

        // 3. Title (New Area Unlocked)
        this.titleContainer = new PIXI.Container();
        this.titleBg = new PIXI.NineSlicePlane(PIXI.Texture.from('ItemFrame01_Single_Gray'), 30, 30, 30, 30);
        this.titleText = new PIXI.Text('NEW AREA UNLOCKED!', { ...MergeAssets.MainFontTitle, fontSize: 26, fill: 0xffffff });
        this.titleText.anchor.set(0.5, 0);
        this.titleContainer.addChild(this.titleBg, this.titleText);
        this.addChild(this.titleContainer);

        // 4. Area Name
        this.nameContainer = new PIXI.Container();
        this.nameBg = new PIXI.NineSlicePlane(PIXI.Texture.from('ItemFrame01_Single_Purple'), 30, 30, 30, 30);
        this.nameText = new PIXI.Text('', { ...MergeAssets.MainFontTitle, fontSize: 32, fill: 0xFFFFFF });
        this.nameText.anchor.set(0.5, 0);
        this.nameContainer.addChild(this.nameBg, this.nameText);
        this.addChild(this.nameContainer);

        this.visible = false;
    }

    private updateLayout(): void {
        const paddingH = 60;
        const paddingV = 20;

        // --- Title Layout ---
        this.titleBg.width = this.titleText.width + paddingH;
        this.titleBg.height = this.titleText.height + paddingV;

        // Center the background: start at -halfWidth
        this.titleBg.x = -this.titleBg.width / 2;
        this.titleBg.y = 0;

        // Center the text: keep it at 0 (since anchor is 0.5)
        this.titleText.x = 0;
        this.titleText.y = paddingV / 2;

        // Position the whole container
        this.titleContainer.y = -140;


        // --- Name Layout ---
        this.nameBg.width = this.nameText.width + paddingH;
        this.nameBg.height = this.nameText.height + paddingV;

        // Center the background
        this.nameBg.x = -this.nameBg.width / 2;
        this.nameBg.y = 0;

        // Center the text
        this.nameText.x = 0;
        this.nameText.y = paddingV / 2;

        // Position the whole container
        this.nameContainer.y = 140;
    }

    public update(delta: number): void {
        if (this.visible) {
            this.shine.rotation += 0.4 * delta;
            this.stars.update(delta * 25);
        }
    }

    public async play(config: IRoomConfig, mapIconTarget: PIXI.Container) {
        if (this.isAnimating) return;
        this.isAnimating = true;

        // Setup Data
        this.areaIcon.texture = PIXI.Texture.from(config.icon);
        this.nameText.text = config.displayName.toUpperCase();
        this.updateLayout();

        // Sound
        MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.NewDiscovery);

        // Reset
        this.visible = true;
        this.x = 0; this.y = 0;
        this.dimmer.alpha = 0;
        this.shine.alpha = 0;
        this.shine.scale.set(1);
        this.areaIcon.scale.set(0);
        this.titleContainer.alpha = 0;
        this.nameContainer.alpha = 0;

        const tl = gsap.timeline();

        // 1. Entrance Fade & Bounce
        tl.to(this.dimmer, { alpha: 1, duration: 0.4 });
        tl.to(this.areaIcon.scale, { x: 1.2, y: 1.2, duration: 0.8, ease: "elastic.out(1, 0.5)" }, "-=0.2");

        // 2. Effects
        tl.to(this.shine, { alpha: 0.7, duration: 1, ease: "power2.out" }, "-=0.5");
        tl.to(this.shine.scale, { x: 2.5, y: 2.5, duration: 1.5 }, "<");
        tl.add(() => this.stars.burst(), "-=1.0");

        // 3. Show Text
        tl.to([this.titleContainer, this.nameContainer], {
            alpha: 1,
            duration: 0.5,
            stagger: 0.2,
            onStart: () => MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Grab)
        }, "-=0.8");

        tl.to({}, { duration: 2.0 }); // Wait for user to see

        // 4. Fade UI & Fly to Map Icon
        tl.to([this.dimmer, this.shine, this.titleContainer, this.nameContainer], {
            alpha: 0,
            duration: 0.4,
            ease: "power2.inOut"
        });

        const globalTarget = mapIconTarget.getGlobalPosition();
        const localTarget = this.parent.toLocal(globalTarget);

        tl.to(this, {
            x: localTarget.x,
            y: localTarget.y,
            duration: 0.9,
            ease: "back.inOut(1.2)",
            onStart: () => MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.FlyAnim),
            onComplete: () => this.onHitMap(mapIconTarget)
        });
    }

    private onHitMap(target: PIXI.Container) {
        MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.MeowAngry);

        gsap.to(this.areaIcon.scale, {
            x: 0, y: 0,
            duration: 0.3,
            ease: "back.in(2)",
            onComplete: () => {
                this.visible = false;
                this.isAnimating = false;

                // Feedback on the Map Icon
                gsap.fromTo(target.scale,
                    { x: 1, y: 1 },
                    { x: 1.3, y: 1.3, duration: 0.15, yoyo: true, repeat: 1 }
                );
            }
        });
    }
}