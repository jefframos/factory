// ui/timedRewards/TimedRewardsBar.ts
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";
import { TimedRewardService } from "../../timedRewards/TimedRewardService";
import { TimedRewardDefinition } from "../../timedRewards/TimedRewardTypes";
import { TimedRewardSlot } from "./TimedRewardSlot";

export interface NineSliceDef {
    texture: PIXI.Texture;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface TimedRewardsBarTheme {
    width: number;
    height: number;

    barBg: NineSliceDef;
    barFill: NineSliceDef;
    barFillTint: number;

    fontStyleTimer: PIXI.TextStyle;
    fontStylePrize: PIXI.TextStyle;

    iconMoney: PIXI.Texture;
    iconGems: PIXI.Texture;
    iconFire: PIXI.Texture;
    iconEntity: PIXI.Texture;

    checkIcon: PIXI.Texture;
}

// ui/timedRewards/TimedRewardsBar.ts
export class TimedRewardsBar extends PIXI.Container {
    private readonly service: TimedRewardService;
    private readonly theme: TimedRewardsBarTheme;

    private bg!: PIXI.NineSlicePlane;
    private fillPlane!: PIXI.NineSlicePlane;
    private timerText!: PIXI.BitmapText;
    private timerIcon!: PIXI.Sprite;
    private ticks!: PIXI.Graphics;
    private slotComponents: TimedRewardSlot[] = [];

    // Constant for the internal bar padding
    private readonly PADDING = 4;

    public constructor(service: TimedRewardService, theme: TimedRewardsBarTheme) {
        super();
        this.service = service;
        this.theme = theme;
        this.build();
        this.wire();
        this.refresh();
    }

    private build(): void {
        const { width: w, height: h, barBg, barFill } = this.theme;

        this.pivot.x = w / 2
        // Background - remains full size
        this.bg = new PIXI.NineSlicePlane(barBg.texture, barBg.left, barBg.top, barBg.right, barBg.bottom);
        this.bg.width = w;
        this.bg.height = h;
        this.addChild(this.bg);

        // Fill plane - adjusted for padding
        this.fillPlane = new PIXI.NineSlicePlane(barFill.texture, barFill.left, barFill.top, barFill.right, barFill.bottom);
        this.fillPlane.position.set(this.PADDING, this.PADDING);
        this.fillPlane.height = h - (this.PADDING * 2);
        this.fillPlane.tint = this.theme.barFillTint;
        this.addChild(this.fillPlane);

        this.ticks = new PIXI.Graphics();
        this.addChild(this.ticks);

        this.timerText = new PIXI.BitmapText("00:00", {
            fontName: this.theme.fontStyleTimer.fontFamily,
            fontSize: 22,
            letterSpacing: 2
        });


        this.timerText.anchor.set(1, 0.5);
        this.timerText.position.set(-30, h / 2 - 5);
        this.addChild(this.timerText);


        this.timerIcon = PIXI.Sprite.from(MergeAssets.Textures.Icons.Timer)
        this.addChild(this.timerIcon);
        this.timerIcon.anchor.set(1, 0.5)
        this.timerIcon.scale.set((ViewUtils.elementScaler(this.timerIcon, h * 1.5)))
        this.timerIcon.x = 13
        this.timerIcon.y = h / 2 - 4

        // Initialize reusable slots (positions will be updated in refresh)
        const slotCount = 3;
        for (let i = 0; i < slotCount; i++) {
            const slot = new TimedRewardSlot(this.theme.fontStylePrize, this.theme.checkIcon);
            slot.y = h * 0.62;
            slot.visible = false;
            this.addChild(slot);
            this.slotComponents.push(slot);
        }
    }

    public refresh(): void {
        const p = this.service.getBarProgress01();
        const w = this.theme.width;
        const h = this.theme.height;

        // Calculate available width for the fill based on padding
        const maxFillWidth = w - (this.PADDING * 2);
        const minNineSliceWidth = this.theme.barFill.left + this.theme.barFill.right;

        this.fillPlane.width = Math.max(minNineSliceWidth, maxFillWidth * p);
        this.fillPlane.visible = p > 0;

        this.timerText.text = formatMMSS(this.service.getTotalTimer());

        const visible = this.service.getVisibleMilestones();
        this.ticks.clear();
        this.ticks.lineStyle(2, 0xffffff, 0.35);

        for (let i = 0; i < this.slotComponents.length; i++) {
            const comp = this.slotComponents[i];
            const m = visible[i];

            if (!m) {
                comp.visible = false;
                continue;
            }

            comp.visible = true;

            // Positioning the icon exactly where the fill will reach for this milestone
            const milestonePos01 = this.service.getMilestonePos01(m.milestoneSeconds);
            // We align the icon center with the milestone tick
            comp.x = this.PADDING + (maxFillWidth * milestonePos01);

            const texture = m.definition.icon || pickIcon(m.definition, this.theme);
            const claimed = this.service.isMilestoneClaimed(m.milestoneIndex);

            comp.setup(texture, formatMSS(m.milestoneSeconds), claimed);
            //comp.setup(texture, formatShort(m.milestoneSeconds), claimed);

            // Draw ticks relative to the background/container
            const tx = Math.floor(comp.x);
            this.ticks.moveTo(tx, this.PADDING);
            this.ticks.lineTo(tx, h - this.PADDING);
        }
    }

    private wire(): void {
        this.service.onChanged.add(() => this.refresh());
    }
}
function pickIcon(def: TimedRewardDefinition, theme: TimedRewardsBarTheme): PIXI.Texture {
    switch (def.reward.kind) {
        case "money_percent_or_min":
            return theme.iconMoney;
        case "gems_fixed":
            return theme.iconGems;
        case "combo":
            return theme.iconFire;
        case "spawn_high_entity":
            return theme.iconEntity;
    }
    return theme.iconEntity;
}

function formatMMSS(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;

    const mmStr = mm < 10 ? `0${mm}` : `${mm}`;
    const ssStr = ss < 10 ? `0${ss}` : `${ss}`;

    return `${mmStr}:${ssStr}`;
}

function formatMSS(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = Math.floor(s / 60);
    const ss = s % 60;

    const mmStr = mm < 10 ? `${mm}` : `${mm}`;
    const ssStr = ss < 10 ? `0${ss}` : `${ss}`;

    return `${mmStr}:${ssStr}`;
}

function formatShort(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));

    if (s < 60) {
        return `${s}s`;
    }

    // If it’s an exact minute, use Xm; otherwise use Ms with rounding down
    if (s % 60 === 0) {
        return `${Math.floor(s / 60)}m`;
    }

    // for non-exact, prefer seconds for clarity (optional)
    return `${Math.floor(s / 60)}m`;
}
