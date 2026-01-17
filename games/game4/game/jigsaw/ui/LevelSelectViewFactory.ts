// LevelSelectViewFactory.ts
import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import ViewUtils from "@core/utils/ViewUtils";
import type { Difficulty, LevelDefinition, SectionDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
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

        const backSkin = this.theme.buttonSkins.secondary;
        const closeSkin = this.theme.buttonSkins.secondary;

        const backButton = new BaseButton({
            standard: {
                texture: backSkin.standard.texture,
                width: backSkin.standard.width,
                height: backSkin.standard.height,
                allPadding: backSkin.standard.allPadding,
                fontStyle: backSkin.standard.fontStyle,
                //text: "Back",
            },
            over: {
                texture: backSkin.over?.texture,
            },
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
                texture: closeSkin.over?.texture,
            },
        });

        closeButton.setLabel('Close')
        backButton.setLabel('Back')

        root.addChild(backButton, closeButton);

        const setSize = (w: number, h: number) => {
            bg.width = w;
            bg.height = h;

            titleText.x = 20;
            titleText.y = Math.floor((h - titleText.height) * 0.5);

            // Right aligned buttons
            closeButton.x = w - closeButton.width - 16;
            closeButton.y = Math.floor((h - closeButton.height) * 0.5);

            backButton.x = closeButton.x - backButton.width - 12;
            backButton.y = Math.floor((h - backButton.height) * 0.5);
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
        mask.drawRoundedRect(0, 0, w - this.theme.padding * 2, coverH - this.theme.padding * 2, 20);
        mask.endFill();
        coverContaienr.addChild(mask);
        cover.scale.set(ViewUtils.elementEvelop(cover, w, coverH))
        cover.mask = mask

        cover.anchor.set(0, 0)
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

            const pad = this.theme.sectionCard.completionPillPadding;

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
        onDifficultyPressed: (levelId: string, difficulty: Difficulty) => void
    ): PIXI.Container {
        const root = new PIXI.Container();

        // Background
        if (this.theme.levelRow.useNineSliceBg && this.theme.levelRow.bgTexture && this.theme.levelRow.bgNineSlice) {
            const ns = this.theme.levelRow.bgNineSlice;
            const bg = new PIXI.NineSlicePlane(this.theme.levelRow.bgTexture, ns.left, ns.top, ns.right, ns.bottom);
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

        const thumbC = new PIXI.Container();
        const thumbSize = this.theme.levelRow.thumbSize;
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
        c2.x = pad;
        c2.y = pad;

        thumbC.destroy();
        thumb.destroy();

        const title = new PIXI.Text(level.name, this.theme.levelRow.titleStyle);
        title.x = pad + thumbSize + 10;
        title.y = pad + 4;
        root.addChild(title);

        const diffs: Difficulty[] = ["easy", "medium", "hard"];
        const yBtn = pad + 42;

        let x = title.x;

        // eslint-disable-next-line @typescript-eslint/no-var-requires

        for (const d of diffs) {
            const done = getLevelDifficultyCompleted(progress, level.id, d);
            const btn = this.createDifficultyButton((section as any).id ?? section.name, d, done);

            btn.x = x;
            btn.y = yBtn;

            btn.on("pointertap", () => {
                onDifficultyPressed(level.id, d);
            });

            btn.setLabel(d)

            root.addChild(btn);
            x += btn.width + 10;
        }

        return root;
    }

    public createDifficultyButton(sectionId: string | undefined, d: Difficulty, completed: boolean): BaseButton {
        const skinKey = getDifficultySkinKey(this.theme, sectionId, d);
        const skin = this.theme.buttonSkins[skinKey];

        const tex = completed && skin.completed?.texture ? skin.completed.texture : skin.standard.texture;
        const fontStyle = completed && skin.completed?.fontStyle ? skin.completed.fontStyle : skin.standard.fontStyle;



        const btn = new BaseButton({
            standard: {
                texture: tex,
                width: skin.standard.width,
                height: skin.standard.height,
                allPadding: skin.standard.allPadding,
                fontStyle,
                //iconTexture: skin.standard.iconTexture
                //skin.iconTexture
                //text: d.toUpperCase(),
            },
            over: {
                texture: skin.over?.texture,
            },
            down: {
                texture: skin.down?.texture,
            },
        });

        return btn;
    }
}
