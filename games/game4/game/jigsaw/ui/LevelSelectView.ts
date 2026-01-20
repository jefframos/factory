// LevelSelectView.ts
import { Difficulty, SectionDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import Assets from "../Assets";
import { LevelSelectMediator } from "../progress/LevelSelectMediator";
import type { LevelSelectTheme } from "./LevelSelectViewElements";
import { LevelSelectViewFactory } from "./LevelSelectViewFactory";
import { VerticalScrollView } from "./VerticalScrollView";

type ViewMode = "sections" | "sectionDetail";

export class LevelSelectView extends PIXI.Container {
    public readonly onClose: Signal = new Signal();

    private readonly mediator: LevelSelectMediator;
    private readonly factory: LevelSelectViewFactory;
    private readonly theme: LevelSelectTheme;

    private mode: ViewMode = "sections";
    private activeSection?: SectionDefinition;

    private readonly scrollView: VerticalScrollView;

    public readonly headerView: ReturnType<LevelSelectViewFactory["createHeader"]>;

    private viewW: number;
    private viewH: number;

    public constructor(
        mediator: LevelSelectMediator,
        theme: LevelSelectTheme,
        viewW: number,
        viewH: number
    ) {
        super();

        this.mediator = mediator;
        this.theme = theme;
        this.factory = new LevelSelectViewFactory(theme);

        this.viewW = viewW;
        this.viewH = viewH;

        this.headerView = this.factory.createHeader(viewW);
        this.addChild(this.headerView.root);

        this.scrollView = new VerticalScrollView(viewW, viewH - theme.headerHeight);
        this.scrollView.y = theme.headerHeight;
        this.addChild(this.scrollView);

        this.headerView.backButton.visible = false;
        this.headerView.closeButton.visible = false;

        this.headerView.backButton.on("pointertap", () => {
            if (this.mode === "sectionDetail") {
                this.mode = "sections";
                this.activeSection = undefined;
                Assets.tryToPlaySound(Assets.Sounds.UI.RenderSection)
                this.renderSections();
            }
        });

        this.headerView.closeButton.on("pointertap", () => {
            this.onClose.dispatch();
        });

        this.mediator.onProgressChanged.add(this.onProgressChanged, this);

        this.renderSections();
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        this.mediator.onProgressChanged.remove(this.onProgressChanged, this);
        super.destroy(options);
    }

    public setSize(viewW: number, viewH: number): void {
        if (this.viewW === viewW && this.viewH === viewH) {
            return;
        }

        this.viewW = viewW;
        this.viewH = viewH;

        this.headerView.setSize(viewW, this.theme.headerHeight);

        this.scrollView.setSize(viewW, viewH - this.theme.headerHeight);
        this.scrollView.y = this.theme.headerHeight;

        this.refresh();
    }

    public refresh(): void {
        if (this.mode === "sections") {
            this.renderSections();
        }
        else {
            this.renderSectionDetail();
        }
    }

    private onProgressChanged(): void {
        this.refresh();
    }

    // -------------------------
    // Sections grid
    // -------------------------

    private renderSections(): void {
        this.mode = "sections";
        this.headerView.titleText.text = "Puzzles";
        this.headerView.backButton.visible = false;
        this.headerView.closeButton.visible = false;

        //this.scrollView.content.removeChildren();
        this.clearScrollView();

        const sections = (this.mediator as any).sections as SectionDefinition[] | undefined;
        const list = sections ?? [];

        const padding = this.theme.padding;
        const cols = 2;
        const cardW = Math.floor((this.viewW - padding * (cols + 1)) / cols);
        const cardH = this.theme.sectionCard.cardHeight;

        const progress = this.mediator.getProgress();

        let i = 0;
        for (const s of list) {
            const row = Math.floor(i / cols);
            const col = i % cols;

            const x = padding + col * (cardW + padding);
            const y = padding + row * (cardH + padding);

            const card = this.factory.createSectionCard(s, cardW, cardH, progress);
            card.x = x;
            card.y = y;

            card.on("pointertap", () => {
                this.activeSection = s;
                this.mode = "sectionDetail";
                this.renderSectionDetail();
                Assets.tryToPlaySound(Assets.Sounds.UI.Tap)
                Assets.tryToPlaySound(Assets.Sounds.UI.RenderSectionDetail)
            });

            this.scrollView.content.addChild(card);

            i += 1;
        }

        this.scrollView.scrollToTop();
        this.scrollView.refresh();
    }

    // -------------------------
    // Section detail (subsection)
    // -------------------------

    private renderSectionDetail(): void {
        if (!this.activeSection) {
            this.renderSections();
            return;
        }

        this.mode = "sectionDetail";
        this.headerView.titleText.text = this.activeSection.name;
        this.headerView.backButton.visible = true;
        this.headerView.closeButton.visible = true;

        //this.scrollView.content.removeChildren();
        this.clearScrollView();

        const padding = this.theme.padding;
        const progress = this.mediator.getProgress();

        // NEW: grid config
        const cols = 2;
        const gap = 12;

        const availableW = this.viewW - padding * 2;
        const cardW = Math.floor((availableW - gap * (cols - 1)) / cols);
        const cardH = this.theme.levelRow.rowHeight;

        let i = 0;
        for (const level of this.activeSection.levels) {
            const row = Math.floor(i / cols);
            const col = i % cols;

            const x = padding + col * (cardW + gap);
            const y = padding + row * (cardH + gap);

            const unlocked = this.mediator.isLevelUnlocked(level.id);

            const tile = this.factory.createLevelRow(
                level,
                this.activeSection,
                cardW,
                cardH,
                progress,
                unlocked,
                (levelId: string, d: Difficulty) => {
                    this.mediator.requestPlay(levelId, d);
                },
                (levelId: string) => {
                    this.mediator.requestPurchase(levelId);
                }
            );

            tile.x = x;
            tile.y = y;

            this.scrollView.content.addChild(tile);

            i += 1;
        }

        this.scrollView.scrollToTop();
        this.scrollView.refresh();
    }

    private clearScrollView(): void {
        // This tells PIXI to call .destroy() on every child.
        // Our BaseButton cleanup (the .on('destroyed') listener) will now trigger.
        this.scrollView.content.removeChildren().forEach(child => child.destroy({ children: true }));
    }
}
