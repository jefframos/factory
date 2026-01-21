import BaseButton from "@core/ui/BaseButton";
import { SectionDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import Assets from "../Assets";
import { LevelSelectMediator } from "../progress/LevelSelectMediator";
import type { LevelSelectTheme } from "./LevelSelectViewElements";
import { LevelRowComponent, LevelSelectViewFactory, SectionCardComponent } from "./LevelSelectViewFactory";
import { VerticalScrollView } from "./VerticalScrollView";

export class LevelSelectView extends PIXI.Container {
    public readonly onClose: Signal = new Signal();

    private readonly mediator: LevelSelectMediator;
    private readonly factory: LevelSelectViewFactory;
    private readonly theme: LevelSelectTheme;

    private readonly navigationContainer = new PIXI.Container();
    private upButton!: BaseButton;
    private downButton!: BaseButton;

    private mode: "sections" | "sectionDetail" = "sections";
    private activeSection?: SectionDefinition;

    private readonly scrollView: VerticalScrollView;
    private readonly sectionsPage = new PIXI.Container();
    private readonly detailPage = new PIXI.Container();

    private sectionPool: SectionCardComponent[] = [];
    private rowPool: LevelRowComponent[] = [];

    public readonly headerView: ReturnType<LevelSelectViewFactory["createHeader"]>;
    private viewW: number;
    private viewH: number;

    public constructor(mediator: LevelSelectMediator, theme: LevelSelectTheme, viewW: number, viewH: number) {
        super();
        this.mediator = mediator;
        this.theme = theme;
        this.factory = new LevelSelectViewFactory(theme);
        this.viewW = viewW;
        this.viewH = viewH;


        this.scrollView = new VerticalScrollView(viewW, viewH - theme.headerHeight);
        this.scrollView.y = theme.headerHeight;
        this.addChild(this.scrollView);

        this.scrollView.content.addChild(this.sectionsPage);
        this.scrollView.content.addChild(this.detailPage);

        this.headerView = this.factory.createHeader(viewW);
        this.addChild(this.headerView.root);

        this.createNavigationUI();
        this.addChild(this.navigationContainer);

        // Link scroll events to UI updates
        this.scrollView.onScroll = () => this.updateNavigationState();


        this.headerView.backButton.on("pointertap", () => {
            this.activeSection = undefined;
            this.renderSections();
            Assets.tryToPlaySound(Assets.Sounds.UI.RenderSection);
        });

        this.mediator.onProgressChanged.add(this.refresh, this);
        this.renderSections();
    }

    private createNavigationUI(): void {
        // Assuming your theme has skins for these or reusing primary/secondary
        const skin = this.theme.buttonSkins.secondary;

        const size = 80

        this.upButton = new BaseButton({
            standard: { ...skin.standard, width: size, height: size, iconTexture: PIXI.Texture.from(Assets.Textures.Icons.Up), centerIconHorizontally: true, centerIconVertically: true }, // Pointing up
            over: skin.over,
            disabled: this.theme.buttonSkins.purchase.disabled // Use a grey skin
        });

        this.downButton = new BaseButton({
            standard: { ...skin.standard, width: size, height: size, iconTexture: PIXI.Texture.from(Assets.Textures.Icons.Down), centerIconHorizontally: true, centerIconVertically: true }, // Pointing down
            over: skin.over,
            disabled: this.theme.buttonSkins.purchase.disabled
        });

        this.upButton.on("pointertap", () => this.scrollView.scrollBy(-200));
        this.downButton.on("pointertap", () => this.scrollView.scrollBy(200));

        this.navigationContainer.addChild(this.upButton, this.downButton);
        this.positionNavigationButtons();
    }

    private positionNavigationButtons(): void {
        const margin = 20;
        // Position buttons on the right side of the scroll view
        this.upButton.x = this.viewW - this.upButton.width - margin;
        this.upButton.y = this.theme.headerHeight + margin;

        this.downButton.x = this.viewW - this.downButton.width - margin;
        this.downButton.y = this.viewH - this.downButton.height - margin;
    }

    private updateNavigationState(): void {
        const scrollY = this.scrollView.currentScroll;
        const maxScroll = this.scrollView.maxScroll;

        // 1. Visibility: If content fits, hide both
        if (maxScroll <= 0) {
            this.navigationContainer.visible = false;
            return;
        }

        this.navigationContainer.visible = true;

        // 2. Up Button: Disable if at the very top
        if (scrollY <= 0) {
            this.upButton.disable();
            this.upButton.alpha = 0;
        } else {
            this.upButton.enable();
            this.upButton.alpha = 1;
        }

        // 3. Down Button: Disable if at the very bottom
        if (scrollY >= maxScroll) {
            this.downButton.disable();
            this.downButton.alpha = 0;
        } else {
            this.downButton.enable();
            this.downButton.alpha = 1;
        }
    }

    public refresh(): void {
        this.mode === "sections" ? this.renderSections() : this.renderSectionDetail();
    }
    public setHeight(value: number) {
        this.viewH = value;
        this.scrollView.setSize(this.viewW, this.viewH - this.theme.headerHeight);
        this.positionNavigationButtons();
        this.updateNavigationState();
    }
    private renderSections(): void {
        this.mode = "sections";
        this.sectionsPage.visible = true;
        this.detailPage.visible = false;
        this.headerView.titleText.text = ''//"Puzzles";
        this.headerView.backButton.visible = false;

        const sections = (this.mediator as any).sections || [];
        const progress = this.mediator.getProgress();
        const cols = 2;

        // Total space occupied by padding = (cols + 1) * padding
        const totalPaddingSpace = (cols + 1) * this.theme.padding;
        const cardW = Math.floor((this.viewW - totalPaddingSpace) / cols);
        //const cardW = Math.floor((this.viewW - this.theme.padding * 2) / cols);

        sections.forEach((s: SectionDefinition, i: number) => {
            let card = this.sectionPool[i];
            if (!card) {
                card = this.factory.createSectionCard(s, cardW, this.theme.sectionCard.cardHeight, progress);
                card.on("pointertap", () => {
                    this.activeSection = s;
                    this.renderSectionDetail();
                    Assets.tryToPlaySound(Assets.Sounds.UI.Tap);
                });
                this.sectionPool.push(card);
                this.sectionsPage.addChild(card);
            }
            card.visible = true;
            //card.x = this.theme.padding + (i % cols) * (cardW + this.theme.padding);
            // This stays the same
            card.x = this.theme.padding + (i % cols) * (cardW + this.theme.padding);
            card.y = this.theme.padding + Math.floor(i / cols) * (this.theme.sectionCard.cardHeight + this.theme.padding);
            card.update(s, progress);
        });

        for (let i = sections.length; i < this.sectionPool.length; i++) this.sectionPool[i].visible = false;

        this.scrollView.scrollToTop();
        this.scrollView.refresh();
    }

    private renderSectionDetail(): void {
        if (!this.activeSection) return;
        this.mode = "sectionDetail";
        this.sectionsPage.visible = false;
        this.detailPage.visible = true;
        this.headerView.titleText.text = this.activeSection.name;
        this.headerView.backButton.visible = true;

        const levels = this.activeSection.levels;
        const progress = this.mediator.getProgress();

        const cols = 2;
        const totalPaddingSpace = (cols + 1) * this.theme.padding;
        const cardW = Math.floor((this.viewW - totalPaddingSpace) / cols);
        //const cardW = Math.floor((this.viewW - this.theme.padding * 2 - 12) / 2);

        levels.forEach((lvl, i) => {
            let row = this.rowPool[i];
            const unlocked = this.mediator.isLevelUnlocked(lvl.id);
            if (!row) {
                row = this.factory.createLevelRow(lvl, this.activeSection!, cardW, this.theme.levelRow.rowHeight, progress, unlocked,
                    (id, d) => this.mediator.requestPlay(id, d),
                    (id) => this.mediator.requestPurchase(id));
                this.rowPool.push(row);
                this.detailPage.addChild(row);
            }
            row.visible = true;
            // row.x = this.theme.padding + (i % 2) * (cardW + 12);
            row.x = this.theme.padding + (i % cols) * (cardW + this.theme.padding);
            //row.y = this.theme.padding + Math.floor(i / 2) * (this.theme.levelRow.rowHeight + 12);
            row.y = this.theme.padding + Math.floor(i / cols) * (this.theme.sectionCard.cardHeight + this.theme.padding);
            row.update(lvl, this.activeSection!, progress, unlocked);
        });

        for (let i = levels.length; i < this.rowPool.length; i++) this.rowPool[i].visible = false;

        this.scrollView.scrollToTop();
        this.scrollView.refresh();
    }

    public override destroy(options?: any): void {
        this.mediator.onProgressChanged.remove(this.refresh, this);
        super.destroy(options);
    }
}