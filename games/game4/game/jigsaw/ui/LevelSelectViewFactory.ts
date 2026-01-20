// LevelSelectViewFactory.ts
import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import ViewUtils from "@core/utils/ViewUtils";
import type { Difficulty, LevelDefinition, SectionDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import Assets from "../Assets";
import { InGameEconomy } from "../data/InGameEconomy";
import { getLevelDifficultyCompleted, getSectionCompletion } from "../progress/progressUtils";
import { makeResizedSpriteTexture } from "../vfx/imageFlatten";
import { getDifficultySkinKey, getSectionOverride, type LevelSelectTheme } from "./LevelSelectViewElements";

// IMPORTANT: adjust this import path to your project

export interface HeaderView {
    root: PIXI.Container;
    titleText: PIXI.Text;
    backButton: BaseButton;
    closeButton: BaseButton;
    setSize: (w: number, h: number) => void;
}

export class LevelSelectViewFactory {
    private readonly theme: LevelSelectTheme;

    public constructor(theme: LevelSelectTheme) {
        this.theme = theme;
    }

    public createHeader(viewW: number): HeaderView {
        const root = new PIXI.Container();

        const bg = new PIXI.NineSlicePlane(
            this.theme.headerBgTexture,
            this.theme.headerBgNineSlice.left,
            this.theme.headerBgNineSlice.top,
            this.theme.headerBgNineSlice.right,
            this.theme.headerBgNineSlice.bottom
        );
        bg.width = viewW;
        bg.height = this.theme.headerHeight;
        root.addChild(bg);

        const titleText = new PIXI.Text("", this.theme.titleStyle);
        root.addChild(titleText);
        titleText.anchor.set(0, 0.5)
        titleText.y = 0//this.theme.headerHeight / 2

        const backSkin = this.theme.buttonSkins.back;
        const closeSkin = this.theme.buttonSkins.secondary;

        const backButton = new BaseButton({
            standard: {
                ...backSkin.standard
            },
            over: { ...backSkin.over },

        });

        const closeButton = new BaseButton({
            standard: {
                texture: closeSkin.standard.texture,
                width: closeSkin.standard.width,
                height: closeSkin.standard.height,
                allPadding: closeSkin.standard.allPadding,
                fontStyle: closeSkin.standard.fontStyle,
            },
            over: {
                ...closeSkin.over
            },
        });

        // closeButton.setLabel('Close')
        //backButton.setLabel('Back')

        //root.addChild(backButton, closeButton);
        root.addChild(backButton);

        const setSize = (w: number, h: number) => {
            bg.width = w;
            bg.height = h;

            titleText.x = 100;
            titleText.y = Math.floor((this.theme.headerHeight) * 0.5 + Assets.Offsets.UI.Header.y);

            // Right aligned buttons
            // closeButton.x = w - closeButton.width - 16;
            // closeButton.y = Math.floor((h - closeButton.height) * 0.5);

            //backButton.x = closeButton.x - backButton.width - 12;
            backButton.x = w - backButton.width - 16;
            backButton.y = Math.floor((h - backButton.height) * 0.5) + Assets.Offsets.UI.Header.y;

        };

        setSize(viewW, this.theme.headerHeight);

        return {
            root,
            titleText,
            backButton,
            closeButton,
            setSize,
        };
    }

    public createSectionCard(
        section: SectionDefinition,
        w: number,
        h: number,
        progress: any
    ): PIXI.Container {
        const root = new PIXI.Container();
        root.eventMode = "static";
        root.cursor = "pointer";

        const override = getSectionOverride(this.theme, (section as any).id ?? section.name);
        const pad = this.theme.padding;

        // --- 1. CARD BACKGROUND ---
        if (this.theme.sectionCard.useNineSliceCardBg) {
            const tex = override?.cardTexture ?? this.theme.sectionCard.cardBgTexture ?? PIXI.Texture.WHITE;
            const ns = this.theme.sectionCard.cardBgNineSlice ?? { left: 16, top: 16, right: 16, bottom: 16 };
            const cardBg = new PIXI.NineSlicePlane(tex, ns.left, ns.top, ns.right, ns.bottom);
            cardBg.width = w;
            cardBg.height = h;
            root.addChild(cardBg);
        } else {
            const g = new PIXI.Graphics().beginFill(0x2a2a2a).drawRoundedRect(0, 0, w, h, 14).endFill();
            root.addChild(g);
        }

        // --- 2. COVER PREPARATION ---
        const coverH = Math.floor(h * this.theme.sectionCard.coverHeightRatio);
        const coverLevel = section.levels.find((l) => l.id === (section as any).coverLevelId) ?? section.levels[0];

        const coverContainer = new PIXI.Container();
        coverContainer.x = pad;
        coverContainer.y = pad;
        root.addChild(coverContainer);

        const mask = new PIXI.Graphics();
        mask.beginFill(0xff0000);
        mask.drawRoundedRect(0, 0, w - pad * 2, coverH - pad * 2, 30);
        mask.endFill();
        coverContainer.addChild(mask);

        // Initial Sprite (White placeholder if no thumb)
        const coverSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        coverSprite.anchor.set(0.5);
        coverSprite.x = (w - pad * 2) / 2;
        coverSprite.y = (coverH - pad * 2) / 2;
        coverSprite.mask = mask;
        coverContainer.addChild(coverSprite);

        const targetW = w - pad * 2;
        const targetH = coverH - pad * 2;

        // --- 3. SYNC vs ASYNC TEXTURE LOGIC ---
        if (coverLevel?.thumb) {
            // CASE A: Thumb exists in cache/atlas - apply immediately
            coverSprite.texture = PIXI.Texture.from(coverLevel.thumb);
            const scale = ViewUtils.elementEvelop(coverSprite, targetW, targetH);
            coverSprite.scale.set(scale + 0.05);
        }
        else if (coverLevel?.imageSrc) {
            // CASE B: No thumb, must load image file async
            PIXI.Assets.load(coverLevel.imageSrc).then((tex: PIXI.Texture) => {
                if (coverSprite.destroyed) return;
                coverSprite.texture = tex;
                const scale = ViewUtils.elementEvelop(coverSprite, targetW, targetH);
                coverSprite.scale.set(scale + 0.05);
            });
        }
        else if (override?.defaultCoverTexture) {
            coverSprite.texture = override.defaultCoverTexture;
            const scale = ViewUtils.elementEvelop(coverSprite, targetW, targetH);
            coverSprite.scale.set(scale + 0.05);
        }

        // --- 4. UI OVERLAYS (BADGES & TEXT) ---
        const overlay = new PIXI.Graphics()
            .beginFill(0x000000, this.theme.sectionCard.coverOverlayAlpha)
            .drawRoundedRect(pad, pad, w - pad * 2, coverH - pad * 2, 30)
            .endFill();
        root.addChild(overlay);

        if (section.type === 1 || section.type === 2) {
            const isType1 = section.type === 1;
            const badgeTex = isType1 ? Assets.Textures.Icons.Badge1 : Assets.Textures.Icons.Badge2;
            const labelText = isType1 ? Assets.Labels.Hot : Assets.Labels.New;

            const badge = PIXI.Sprite.from(badgeTex);
            badge.anchor.set(0.5);
            badge.scale.set(ViewUtils.elementScaler(badge, 100));
            badge.x = 20;
            badge.y = 20;
            badge.rotation = -0.3;
            root.addChild(badge);

            const badgeText = new PIXI.Text(labelText, { ...Assets.MainFont });
            badgeText.anchor.set(0.5);
            badge.addChild(badgeText);
        }

        const nameText = new PIXI.Text(section.name, override?.cardTitleStyle ?? this.theme.sectionCard.cardTitleStyle);
        nameText.x = pad;
        nameText.y = h - nameText.height - pad;
        root.addChild(nameText);

        const completionStyle = override?.cardCompletionStyle ?? this.theme.sectionCard.cardCompletionStyle;
        const completionText = new PIXI.Text("", completionStyle);
        const compData = getSectionCompletion(progress, section);
        const pct = compData.total > 0 ? Math.floor((compData.done / compData.total) * 100) : 0;
        completionText.text = `${pct}%`;
        completionText.anchor.set(0.5);

        if (this.theme.sectionCard.completionPillTexture && this.theme.sectionCard.completionPillNineSlice) {
            const ns = this.theme.sectionCard.completionPillNineSlice;
            const pill = new PIXI.NineSlicePlane(this.theme.sectionCard.completionPillTexture, ns.left, ns.top, ns.right, ns.bottom);
            pill.width = 80;
            pill.height = 80;
            pill.x = w - pill.width - 12;
            pill.y = h - pill.height - pad;
            root.addChild(pill);
            completionText.x = pill.x + pill.width / 2;
            completionText.y = pill.y + pill.height / 2;
            root.addChild(completionText);
        } else {
            completionText.x = w - completionText.width - 12;
            completionText.y = h - pad - 20;
            root.addChild(completionText);
        }

        return root;
    }

    public createLevelRow(
        level: LevelDefinition,
        section: SectionDefinition,
        w: number,
        h: number,
        progress: any,
        unlocked: boolean,
        onDifficultyPressed: (levelId: string, difficulty: Difficulty) => void,
        onPurchasePressed: (levelId: string) => void
    ): PIXI.Container {
        const root = new PIXI.Container();

        // Background
        if (this.theme.levelRow.useNineSliceBg && this.theme.levelRow.bgTexture && this.theme.levelRow.bgNineSlice) {
            const ns = this.theme.levelRow.bgNineSlice;
            const bg = new PIXI.NineSlicePlane(unlocked ? this.theme.levelRow.bgTexture : this.theme.levelRow.bgTextureLocked, ns.left, ns.top, ns.right, ns.bottom);
            bg.width = w;
            bg.height = h;
            root.addChild(bg);
        }
        else {
            const g = new PIXI.Graphics();
            g.beginFill(0x242424);
            g.drawRoundedRect(0, 0, w, h, this.theme.levelRow.rowCornerRadius);
            g.endFill();
            root.addChild(g);
        }

        const pad = this.theme.levelRow.rowPadding;
        const thumbSize = this.theme.levelRow.thumbSize;

        const title = new PIXI.Text(level.name, this.theme.levelRow.titleStyle);
        title.x = w / 2;
        title.y = pad / 2// thumbSize + pad * 2;
        title.anchor.set(0.5, 0)
        root.addChild(title);


        const thumbC = new PIXI.Container();
        const thumb = PIXI.Sprite.from(level.thumb || level.imageSrc);
        thumb.width = thumbSize;
        thumb.height = thumbSize;
        thumb.scale.set(ViewUtils.elementEvelop(thumb, thumbSize))

        const mask = new PIXI.Graphics();
        mask.beginFill(0x2a2a2a);
        mask.drawRoundedRect(0, 0, thumbSize, thumbSize, 14);
        mask.endFill();
        thumb.mask = mask;

        thumbC.addChild(thumb);

        const c2 = makeResizedSpriteTexture(Game.renderer, thumbC, 0, 0)
        root.addChild(c2);
        c2.x = !unlocked ? w / 2 - thumbSize / 2 : w / 2 - thumbSize - pad;
        c2.y = title.y + title.height + 10;

        const yBtn = c2.y + thumbSize + pad / 2 + 10;
        thumbC.destroy();
        thumb.destroy();


        if (!unlocked) {
            const cost = level.unlockCost ?? 0;

            const purchaseBtn = this.createPurchaseButton(cost, level.id, onPurchasePressed);
            purchaseBtn.x = w / 2 - purchaseBtn.width / 2;
            purchaseBtn.y = yBtn;
            root.addChild(purchaseBtn);

            return root;
        }

        const diffs: Difficulty[] = ["easy", "medium", "hard"];
        const spacing = 10;
        // 1. Calculate the total width of all buttons and their gaps
        const rewardsList = this.createDifficultyRewardsList(level.id, progress, level);
        rewardsList.x = c2.x + thumbSize + 20;
        rewardsList.y = c2.y + 5;
        root.addChild(rewardsList);
        // 2. Set the starting x so the group is centered

        const btnW = this.theme.buttonSkins['difficultyEasy'];
        const totalWidth = (diffs.length * btnW.standard.width) + ((diffs.length - 1) * spacing);
        let currentX = (w - totalWidth) / 2;

        for (const d of diffs) {
            const done = getLevelDifficultyCompleted(progress, level.id, d);
            const btn = this.createDifficultyButton((section as any).id ?? section.name, d, done);

            // 3. Position the button
            btn.x = currentX;
            btn.y = yBtn;

            btn.on("pointertap", () => {
                onDifficultyPressed(level.id, d);
            });

            let label = "medium"
            if (d == "easy") {
                label = "small"
            } else if (d == "hard") {
                label = "large"
            }
            btn.setLabel(label);
            root.addChild(btn);

            // 4. Increment x for the next button
            currentX += btn.width + spacing;
        }

        return root;
    }
    private createPurchaseButton(cost: number, id: string, onPurchasePressed: (levelId: string) => void): BaseButton {
        const skin = this.theme.buttonSkins["purchase"];
        const economy = InGameEconomy.instance; // Import your Singleton

        const btn = new BaseButton({
            standard: { ...skin.standard },
            over: { ...skin.over },
            disabled: { ...skin.disabled },
            down: {
                texture: skin.down?.texture,
                callback: () => {
                    onPurchasePressed(id);
                }
            },
        });

        //btn.setLabel(`Unlock ${cost}`);
        btn.setLabel(`${cost}`);

        // Function to update the button state
        // const updateEnableState = (currentCoins: number) => {
        //     if (currentCoins < cost) {
        //         btn.disable();
        //         // Optional: set alpha or tint to look "greyed out" if BaseButton doesn't do it
        //         btn.alpha = 0.5;
        //     } else {
        //         btn.enable();
        //         btn.alpha = 1;
        //     }
        // };

        // Initial check

        const updateEnableState = () => {
            const hasNormal = economy.coins >= cost;
            // const hasSpecial = economy.gems >= specialCost; // if applicable

            if (hasNormal) {
                btn.enable();
                btn.alpha = 1;
            } else {
                btn.disable();
                // btn.alpha = 0.5;
            }
        };
        updateEnableState();

        economy.onCoinsChanged.add(updateEnableState);
        economy.onGemsChanged.add(updateEnableState);

        // Listen for future changes
        economy.onCoinsChanged.add(updateEnableState);

        // IMPORTANT: Cleanup to prevent memory leaks when the row is destroyed
        btn.on('destroyed', () => {
            console.log('destroy')
            economy.onCoinsChanged.remove(updateEnableState);
            economy.onGemsChanged.remove(updateEnableState);
        });

        return btn;
    }
    public createDifficultyButton(sectionId: string | undefined, d: Difficulty, completed: boolean): BaseButton {
        const skinKey = getDifficultySkinKey(this.theme, sectionId, d);
        const skin = this.theme.buttonSkins[skinKey];

        const str = completed ? { ...skin.standard, ...skin.completed } : { ...skin.standard };

        const btn = new BaseButton({
            standard: str,
            over: { ...skin.over },
            down: {
                texture: skin.down?.texture,
            },
        });

        return btn;
    }

    private createDifficultyRewardsList(levelId: string, progress: any, definition: LevelDefinition): PIXI.Container {
        const container = new PIXI.Container();
        const diffs: Difficulty[] = ["easy", "medium", "hard"];
        const rowHeight = 35; // Adjust based on your UI scale
        const iconSize = 30;

        let c = 0
        diffs.forEach((d, index) => {
            const row = new PIXI.Container();
            row.y = index * (rowHeight + 5);

            const isCompleted = getLevelDifficultyCompleted(progress, levelId, d);

            // 1. Level/Status Icon
            let statusIcon: PIXI.Sprite;
            if (isCompleted) {
                statusIcon = PIXI.Sprite.from(Assets.Textures.Icons.CheckItem); // Replace with your check asset key
                //(statusIcon as PIXI.Sprite).tint = 0x00FF00;
            } else {
                statusIcon = PIXI.Sprite.from(`jiggy${d}`); // Replace with difficulty icons
            }
            //statusIcon.width = statusIcon.height = iconSize;

            statusIcon.scale.set(ViewUtils.elementScaler(statusIcon, iconSize, iconSize))
            row.addChild(statusIcon);

            const p = definition.isSpecial ? definition.prizesSpecial[c] : definition.prize[c]
            // 2. Text (Value or "Completed")
            const labelText = isCompleted ? "COMPLETED" : p; // Example reward value
            c++
            const style = isCompleted ? this.theme.levelRow.questStyle : this.theme.levelRow.questStyle;
            const txt = new PIXI.Text(labelText, style || { fontSize: 14, fill: 0xffffff });
            txt.x = iconSize + 10;
            row.addChild(txt);

            // 3. Currency Icon (Only if not completed)
            if (!isCompleted) {
                const t = definition.isSpecial ? Assets.Textures.Icons.Gem : Assets.Textures.Icons.Coin
                const coin = PIXI.Sprite.from(t);
                coin.scale.set(ViewUtils.elementScaler(coin, iconSize, iconSize))

                coin.x = txt.x + txt.width + 5;
                coin.y = 2;
                row.addChild(coin);
            }

            container.addChild(row);
        });

        return container;
    }
}
