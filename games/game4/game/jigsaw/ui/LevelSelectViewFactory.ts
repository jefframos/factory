import BaseButton from "@core/ui/BaseButton";
import ViewUtils from "@core/utils/ViewUtils";
import type { Difficulty, LevelDefinition, SectionDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import Assets from "../Assets";
import { InGameEconomy } from "../data/InGameEconomy";
import { getSectionCompletion } from "../progress/progressUtils";
import { getDifficultySkinKey, type LevelSelectTheme } from "./LevelSelectViewElements";

export interface HeaderView {
    root: PIXI.Container;
    titleText: PIXI.Text;
    backButton: BaseButton;
    closeButton: BaseButton;
    setSize: (w: number, h: number) => void;
}

export interface SectionCardComponent extends PIXI.Container {
    update: (section: SectionDefinition, progress: any) => void;
}

export interface LevelRowComponent extends PIXI.Container {
    update: (level: LevelDefinition, section: SectionDefinition, progress: any, unlocked: boolean) => void;
}

export class LevelSelectViewFactory {
    private readonly theme: LevelSelectTheme;

    public constructor(theme: LevelSelectTheme) {
        this.theme = theme;
    }

    public createHeader(viewW: number): HeaderView {
        const root = new PIXI.Container();
        let bg = null
        if (this.theme.headerBgTexture) {

            bg = new PIXI.NineSlicePlane(
                this.theme.headerBgTexture,
                this.theme.headerBgNineSlice.left,
                this.theme.headerBgNineSlice.top,
                this.theme.headerBgNineSlice.right,
                this.theme.headerBgNineSlice.bottom
            );
            root.addChild(bg);
        }

        const titleText = new PIXI.Text("", this.theme.titleStyle);
        titleText.anchor.set(0, 0.5);
        root.addChild(titleText);

        const backSkin = this.theme.buttonSkins.back;
        const backButton = new BaseButton({
            standard: { ...backSkin.standard },
            over: { ...backSkin.over },
        });

        const closeButton = new BaseButton({
            standard: { ...this.theme.buttonSkins.secondary.standard },
        });

        root.addChild(backButton);

        const setSize = (w: number, h: number) => {
            if (bg) {

                bg.width = w;
                bg.height = h;
            }
            titleText.x = 100;
            titleText.y = Math.floor(h * 0.5 + Assets.Offsets.UI.Header.y);
            backButton.x = 15//w - backButton.width - 16;
            backButton.y = Math.floor((h - backButton.height) * 0.5) + Assets.Offsets.UI.Header.y;
        };

        setSize(viewW, this.theme.headerHeight);
        return { root, titleText, backButton, closeButton, setSize };
    }

    public createSectionCard(section: SectionDefinition, w: number, h: number, progress: any): SectionCardComponent {
        const root = new PIXI.Container() as SectionCardComponent;
        root.eventMode = "static";
        root.cursor = "pointer";

        const pad = this.theme.padding;

        // 1. BG
        const cardBg = new PIXI.NineSlicePlane(
            this.theme.sectionCard.cardBgTexture ?? PIXI.Texture.WHITE,
            this.theme.sectionCard.cardBgNineSlice?.left ?? 16,
            this.theme.sectionCard.cardBgNineSlice?.top ?? 16,
            this.theme.sectionCard.cardBgNineSlice?.right ?? 16,
            this.theme.sectionCard.cardBgNineSlice?.bottom ?? 16
        );
        cardBg.width = w;
        cardBg.height = h;
        root.addChild(cardBg);

        // 2. Cover & Mask
        const coverH = Math.floor(h * this.theme.sectionCard.coverHeightRatio);
        const coverSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        coverSprite.anchor.set(0.5);
        coverSprite.position.set(w / 2, coverH / 2);
        coverSprite.scale.set(ViewUtils.elementEvelop(coverSprite, w, h));

        const mask = new PIXI.Graphics().beginFill(0xff0000).drawRoundedRect(pad / 2, pad / 2, w - pad, coverH - pad, 10).endFill();
        coverSprite.mask = mask;
        root.addChild(mask, coverSprite);

        // 3. Badges
        const badgeGroup = new PIXI.Container();
        const badgeSprite = new PIXI.Sprite();
        badgeSprite.anchor.set(0.5);
        const badgeText = new PIXI.Text("", { ...Assets.MainFont });
        badgeText.anchor.set(0.5);
        badgeGroup.addChild(badgeSprite, badgeText);
        badgeGroup.position.set(50, 50);
        badgeGroup.rotation = -0.2;
        root.addChild(badgeGroup);

        // 4. Labels
        const nameText = new PIXI.Text("", this.theme.sectionCard.cardTitleStyle);
        nameText.x = pad;
        root.addChild(nameText);

        // NEW: Puzzle Count Label
        const puzzleCountText = new PIXI.Text("", {
            ...this.theme.sectionCard.cardCompletionStyle,
            fontSize: 16, // Slightly smaller than title
            //alpha: 0.8    // Slightly faded for hierarchy
        });
        puzzleCountText.x = pad;
        root.addChild(puzzleCountText);

        const completionPill = new PIXI.Sprite(this.theme.sectionCard.completionPillTexture!);
        completionPill.anchor.set(0.5);

        const completionText = new PIXI.Text("", this.theme.sectionCard.cardCompletionStyle);
        completionText.anchor.set(0.5);
        completionPill.addChild(completionText);
        root.addChild(completionPill);

        root.update = (s, prog) => {
            nameText.text = s.name;

            // Update Puzzle Count text
            puzzleCountText.text = `${s.levels.length} Puzzles`;

            // Stacked Positioning: Name above Puzzle Count
            const totalTextHeight = nameText.height + puzzleCountText.height;
            nameText.y = h - totalTextHeight - pad / 2;
            puzzleCountText.y = nameText.y + nameText.height;

            // Update Badge
            if (s.type === 1 || s.type === 2) {
                badgeGroup.visible = true;
                badgeSprite.texture = PIXI.Texture.from(s.type === 1 ? Assets.Textures.Icons.Badge1 : Assets.Textures.Icons.Badge2);
                badgeText.text = s.type === 1 ? Assets.Labels.Hot : Assets.Labels.New;
                badgeSprite.scale.set(ViewUtils.elementScaler(badgeSprite, 100));
            } else {
                badgeGroup.visible = false;
            }

            // Update Completion
            const compData = getSectionCompletion(prog, s);
            const pct = compData.total > 0 ? Math.floor((compData.done / compData.total) * 100) : 0;
            completionText.text = `${pct}%`;

            completionPill.position.set(w - pad - 20, h - pad - 20);
            completionText.position.set(0, 0);
            completionText.scale.set(2);
            completionPill.scale.set(ViewUtils.elementScaler(completionPill, 80));

            // Image loading logic
            const coverLevel = s.levels.find((l) => l.id === (s as any).coverLevelId) ?? s.levels[0];
            const imgSrc = coverLevel?.thumb || coverLevel?.imageSrc;

            if (imgSrc) {
                const targetW = w - pad * 2;
                const targetH = coverH - pad;

                const applyTexture = (tex: PIXI.Texture) => {
                    coverSprite.texture = tex;
                    const scale = ViewUtils.elementEvelop(coverSprite, w, h)
                    coverSprite.scale.set(scale + 0.05);
                };

                if (PIXI.Assets.cache.has(imgSrc)) {
                    applyTexture(PIXI.Assets.get(imgSrc));
                } else {
                    PIXI.Assets.load(imgSrc).then((tex) => {
                        if (!root.destroyed) applyTexture(tex);
                    });
                }
            }
        };

        root.update(section, progress);
        return root;
    }

    public createLevelRow(
        level: LevelDefinition,
        section: SectionDefinition,
        w: number,
        h: number,
        progress: any,
        unlocked: boolean,
        onDifficultyPressed: (id: string, d: Difficulty) => void,
        onPurchasePressed: (id: string) => void
    ): LevelRowComponent {
        const root = new PIXI.Container() as LevelRowComponent;
        const pad = this.theme.levelRow.rowPadding;

        // 1. Unified dimensions logic to match Section Card
        const thumbW = this.theme.levelRow.thumbWidth ?? this.theme.levelRow.thumbSize;
        const thumbH = this.theme.levelRow.thumbHeight ?? this.theme.levelRow.thumbSize;

        const bg = new PIXI.NineSlicePlane(this.theme.levelRow.bgTexture!, 40, 40, 40, 40);
        bg.width = w;
        bg.height = h;
        root.addChild(bg);

        const title = new PIXI.Text("", this.theme.levelRow.titleStyle);
        title.anchor.set(0.5, 0);
        title.position.set(w / 2, pad);
        root.addChild(title);

        // 2. Thumbnail Logic (Synced with Section Card)
        const thumbContainer = new PIXI.Container();
        const thumbSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        thumbSprite.anchor.set(0.5);

        // Center-crop Mask (Drawn from center to match Section Card style)
        const thumbMask = new PIXI.Graphics()
            .beginFill(0x000000)
            .drawRoundedRect(-thumbW / 2, -thumbH / 2, thumbW, thumbH, 14)
            .endFill();

        thumbSprite.mask = thumbMask;
        thumbContainer.addChild(thumbMask, thumbSprite);

        // Position the container at the vertical center of the row (or adjusted for title)
        thumbContainer.position.set(w / 2, h / 2);
        root.addChild(thumbContainer);

        // Groups for Lock/Unlock states
        const lockedGroup = new PIXI.Container();
        const unlockedGroup = new PIXI.Container();
        root.addChild(lockedGroup, unlockedGroup);

        const purchaseBtn = this.createPurchaseButton(onPurchasePressed);
        lockedGroup.addChild(purchaseBtn);

        const diffs: Difficulty[] = ["easy", "medium", "hard"];
        const diffBtns = diffs.map((d) => {
            const btn = this.createDifficultyButton(undefined, d, false);
            btn.on("pointertap", () => (root as any).currentLevelId && onDifficultyPressed((root as any).currentLevelId, d));
            unlockedGroup.addChild(btn);
            return btn;
        });

        const rewardsContainer = new PIXI.Container();
        unlockedGroup.addChild(rewardsContainer);

        root.update = (lvl, sec, prog, isUnlocked) => {
            (root as any).currentLevelId = lvl.id;
            title.text = lvl.name;
            bg.texture = isUnlocked ? this.theme.levelRow.bgTexture! : this.theme.levelRow.bgTextureLocked!;

            // 3. Texture Application (Identical to Section Card)
            const imgSrc = lvl.thumb || lvl.imageSrc;
            if (imgSrc) {
                const applyTex = (tex: PIXI.Texture) => {
                    thumbSprite.texture = tex;
                    // Scale to fill the mask area (thumbW/thumbH) + bleed
                    const scale = ViewUtils.elementEvelop(thumbSprite, thumbW, thumbH);
                    thumbSprite.scale.set(scale + 0.05);
                };

                PIXI.Assets.cache.has(imgSrc) ? applyTex(PIXI.Assets.get(imgSrc)) : PIXI.Assets.load(imgSrc).then(applyTex);
            }

            // Final UI Layout adjustments
            lockedGroup.visible = !isUnlocked;
            unlockedGroup.visible = isUnlocked;

            if (!isUnlocked) {
                purchaseBtn.setLabel(`${lvl.unlockCost}`);
                purchaseBtn.position.set(w / 2 - purchaseBtn.width / 2, h - pad - purchaseBtn.height);
            } else {
                const b1 = diffBtns[0].width;
                let curX = (w - (3 * b1 + 20)) / 2;
                diffBtns.forEach((btn, idx) => {
                    btn.setLabel(diffs[idx] === "easy" ? "small" : diffs[idx] === "hard" ? "large" : "medium");
                    btn.position.set(curX, h - pad - btn.height);
                    curX += btn.width + 10;
                });

                this.updateRewardsList(rewardsContainer, lvl.id, prog, lvl);
                rewardsContainer.position.set(pad, diffBtns[0].y - rewardsContainer.height - 5);
            }
        };

        root.update(level, section, progress, unlocked);
        return root;
    }
    private updateRewardsList(container: PIXI.Container, levelId: string, progress: any, definition: LevelDefinition) {
        container.removeChildren().forEach(c => c.destroy());
        ["easy", "medium", "hard"].forEach((d, i) => {
            const row = new PIXI.Container();
            row.x = i * 100;
            const isDone = false//getLevelDifficultyCompleted(progress, levelId, d as Difficulty);
            const icon = PIXI.Sprite.from(isDone ? Assets.Textures.Icons.CheckItem : `jiggy${d}`);
            icon.scale.set(ViewUtils.elementScaler(icon, 30, 30));
            const prizeText = new PIXI.Text((definition.isSpecial ? (definition.prizesSpecial?.[i] ?? "0") : (definition.prize?.[i] ?? "0")), this.theme.levelRow.questStyle);
            //const prizeText = new PIXI.Text(isDone ? "DONE" : (definition.isSpecial ? (definition.prizesSpecial?.[i] ?? "0") : (definition.prize?.[i] ?? "0")), this.theme.levelRow.questStyle);
            prizeText.x = 40;
            row.addChild(icon, prizeText);
            container.addChild(row);
        });
    }

    private createDifficultyButton(secId: string | undefined, d: Difficulty, done: boolean): BaseButton {
        const skin = this.theme.buttonSkins[getDifficultySkinKey(this.theme, secId, d)];
        return new BaseButton({ standard: done ? { ...skin.standard, ...skin.completed } : skin.standard, over: skin.over });
    }

    private createPurchaseButton(onPurchase: (id: string) => void): BaseButton {
        const skin = this.theme.buttonSkins["purchase"];
        const btn = new BaseButton({
            standard: skin.standard, over: skin.over, disabled: skin.disabled,
            down: { callback: () => onPurchase((btn as any).targetId) }
        });
        (btn as any).refreshState = () => {
            const canAfford = InGameEconomy.instance.coins >= ((btn as any).currentCost || 0);
            canAfford ? btn.enable() : btn.disable();
            btn.alpha = canAfford ? 1 : 0.5;
        };
        InGameEconomy.instance.onCoinsChanged.add((btn as any).refreshState);
        btn.on('destroyed', () => InGameEconomy.instance.onCoinsChanged.remove((btn as any).refreshState));
        return btn;
    }
}