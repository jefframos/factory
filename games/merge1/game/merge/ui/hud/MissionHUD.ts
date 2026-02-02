import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import { NineSliceProgressBar } from "@core/ui/NineSliceProgressBar";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import MergeAssets from "../../MergeAssets";
import { MissionManager } from "../../missions/MissionManager";
import { MissionDefinition } from "../../missions/MissionTypes";
import { TextureBaker } from "../../vfx/TextureBaker";

export class MissionHUD extends PIXI.Container {
    public onClaim: Signal = new Signal();
    private bg: PIXI.NineSlicePlane;
    private icon: PIXI.Sprite;
    private titleText: PIXI.Text;
    private progressText: PIXI.Text;

    private progressBar: NineSliceProgressBar;

    private claimButton: BaseButton;
    private checkIcon: PIXI.Sprite;

    private activeDef: MissionDefinition | null = null;

    private scaleSin = 0;

    private readonly w: number;
    private readonly h: number;

    public constructor(width: number = 420, height: number = 86) {
        super();

        this.w = width;
        this.h = height;

        const ns = { left: 25, top: 25, right: 25, bottom: 25 };
        const panelTex = PIXI.Texture.from(MergeAssets.Textures.UI.MissionPanel);

        // 1. Background Panel
        this.bg = new PIXI.NineSlicePlane(panelTex, ns.left, ns.top, ns.right, ns.bottom);
        this.bg.width = this.w + 50;
        this.bg.height = this.h;
        this.addChild(this.bg);
        this.bg.x = -50

        // 2. Mission Icon
        this.icon = PIXI.Sprite.from(PIXI.Texture.WHITE);
        this.icon.anchor.set(0.5);
        this.icon.width = 54;
        this.icon.height = 54;
        this.icon.x = 42;
        this.icon.y = this.h / 2;
        this.addChild(this.icon);

        // 3. Title Text (With Scaling Logic)
        this.titleText = new PIXI.Text("", {
            ...MergeAssets.MainFont,
            fontSize: 22,
            wordWrap: false // We will scale instead of wrap
        });
        this.titleText.anchor.set(0, 0);
        this.titleText.x = 80;
        this.titleText.y = 10;
        this.addChild(this.titleText);

        // 4. Progress Text
        this.progressText = new PIXI.Text("", {
            ...MergeAssets.MainFont,
            fontSize: 16
        });
        this.progressText.anchor.set(1, 0.5);
        this.progressText.x = this.w - 20;
        this.progressText.y = this.h - 20;
        this.addChild(this.progressText);

        // 5. Progress Bar (Replaced with NineSliceProgressBar)
        this.progressBar = new NineSliceProgressBar({
            width: 160,
            height: 20,
            bgTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarBg),
            barTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarFill),
            leftWidth: 8, topHeight: 8, rightWidth: 8, bottomHeight: 8,
            barColor: MergeAssets.Textures.UI.FillColor,
            padding: 3
        });
        this.progressBar.position.set(this.w / 2, this.h - 20);
        this.addChild(this.progressBar);

        // 6. Check Icon (Top Right)
        this.checkIcon = PIXI.Sprite.from(PIXI.Texture.from(MergeAssets.Textures.Icons.Check));
        this.checkIcon.anchor.set(0.5);
        this.checkIcon.width = 30;
        this.checkIcon.height = 30;
        this.checkIcon.position.set(this.w - 20, 20);
        this.addChild(this.checkIcon);

        // 7. Claim Button (Under the panel on the right)
        this.claimButton = new BaseButton({
            standard: {
                width: 200,
                height: 70,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Gold || MergeAssets.Textures.Buttons.Blue),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 25 }),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Gift2),
                iconSize: { height: 100, width: 100 },
                textOffset: { x: 45, y: 0 },
                centerIconVertically: true
            },
            over: { tint: 0xeeeeee },
            click: {
                callback: () => {
                    const claim = MissionManager.instance.claimActive()
                    if (claim) {
                        this.playClaimFx();

                        this.onClaim.dispatch(claim)
                    }
                }
            }
        });
        this.claimButton.setLabel('CLAIM');
        // Positioned under the right side of the main panel
        this.claimButton.x = this.w / 2;
        this.claimButton.y = - this.claimButton.height / 2 - 5;

        this.claimButton.pivot.x = this.claimButton.width / 2;
        this.claimButton.pivot.y = this.claimButton.height / 2;
        this.addChild(this.claimButton);

        this.initEvents();
        this.syncInitialState();
    }

    updateTransform(): void {
        super.updateTransform();

        if (this.claimButton.visible) {
            this.scaleSin += Game.deltaTime * 3;
            this.claimButton.scale.set(Math.sin(this.scaleSin) * 0.05 + 0.95)
        }
    }
    private initEvents(): void {
        MissionManager.instance.onActiveMissionChanged.add(this.applyMission, this);
        MissionManager.instance.onActiveMissionProgress.add(this.applyProgress, this);

        MissionManager.instance.onNextMissionTimerChanged.add((remainingSec: number) => {
            this.alpha = 1;
            if (this.activeDef) return;
            if (remainingSec > 0) {
                //this.visible = true;
                this.updateTitle("Next mission");
                this.progressText.text = `In ${remainingSec}s`;
                this.progressBar.update(0);
                this.setClaimState(false);
                this.visible = false;
                this.alpha = 0;
            } else if (!MissionManager.instance.activeMissionDef) {
                this.visible = false;
            }
        });
    }

    private syncInitialState(): void {
        this.applyMission(MissionManager.instance.activeMissionDef);
        const st = MissionManager.instance.activeMissionState;
        if (st && this.activeDef) {
            this.applyProgress(st.progress, this.activeDef.target, st.completed);
        }
    }

    private applyMission(def: MissionDefinition | null): void {
        this.activeDef = def;
        if (!def) {
            this.visible = false;
            return;
        }

        this.visible = true;
        MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.Drop)
        this.updateTitle(def.title);


        if (def.iconTextureId) {
            let tex = PIXI.Assets.cache.get(def.iconTextureId)
            if (!tex) {
                tex = TextureBaker.getTexture(def.iconTextureId)
            }
            this.icon.texture = tex;
            this.icon.visible = true;
        } else {
            this.icon.visible = false;
        }

        this.progressBar.update(0);
        this.setClaimState(false);
    }

    private updateTitle(text: string): void {
        this.titleText.text = text;
        this.titleText.scale.set(1);

        // Auto-scale text down if it's wider than the available space (approx 250px)
        const maxWidth = this.w - 100;
        if (this.titleText.width > maxWidth) {
            const ratio = maxWidth / this.titleText.width;
            this.titleText.scale.set(ratio);
        }
    }

    private applyProgress(progress: number, target: number, completed: boolean): void {
        const p = Math.min(progress, target);
        this.progressText.text = `${p}/${target}`;

        const ratio = target <= 0 ? 0 : (p / target);
        this.progressBar.update(ratio);

        this.setClaimState(completed);
    }

    private setClaimState(isCompleted: boolean): void {
        this.claimButton.visible = isCompleted;

        if (isCompleted && !this.checkIcon.visible) {
            // Little bounce for the check icon
            gsap.fromTo(this.checkIcon.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.4, ease: "back.out(2)" });
        }
        this.checkIcon.visible = isCompleted;
    }

    private playClaimFx(): void {
        gsap.fromTo(this.scale, { x: 1, y: 1 }, { x: 1.02, y: 1.02, duration: 0.1, yoyo: true, repeat: 1 });
    }
}