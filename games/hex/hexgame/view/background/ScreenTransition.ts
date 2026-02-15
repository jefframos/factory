import { Game } from "@core/Game";
import gsap from "gsap";
import * as PIXI from "pixi.js";
import HexAssets from "../../HexAssets";
import { CloudBelt } from "./CloudBelt";

export class ScreenTransition extends PIXI.Container {
    private bgLayer: PIXI.Container;
    private fgLayer: PIXI.Container;
    private leftGroup: PIXI.Container = new PIXI.Container();
    private rightGroup: PIXI.Container = new PIXI.Container();

    // Loading UI (Separated)
    private loadingContainer: PIXI.Container = new PIXI.Container();
    private spinnerIcon!: PIXI.Sprite;
    private loadingText!: PIXI.Text;
    private pulseTween?: gsap.core.Tween;
    private rotateTween?: gsap.core.Tween;

    private leftCloudBelt!: CloudBelt;
    private rightCloudBelt!: CloudBelt;

    private progress: number = 0; // 0 = Open (Invisible), 1 = Closed (Covering screen)
    private standardWidth: number = Game.DESIGN_WIDTH;
    private targetWidth: number = Game.DESIGN_WIDTH;
    private readonly CLOSED_OFFSET = 200;

    constructor() {
        super();
        this.bgLayer = new PIXI.Container();
        this.addChild(this.bgLayer);

        this.fgLayer = new PIXI.Container();
        this.addChild(this.fgLayer);
        this.fgLayer.addChild(this.leftGroup, this.rightGroup);

        this.setupForeground();
        this.setupLoadingUI();
        this.resetTransition();
    }

    public setTargetWidth(width: number): void {
        this.targetWidth = width;
        this.applyProgress();
    }

    private setupLoadingUI(): void {
        this.loadingContainer.alpha = 0;
        this.loadingContainer.visible = false;
        this.addChild(this.loadingContainer);

        this.spinnerIcon = PIXI.Sprite.from('spinner');
        this.spinnerIcon.anchor.set(0.5);
        this.loadingContainer.addChild(this.spinnerIcon);

        const textStyle = new PIXI.TextStyle({
            ...HexAssets.MainFont,
            fontSize: 32,
            fill: "#ffffff"
        });
        this.loadingText = new PIXI.Text("", textStyle);
        this.loadingText.anchor.set(0.5);
        this.loadingText.y = 90;
        this.loadingContainer.addChild(this.loadingText);
    }

    // --- Loading Logic (Independent) ---

    public async showLoading(text: string = "Loading..."): Promise<void> {
        this.loadingText.text = text;
        this.loadingContainer.visible = true;

        // Start animations
        this.rotateTween = gsap.to(this.spinnerIcon, { rotation: Math.PI * 2, duration: 1.5, repeat: -1, ease: "none" });
        this.pulseTween = gsap.to(this.loadingContainer.scale, { x: 1.05, y: 1.05, duration: 0.8, repeat: -1, yoyo: true, ease: "sine.inOut" });

        await gsap.to(this.loadingContainer, { alpha: 1, duration: 0.3 });
    }

    public async hideLoading(): Promise<void> {
        await gsap.to(this.loadingContainer, { alpha: 0, duration: 0.3 });

        this.loadingContainer.visible = false;
        this.rotateTween?.kill();
        this.pulseTween?.kill();
    }

    // --- Transition Logic ---

    public async close(): Promise<void> {
        // We animate the 'progress' property to 1
        HexAssets.tryToPlaySound(HexAssets.Sounds.UI.TransitionClose)
        await gsap.to(this, {
            progress: 1,
            duration: 0.7,
            ease: "power2.in",
            onUpdate: () => this.applyProgress()
        });
    }

    public forceClose() {
        this.progress = 1;
        this.rightCloudBelt.alpha = 0;
        this.leftCloudBelt.alpha = 0;
        this.applyProgress();
    }

