import { Game } from "@core/Game";
import Pool from "@core/Pool";
import { easeOutQuad } from "@core/utils/Easing";
import * as PIXI from 'pixi.js';
import BaseDemoScene from "../BaseDemoScene";
import CardView from "./CardView";
import TransitionManager from "./TransitionManager";

interface StackData {
    anchor: PIXI.Point;
    cards: CardView[];
}

export default class CardScene extends BaseDemoScene {
    private mainStack: StackData = { anchor: new PIXI.Point(), cards: [] };
    private stashStack: StackData = { anchor: new PIXI.Point(), cards: [] };

    private transitionManager = new TransitionManager();
    private timer = 0;
    private offset = 100;
    private movingToStash = true;

    constructor() {
        super();
        const mainAnchor = Pool.instance.getElement<CardView>(CardView);
        mainAnchor.x = this.offset
        mainAnchor.y = Game.gameScreenData.center.y;
        mainAnchor.setCardIcon(PIXI.Texture.EMPTY);
        mainAnchor.setCardTexture(PIXI.Texture.from('ItemFrame01_Single_Navy.png'));
        this.mainStack.anchor = mainAnchor.position;
        this.addChild(mainAnchor);

        const stashAnchor = Pool.instance.getElement<CardView>(CardView);
        stashAnchor.x = Game.gameScreenData.bottomRight.x - mainAnchor.width - this.offset
        stashAnchor.y = Game.gameScreenData.center.y;
        stashAnchor.setCardIcon(PIXI.Texture.EMPTY);
        stashAnchor.setCardTexture(PIXI.Texture.from('ItemFrame01_Single_Navy.png'));
        this.stashStack.anchor = stashAnchor.position;
        this.addChild(stashAnchor);
    }

    public build(): void {

        const icons = ['ItemIcon_Clover_Green.Png', 'ItemIcon_Gem_Star_Blue.Png', 'ItemIcon_Heart_Red.Png', 'ItemIcon_Star_Gold.Png']
        for (let i = 0; i < 144; i++) {
            const card = Pool.instance.getElement<CardView>(CardView);
            const offset = this.mainStack.cards.length * -1;
            card.x = this.mainStack.anchor.x;
            card.y = this.mainStack.anchor.y + offset;
            card.setCardIcon(PIXI.Texture.from(icons[Math.floor(Math.random() * icons.length)]))
            card.zIndex = i;
            this.mainStack.cards.push(card);
            this.addChild(card);
        }

        this.sortChildren();
    }

    public destroy(): void {
        [...this.mainStack.cards, ...this.stashStack.cards].forEach(card => {
            card.parent?.removeChild(card);
            Pool.instance.returnElement(card);
        });

        this.mainStack.cards = [];
        this.stashStack.cards = [];
        this.transitionManager = new TransitionManager();
    }

    public update(delta: number): void {
        this.timer += delta;

        this.transitionManager.update(delta);

        if (this.timer >= 1) {
            this.timer = 0;

            const sourceStack = this.movingToStash ? this.mainStack : this.stashStack;
            const targetStack = this.movingToStash ? this.stashStack : this.mainStack;

            const card = sourceStack.cards.pop();
            if (!card) {
                this.movingToStash = !this.movingToStash;
                return;
            }

            targetStack.cards.push(card);
            const targetX = targetStack.anchor.x;
            const targetY = targetStack.anchor.y - targetStack.cards.length;

            card.zIndex = 1000 + targetStack.cards.length;
            this.sortChildren();

            this.transitionManager.add(card, { x: targetX, y: targetY }, 2, () => {
                card.x = targetX;
                card.y = targetY;
                card.zIndex = targetStack.cards.length;
                this.sortChildren();

                // Flip direction if we emptied the source
                if (sourceStack.cards.length === 0) {
                    this.movingToStash = !this.movingToStash;
                }
            }, easeOutQuad);
        }
    }
}
