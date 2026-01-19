// LevelSelectViewFactory.ts
import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import ObjectCloner from "@core/utils/ObjectCloner";
import ViewUtils from "@core/utils/ViewUtils";
import type { Difficulty, LevelDefinition, SectionDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { Fonts } from "../../character/Types";
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
            titleText.y = Math.floor((this.theme.headerHeight) * 0.5 - 5);

            // Right aligned buttons
            // closeButton.x = w - closeButton.width - 16;
            // closeButton.y = Math.floor((h - closeButton.height) * 0.5);

            //backButton.x = closeButton.x - backButton.width - 12;
            backButton.x = w - backButton.width - 16;
            backButton.y = Math.floor((h - backButton.height) * 0.5) - 5;

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
        const pad = this.theme.sectionCard.padding;

        // Card background: nine-slice (preferred) or fallback
        if (this.theme.sectionCard.useNineSliceCardBg) {
            const tex = override?.cardTexture ?? this.theme.sectionCard.cardBgTexture ?? PIXI.Texture.WHITE;
            const ns = this.theme.sectionCard.cardBgNineSlice ?? { left: 16, top: 16, right: 16, bottom: 16 };

            const cardBg = new PIXI.NineSlicePlane(tex, ns.left, ns.top, ns.right, ns.bottom);
            cardBg.width = w;
            cardBg.height = h;
            root.addChild(cardBg);
        }
        else {
            const g = new PIXI.Graphics();
            g.beginFill(0x2a2a2a);
            g.drawRoundedRect(0, 0, w, h, 14);
            g.endFill();
            root.addChild(g);
        }

        const coverH = Math.floor(h * this.theme.sectionCard.coverHeightRatio);

        const coverLevel =
            section.levels.find((l) => l.id === (section as any).coverLevelId) ?? section.levels[0];


        const coverContaienr = new PIXI.Container();
        let cover: PIXI.Sprite;
        if (coverLevel) {
            cover = PIXI.Sprite.from(coverLevel.thumb || coverLevel.imageSrc);
        }
        else if (override?.defaultCoverTexture) {
            cover = new PIXI.Sprite(override.defaultCoverTexture);
        }
        else {
            cover = PIXI.Sprite.from(PIXI.Texture.WHITE);
        }

        const mask = new PIXI.Graphics();
        mask.beginFill(0xff0000);
        mask.drawRoundedRect(0, 0, w - this.theme.padding * 2, coverH - this.theme.padding * 2, 30);
        mask.endFill();
        coverContaienr.addChild(mask);
        cover.scale.set(ViewUtils.elementEvelop(cover, w, coverH) + 0.05)
        cover.mask = mask

        cover.anchor.set(0.5, 0.5)
        cover.x = w / 2
        cover.y = h / 2
        coverContaienr.addChild(cover)
        const c2 = makeResizedSpriteTexture(Game.renderer, coverContaienr, 0, 0)
        root.addChild(c2);
        c2.x = this.theme.padding
        c2.y = this.theme.padding
        coverContaienr.destroy();
        cover.destroy();

        // Dark overlay (Graphics is fine here; cheap and static)
        const overlay = new PIXI.Graphics();
        overlay.beginFill(0x000000, this.theme.sectionCard.coverOverlayAlpha);
        overlay.drawRect(0, 0, w, coverH);
        overlay.endFill();
        root.addChild(overlay);

        const titleStyle = override?.cardTitleStyle ?? this.theme.sectionCard.cardTitleStyle;
        const completionStyle = override?.cardCompletionStyle ?? this.theme.sectionCard.cardCompletionStyle;

        const name = new PIXI.Text(section.name, titleStyle);
        name.x = this.theme.padding;
        name.y = h - name.height - this.theme.padding;
        root.addChild(name);

        // completion label + optional pill
        const completionText = new PIXI.Text("", completionStyle);

        // You already have these utils in your codebase
        // eslint-disable-next-line @typescript-eslint/no-var-requires

        const c = getSectionCompletion(progress, section);
        const pct = c.total > 0 ? Math.floor((c.done / c.total) * 100) : 0;
        completionText.text = `${pct}%`;

        if (section.type == 1) {
            const badge: PIXI.Sprite = PIXI.Sprite.from('Label_Badge01_Red')
            root.addChild(badge);

            const newText: PIXI.Text = new PIXI.Text('HOT!', ObjectCloner.clone(Fonts.Main))
            newText.anchor.set(0.5, 0.5)
            badge.addChild(newText);

            badge.scale.set(ViewUtils.elementScaler(badge, 100))
            newText.x = badge.width / 2 / badge.scale.x
            newText.y = badge.height / 2 / badge.scale.y
            badge.x = -25
            badge.y = 0
            badge.rotation = -0.5

        } else if (section.type == 2) {
            const badge: PIXI.Sprite = PIXI.Sprite.from('Label_Badge01_Purple')
            root.addChild(badge);

            const newText: PIXI.Text = new PIXI.Text('NEW!', ObjectCloner.clone(Fonts.Main))
            newText.anchor.set(0.5, 0.5)
            badge.addChild(newText);

            badge.scale.set(ViewUtils.elementScaler(badge, 100))
            newText.x = badge.width / 2 / badge.scale.x
            newText.y = badge.height / 2 / badge.scale.y
            badge.x = -25
            badge.y = 0
            badge.rotation = -0.5

        }

        let completionPill: PIXI.NineSlicePlane | undefined;
        if (this.theme.sectionCard.completionPillTexture && this.theme.sectionCard.completionPillNineSlice) {
            const ns = this.theme.sectionCard.completionPillNineSlice;
            completionPill = new PIXI.NineSlicePlane(
                this.theme.sectionCard.completionPillTexture,
                ns.left,
                ns.top,
                ns.right,
                ns.bottom
            );


            completionPill.width = 80// Math.ceil(completionText.width + pad.x * 2);
            completionPill.height = 80//Math.ceil(completionText.height + pad.y * 2);

            completionPill.x = w - completionPill.width - 12;
            completionPill.y = h - completionPill.height - this.theme.padding;

            completionText.x = completionPill.x + completionPill.width / 2;
            completionText.y = completionPill.y + completionPill.height / 2;

            completionText.anchor.set(0.5)

            root.addChild(completionPill);
            root.addChild(completionText);
        }
        else {
            completionText.x = w - completionText.width - 12;
            completionText.y = coverH + 12;
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
            disabled: {
                texture: PIXI.Texture.from('bt-grey')
            },
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
                statusIcon = PIXI.Sprite.from("Toggle_Check_Single_Icon"); // Replace with your check asset key
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
                const t = definition.isSpecial ? "ResourceBar_Single_Icon_Gem" : "ResourceBar_Single_Icon_Coin"
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
