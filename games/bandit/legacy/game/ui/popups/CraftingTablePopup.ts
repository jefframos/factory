// CraftingTablePopup.ts
//
// The craft UI for a CraftingTableTypes.ts table — opened by
// CraftingTableZone.ts's own "Craft" button tap. Same Popup-subclass shape
// as MartPopup.ts (see that file's own top doc), just one list instead of
// Buy/Sell tabs: every `config.recipes` entry (a recipe ID — see
// CraftingTableTypes.ts's own top doc) resolves through
// CraftingRecipeTypes.getCraftingRecipe() into one row — ingredient slots,
// an arrow, the result slot, and a "Craft" button. Tapping it is an
// all-or-nothing transaction (see BackpackStorage.remove()'s own doc):
// every ingredient amount is consumed together or none are, then the
// result is added.
//
// Ingredient/result slots reuse ResourceSlotVisual.createResourceSlot() —
// the same proven "icon square + count in the corner" component
// CraftZone's own requirement row already renders in-world, rather than
// hand-rolling icon/background/label layout again here.
//
// `onClosed` (passed in by CraftingTableZone.ts, wired to PizzaScene's own
// unfreezePlayerMovement()) is invoked via this popup's own onClosed()
// override (see Popup.ts's own doc), same as MartPopup.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Popup from './Popup';
import PanelBackground, { PANEL_CONTENT_MARGIN } from '../PanelBackground';
import ScrollView from '../ScrollView';
import { TextStyleRegistry } from '../TextStyleRegistry';
import { createLibraryButton } from '../ButtonLibrary';
import { createResourceSlot } from '../ResourceSlotVisual';
import { BackpackStorage } from '../../data/BackpackStorage';
import { ResourceType } from '../../actions/ResourceTypes';
import { CraftingTableConfig } from '../../data/CraftingTableTypes';
import { CraftingRecipeConfig, getCraftingRecipe } from '../../data/CraftingRecipeTypes';

/** Same fixed footprint MartPopup's own BODY_WIDTH/BODY_HEIGHT use — this popup and MartPopup are visually the same "transaction row list" family (icon slots + a per-row action button on a dark panel), so they share their outer footprint too, not just their dark backdrop. A table with more recipes than fits scrolls (see buildContent()'s own doc) rather than growing the panel — same reasoning InventoryPopup/MartPopup already scroll instead of growing. */
const BODY_WIDTH = 420;
const BODY_HEIGHT = 420;
const CONTENT_WIDTH = BODY_WIDTH - PANEL_CONTENT_MARGIN * 2;
const CONTENT_HEIGHT = BODY_HEIGHT - PANEL_CONTENT_MARGIN * 2;

const SLOT_SIZE = 56;
const SLOT_GAP = 10;
const ARROW_GAP = 16;
/** Same 8px rhythm MartPopup's own ROW_GAP uses between its Buy/Sell rows — see this file's own top doc for why these two lists should read as one visual family. */
const ROW_GAP = 8;
const ROW_BUTTON_WIDTH = 96;
const ROW_BUTTON_HEIGHT = 40;

/** Icon jiggle on a successful craft — same shape as MartPopup's own row feedback. */
const FEEDBACK_JIGGLE_SCALE = 1.3;
const FEEDBACK_JIGGLE_PUNCH_SEC = 0.12;
const FEEDBACK_JIGGLE_SETTLE_SEC = 0.15;
const FEEDBACK_POPUP_RISE_PX = 20;
const FEEDBACK_POPUP_DURATION_SEC = 0.5;
/** Same reasoning as MartPopup.FEEDBACK_RENDER_DELAY_SEC's own doc. */
const FEEDBACK_RENDER_DELAY_SEC = FEEDBACK_POPUP_DURATION_SEC + 0.05;

export default class CraftingTablePopup extends Popup {
    private readonly tableId: string;
    private readonly config: CraftingTableConfig;
    private readonly onClosedCallback?: () => void;

    private declare body: PIXI.Container;
    /** Every row goes here, never directly into `body` — clipped/scrolled by `scrollView` (see buildContent()'s own doc), so content never sits flush against `background`'s own edges/rounded corners AND never renders past CONTENT_HEIGHT when this table lists more recipes than that fits. */
    private declare contentArea: PIXI.Container;
    /** Clips/scrolls `contentArea` to CONTENT_WIDTH x CONTENT_HEIGHT — see buildContent()'s own doc. refresh() must be called after every render() rebuild, since contentArea's own height can change per recipe count. */
    private declare scrollView: ScrollView;

