// ui/MissionHUD.ts
import BaseButton from "@core/ui/BaseButton";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";
import { MissionManager } from "../missions/MissionManager";
import { MissionDefinition } from "../missions/MissionTypes";

export class MissionHUD extends PIXI.Container {
    private bg: PIXI.NineSlicePlane;
    private icon: PIXI.Sprite;
    private titleText: PIXI.Text;
    private progressText: PIXI.Text;

    private barBg: PIXI.Sprite;
    private barFill: PIXI.Sprite;

    private claimButton: BaseButton;
    private chestIcon: PIXI.Sprite;

    private activeDef: MissionDefinition | null = null;


    private readonly w: number;
    private readonly h: number;

    public constructor(width: number = 420, height: number = 86) {
        super();

        this.w = width;
        this.h = height;

        const ns = { left: 14, top: 14, right: 14, bottom: 14 };

        // Use one of your existing UI panels (replace id if you prefer)
        const panelTex = PIXI.Texture.from(MergeAssets.Textures.UI.CurrencyPanel);

        this.bg = new PIXI.NineSlicePlane(panelTex, ns.left, ns.top, ns.right, ns.bottom);
        this.bg.width = this.w;
        this.bg.height = this.h;
        this.addChild(this.bg);

        this.icon = PIXI.Sprite.from(PIXI.Texture.WHITE);
        this.icon.anchor.set(0.5);
        this.icon.width = 54;
        this.icon.height = 54;
        this.icon.x = 42;
        this.icon.y = this.h / 2;
        this.icon.visible = false;
        this.addChild(this.icon);

        this.titleText = new PIXI.Text("", {
            ...MergeAssets.MainFont,
            fontSize: 22
        });
        this.titleText.anchor.set(0, 0);
        this.titleText.x = 80;
        this.titleText.y = 10;
        this.addChild(this.titleText);

        this.progressText = new PIXI.Text("", {
            ...MergeAssets.MainFont,
            fontSize: 18
        });
        this.progressText.anchor.set(0, 0);
        this.progressText.x = 80;
        this.progressText.y = 38;
        this.addChild(this.progressText);

        // Progress bar (simple sprite fill)
        this.barBg = PIXI.Sprite.from(PIXI.Texture.WHITE);
        this.barBg.alpha = 0.25;
        this.barBg.width = 220;
        this.barBg.height = 10;
        this.barBg.x = 80;
        this.barBg.y = 66;
        this.addChild(this.barBg);

        this.barFill = PIXI.Sprite.from(PIXI.Texture.WHITE);
        this.barFill.width = 0;
        this.barFill.height = 10;
        this.barFill.x = 80;
        this.barFill.y = 66;
        this.addChild(this.barFill);

        // Claim chest icon
        this.chestIcon = PIXI.Sprite.from(PIXI.Texture.from(MergeAssets.Textures.Icons.Check || MergeAssets.Textures.Icons.Coin));
        this.chestIcon.anchor.set(0.5);
        this.chestIcon.width = 44;
        this.chestIcon.height = 44;

        // Claim button
        this.claimButton = new BaseButton({
            standard: {
                width: 120,
                height: 52,
                allPadding: 8,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Green || MergeAssets.Textures.Buttons.Blue),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 20 })
            },
            over: { tint: 0xeeeeee },
            click: {
                callback: () => {
                    const claimed = MissionManager.instance.claimActive();
                    if (claimed) {
                        this.playClaimFx();
                    }
                }
            }
        });
        this.claimButton.setLabel('Claim')
        this.claimButton.x = this.w - 130;
        this.claimButton.y = (this.h - 52) / 2;
        this.addChild(this.claimButton);

        this.chestIcon.x = this.claimButton.x - 28;
        this.chestIcon.y = this.h / 2;
        this.addChild(this.chestIcon);

        this.setClaimVisible(false);

        // Bind to mission manager
        MissionManager.instance.onActiveMissionChanged.add((def: MissionDefinition | null) => {
            this.applyMission(def);
        });

        MissionManager.instance.onActiveMissionProgress.add((progress: number, target: number, completed: boolean) => {
            this.applyProgress(progress, target, completed);
        });


        // inside MissionHUD constructor
        MissionManager.instance.onNextMissionTimerChanged.add((remainingSec: number) => {
            if (this.activeDef) return;

            if (remainingSec > 0) {
                this.visible = true;
                this.titleText.text = "Next mission";
                this.progressText.text = `In ${remainingSec}s`;
                this.barFill.width = 0;
                this.setClaimVisible(false);
            } else if (!MissionManager.instance.activeMissionDef) {
                this.visible = false;
            }
        });

        // Initial paint if already init’d:
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
        this.titleText.text = def.title;

        if (def.iconTextureId) {
            this.icon.texture = PIXI.Texture.from(def.iconTextureId);
            this.icon.visible = true;
        } else {
            this.icon.visible = false;
        }

        if (def.chestTextureId) {
            this.chestIcon.texture = PIXI.Texture.from(def.chestTextureId);
        }

        // reset visuals
        this.progressText.text = "";
        this.barFill.width = 0;
        this.setClaimVisible(false);
    }

    private applyProgress(progress: number, target: number, completed: boolean): void {
        const p = Math.min(progress, target);
        this.progressText.text = `${p} / ${target}`;

        const ratio = target <= 0 ? 0 : (p / target);
        this.barFill.width = Math.floor(220 * ratio);

        this.setClaimVisible(completed);
    }

    private setClaimVisible(visible: boolean): void {
        this.claimButton.visible = visible;
        this.chestIcon.visible = visible;
    }

    private playClaimFx(): void {
        gsap.fromTo(this.scale, { x: 1, y: 1 }, { x: 1.04, y: 1.04, duration: 0.12, yoyo: true, repeat: 1 });
        gsap.fromTo(this, { alpha: 1 }, { alpha: 0.85, duration: 0.08, yoyo: true, repeat: 1 });
    }
}
