import ViewUtils from '@core/utils/ViewUtils';
import Assets from 'games/game4/game/jigsaw/Assets';
import { InGameEconomy } from 'games/game4/game/jigsaw/data/InGameEconomy';
import { gsap } from 'gsap'; // or your preferred tweening library
import * as PIXI from 'pixi.js';

export class CurrencyHud extends PIXI.Container {
    private coinLabel: PIXI.Text;
    private gemLabel: PIXI.Text;
    private coinIcon: PIXI.Sprite;
    private gemIcon: PIXI.Sprite;
    private background: PIXI.NineSlicePlane;

    // Internal values for tweening
    private displayCoins: number = 0;
    private displayGems: number = 0;
    private iconSize: number = 24;

    constructor(private config: any) {
        super();
        this.displayCoins = InGameEconomy.instance.coins;
        this.displayGems = InGameEconomy.instance.gems;
        this.setup();
    }

    private setup(): void {
        const { padding, bgNineSlice, bgTexture, textStyle } = this.config;

        const items = new PIXI.Container();

        // --- Normal Currency ---
        this.coinIcon = PIXI.Sprite.from(this.config.currencyIcon);
        this.coinIcon.anchor.set(0.5); // Center for popping

        this.coinLabel = new PIXI.Text(this.displayCoins.toString(), textStyle);
        this.coinLabel.anchor.set(0, 0.5);

        // --- Special Currency ---
        this.gemIcon = PIXI.Sprite.from(this.config.specialCurrencyIcon);
        this.gemIcon.anchor.set(0.5); // Center for popping

        this.gemLabel = new PIXI.Text(this.displayGems.toString(), textStyle);
        this.gemLabel.anchor.set(0, 0.5);

        items.addChild(this.coinIcon, this.coinLabel);
        //items.addChild(this.gemIcon, this.gemLabel);
        this.addChild(this.background = new PIXI.NineSlicePlane(bgTexture, bgNineSlice.left, bgNineSlice.top, bgNineSlice.right, bgNineSlice.bottom));
        this.addChild(items);
        //this.background.alpha = 0.3
        this.refreshLayout();

        this.coinIcon.scale.set(ViewUtils.elementScaler(this.coinIcon, this.iconSize * 2))
        this.gemIcon.scale.set(ViewUtils.elementScaler(this.gemIcon, this.iconSize * 2))

        // Listeners
        InGameEconomy.instance.onCoinsChanged.add(this.animateCoins, this);
        InGameEconomy.instance.onGemsChanged.add(this.animateGems, this);
    }

    private animateCoins(target: number): void {
        // 1. Tween the numeric value



        gsap.to(this, {
            displayCoins: target,
            duration: 0.5,
            onUpdate: () => {
                this.coinLabel.text = Math.floor(this.displayCoins).toString();
                this.refreshLayout();
            },
            onComplete: () => {
                this.popIcon(this.coinIcon);
            }
        });
    }

    private animateGems(target: number): void {
        gsap.to(this, {
            displayGems: target,
            duration: 0.5,
            onUpdate: () => {
                this.gemLabel.text = Math.floor(this.displayGems).toString();
                this.refreshLayout();
            },
            onComplete: () => {
                this.popIcon(this.gemIcon);
            }
        });
    }
    public addCoin(amount: number) {
        this.displayCoins += amount;
        this.coinLabel.text = Math.floor(this.displayCoins).toString()
    }
    public popCoin() {
        this.addCoin(1)
        this.popIcon(this.coinIcon)
        Assets.tryToPlaySound(Assets.Sounds.UI.Coin1)
    }
    private popIcon(icon: PIXI.Sprite): void {
        // Quick scale up and back down

        gsap.killTweensOf(icon)
        icon.scale.set(ViewUtils.elementScaler(icon, this.iconSize * 2))
        gsap.fromTo(icon.scale,
            { x: icon.scale.x, y: icon.scale.y },
            { x: icon.scale.x * 1.4, y: icon.scale.y * 1.4, duration: 0.15, yoyo: true, repeat: 1, ease: "back.out(2)" }
        );
    }

    private refreshLayout(): void {
        const p = this.config.padding;

        // Position Coins
        this.coinIcon.x = p + this.iconSize / 2;
        this.coinIcon.y = this.background.height / 2;

        this.coinLabel.x = this.coinIcon.x + this.iconSize / 2 + 20;
        this.coinLabel.y = this.background.height / 2;

        // Position Gems relative to Coin Label
        this.gemIcon.x = this.coinLabel.x + this.coinLabel.width + 25;
        this.gemIcon.y = this.background.height / 2;

        this.gemLabel.x = this.gemIcon.x + this.iconSize / 2 + 20;
        this.gemLabel.y = this.background.height / 2;

        // Resize Background
        this.background.width = this.coinLabel.x + this.coinLabel.width + p;
        this.background.height = 55; // Or dynamic based on text height
    }
}