    /** True for FEEDBACK_RENDER_DELAY_SEC right after a craft — see MartPopup.suppressRender's own doc for why the reactive re-render has to wait rather than firing on BackpackStorage's synchronous onChange dispatch. */
    private suppressRender = false;
    private pendingRenderDelay?: gsap.core.Tween;

    private readonly handleChange = (): void => {
        if (this.suppressRender) {
            return;
        }
        this.render();
    };

    public constructor(tableId: string, config: CraftingTableConfig, onClosed?: () => void) {
        // closeOnBackdropTap: false — same reasoning as InventoryPopup's own doc: a live crafting
        // menu should only close via its own header close button, not a stray tap outside it.
        // 'craftingIcon' — the exact same icon CraftingTableZone.ts's own "Craft" button uses,
        // so the popup reads as "the same thing" the player just tapped.
        super(config.name, { contentWidth: BODY_WIDTH, frame: 'ItemFrame', closeOnBackdropTap: false, titleIcon: 'craftingIcon' });
        this.tableId = tableId;
        this.config = config;
        this.onClosedCallback = onClosed;

        // buildContent() (called by Popup's own constructor, ABOVE, as part of super()) runs
        // before this constructor body gets to assign tableId/config — same ordering issue
        // MartPopup's own constructor doc explains. This is the first point it's safe to
        // actually render the recipe rows.
        this.render();

        BackpackStorage.onChange.add(this.handleChange);
        this.root.once('destroyed', () => {
            BackpackStorage.onChange.remove(this.handleChange);
        });
    }

    protected override onClosed(): void {
        this.onClosedCallback?.();
    }

    protected buildContent(content: PIXI.Container): void {
        this.body = new PIXI.Container();
        content.addChild(this.body);

        // Same shared dark panel InventoryPopup/MartPopup use (see PanelBackground.ts's own
        // doc), fixed to the exact BODY_WIDTH x BODY_HEIGHT footprint (matching MartPopup) rather
        // than growing with recipe count — see this file's own top doc.
        const background = new PanelBackground();
        background.setFixedSize(BODY_WIDTH, BODY_HEIGHT);
        this.body.addChild(background);

        // Wrapped in a ScrollView rather than added to `body` directly — same reasoning as
        // InventoryPopup's/MartPopup's own tab body: a table can list more recipes than fits
        // CONTENT_HEIGHT, so this clips to the fixed footprint and lets a drag scroll through
        // the rest. A no-op for a table short enough to already fit.
        this.contentArea = new PIXI.Container();
        this.scrollView = new ScrollView({ target: this.contentArea, width: CONTENT_WIDTH, height: CONTENT_HEIGHT });
        this.scrollView.position.set(PANEL_CONTENT_MARGIN, PANEL_CONTENT_MARGIN);
        this.body.addChild(this.scrollView);

        // Deliberately NOT calling render() here — see the constructor's own doc for why: this
        // runs during super(), before tableId/config are assigned yet.
    }

    private render(): void {
        this.contentArea.removeChildren().forEach(child => child.destroy({ children: true }));

        const rows = this.config.recipes
            .map(entry => ({ entry, recipe: getCraftingRecipe(entry.recipeId) }))
            .filter((row): row is { entry: typeof row.entry; recipe: CraftingRecipeConfig } => {
                if (!row.recipe) {
                    console.warn(`[CraftingTablePopup] "${this.tableId}" lists recipe id "${row.entry.recipeId}" but no such CraftingRecipeConfig entry exists (Crafting Recipes tab) — skipping it.`);
                    return false;
                }
                return true;
            });

        if (rows.length === 0) {
            const empty = new PIXI.Text('Nothing craftable here yet.', TextStyleRegistry.Inventory);
            this.contentArea.addChild(empty);
        } else {
            let cursorY = 0;
            rows.forEach(({ recipe }) => {
                const rowHeight = this.renderRow(recipe, cursorY);
                cursorY += rowHeight + ROW_GAP;
            });
        }

        // Re-measures contentArea's freshly-rebuilt height and re-clamps/resets scroll — see
        // ScrollView.refresh()'s own doc.
        this.scrollView.refresh();
    }