    public async open(): Promise<void> {
        this.rightCloudBelt.alpha = 1;
        this.leftCloudBelt.alpha = 1;

        HexAssets.tryToPlaySound(HexAssets.Sounds.UI.TransitionOpen)

        // We animate the 'progress' property back to 0
        await gsap.to(this, {
            progress: 0,
            duration: 0.8,
            ease: "power2.out",
            onUpdate: () => this.applyProgress()
        });
    }
    private resetTransition(): void {
        this.progress = 0;
        this.applyProgress();
    }
    private applyProgress(): void {
        const halfWidth = this.targetWidth / 2;

        // Linear interpolation: StartPos + (EndPos - StartPos) * progress
        const leftX = -halfWidth + (this.CLOSED_OFFSET + halfWidth) * this.progress;
        const rightX = halfWidth + (-this.CLOSED_OFFSET - halfWidth) * this.progress;

        this.leftGroup.x = leftX;
        this.rightGroup.x = rightX;

        // Visual feedback: Hide belts if fully open to save performance
        const isFullyOpen = this.progress >= 0.98;
        if (isFullyOpen) {
            this.leftCloudBelt.alpha = 0;
            this.rightCloudBelt.alpha = 0;
        } else {
            this.leftCloudBelt.alpha = 1;
            this.rightCloudBelt.alpha = 1;
        }
    }
    private setupForeground(): void {
        const cloudTextures = [PIXI.Texture.from('cloud-1'), PIXI.Texture.from('cloud-2')];
        const gradientTexture = PIXI.Texture.from('cloud-overlay');

        const cloudSettings = {
            count: 30, textures: cloudTextures,
            scaleRange: { min: 1, max: 1.1 }, speedRange: { min: 0.4, max: 1.2 },
            xNoise: 100, circularRadius: 20, circularSpeed: 0.2, overlapPercent: 0.4,
            yRange: { start: -Game.DESIGN_HEIGHT / 2, end: Game.DESIGN_HEIGHT / 2 }
        };

        this.leftCloudBelt = new CloudBelt({ ...cloudSettings, side: 'left' });
        const leftGradient = new PIXI.Sprite(gradientTexture);
        leftGradient.width = 600;
        leftGradient.height = Game.DESIGN_HEIGHT * 2;
        leftGradient.anchor.set(0.5);
        leftGradient.x = -leftGradient.width / 2;

        const leftWhite = new PIXI.Sprite(PIXI.Texture.WHITE);
        leftWhite.width = 3000;
        leftWhite.height = Game.DESIGN_HEIGHT * 2;
        leftWhite.anchor.set(1, 0.5);
        leftWhite.x = -leftGradient.width + 50;
        this.leftGroup.addChild(leftWhite, this.leftCloudBelt, leftGradient);

        this.rightCloudBelt = new CloudBelt({ ...cloudSettings, side: 'right' });
        const rightGradient = new PIXI.Sprite(gradientTexture);
        rightGradient.scale.x = -1;
        rightGradient.width = 600;
        rightGradient.height = Game.DESIGN_HEIGHT * 2;
        rightGradient.anchor.set(0.5);
        rightGradient.x = rightGradient.width / 2;

        const rightWhite = new PIXI.Sprite(PIXI.Texture.WHITE);
        rightWhite.width = 3000;
        rightWhite.height = Game.DESIGN_HEIGHT * 2;
        rightWhite.anchor.set(0, 0.5);
        rightWhite.x = rightGradient.width - 50;
        this.rightGroup.addChild(rightWhite, this.rightCloudBelt, rightGradient);
    }



    public update(delta: number): void {
        // Center the transition container itself
        this.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2);

        this.leftCloudBelt.update(delta);
        this.rightCloudBelt.update(delta);

        // Ensure layout stays consistent if targetWidth changes mid-animation
        this.applyProgress();
    }
}