    /** One recipe row, top-left at local (0, `y`) — ingredient slots, an arrow, the result slot, and a Craft button, all vertically centered against SLOT_SIZE. Returns the row's own rendered height (always SLOT_SIZE, kept as a return value so render()'s own stacking math doesn't hardcode it twice). `enabled` only when BackpackStorage already holds enough of every ingredient. */
    private renderRow(recipe: CraftingRecipeConfig, y: number): number {
        const row = new PIXI.Container();
        row.position.set(0, y);
        this.contentArea.addChild(row);

        const ingredients = Object.entries(recipe.ingredients) as [ResourceType, number][];
        const canAfford = ingredients.every(([type, need]) => BackpackStorage.getCount(type) >= need);

        let cursorX = 0;
        ingredients.forEach(([type, need]) => {
            const have = BackpackStorage.getCount(type);
            const slot = createResourceSlot(type, SLOT_SIZE, `${have}/${need}`);
            slot.label.style.fill = have >= need ? '#33cc66' : '#e5484d';
            slot.container.position.set(cursorX, 0);
            row.addChild(slot.container);
            cursorX += SLOT_SIZE + SLOT_GAP;
        });

        const arrow = new PIXI.Text('->', { ...TextStyleRegistry.Inventory, fontSize: 20 });
        arrow.anchor.set(0, 0.5);
        arrow.position.set(cursorX, SLOT_SIZE / 2);
        row.addChild(arrow);
        cursorX += ARROW_GAP + arrow.width;

        const resultSlot = createResourceSlot(recipe.result.resourceType, SLOT_SIZE, `x${recipe.result.amount}`);
        resultSlot.label.style.fill = '#ffffff';
        resultSlot.container.position.set(cursorX, 0);
        row.addChild(resultSlot.container);

        const button = createLibraryButton({
            color: canAfford ? 'green' : 'grey',
            width: ROW_BUTTON_WIDTH, height: ROW_BUTTON_HEIGHT,
            label: 'Craft',
            onClick: canAfford ? () => {
                // Suppress BEFORE mutating storage — BackpackStorage dispatches onChange
                // synchronously, same "would already have torn this row down" reasoning
                // MartPopup's own onClick doc explains.
                this.beginSuppressedRender();
                for (const [type, need] of ingredients) {
                    BackpackStorage.remove(type, need);
                }
                BackpackStorage.add(recipe.result.resourceType, recipe.result.amount);
                this.playRowFeedback(resultSlot.icon, resultSlot.container);
            } : () => { /* disabled — no-op */ },
        });
        button.position.set(CONTENT_WIDTH - ROW_BUTTON_WIDTH, SLOT_SIZE / 2 - ROW_BUTTON_HEIGHT / 2);
        button.alpha = canAfford ? 1 : 0.5;
        row.addChild(button);

        return SLOT_SIZE;
    }

    /** Same "hold off the reactive re-render" reasoning as MartPopup.beginSuppressedRender()'s own doc. */
    private beginSuppressedRender(): void {
        this.suppressRender = true;
        this.pendingRenderDelay?.kill();
        this.pendingRenderDelay = gsap.delayedCall(FEEDBACK_RENDER_DELAY_SEC, () => {
            this.suppressRender = false;
            this.pendingRenderDelay = undefined;
            this.render();
        });
    }

    /** Icon punch-and-settle + a rising/fading "+1" popup on the result icon — same visual language as MartPopup.playRowFeedback(). `slotContainer` is the result slot's OWN container (see ResourceSlotVisual.ts) — `icon`'s position is local to it, not to the row, so the popup is added there too rather than into `row` directly. */
    private playRowFeedback(icon: PIXI.Sprite, slotContainer: PIXI.Container): void {
        const baseScaleX = icon.scale.x;
        const baseScaleY = icon.scale.y;
        gsap.killTweensOf(icon.scale);
        gsap.timeline()
            .to(icon.scale, { x: baseScaleX * FEEDBACK_JIGGLE_SCALE, y: baseScaleY * FEEDBACK_JIGGLE_SCALE, duration: FEEDBACK_JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(icon.scale, { x: baseScaleX, y: baseScaleY, duration: FEEDBACK_JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text('+1', TextStyleRegistry.ResourceDamage);
        popup.style.fill = '#33cc66';
        popup.anchor.set(0.5, 1);
        const baseY = icon.position.y - SLOT_SIZE / 2;
        popup.position.set(icon.position.x, baseY);
        slotContainer.addChild(popup);

        const progress = { t: 0 };
        gsap.to(progress, {
            t: 1,
            duration: FEEDBACK_POPUP_DURATION_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                popup.position.y = baseY - progress.t * FEEDBACK_POPUP_RISE_PX;
                popup.alpha = 1 - progress.t;
            },
            onComplete: () => popup.destroy(),
        });
    }
}
