import Pool from '@core/Pool';
import ViewUtils from '@core/utils/ViewUtils';
import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import { CurrencyType } from '../../data/InGameEconomy';
import { StaticData } from '../../data/StaticData';
import { BlockMergeEntity } from '../../entity/BlockMergeEntity';
import MergeAssets from '../../MergeAssets';
import { PrizeItem, RewardRegistry } from '../../prize/PrizeTypes';


export default class PrizeViewContainer extends PIXI.Container {
    private icon: PIXI.Sprite;
    private background: PIXI.NineSlicePlane | null = null;
    private label: PIXI.Text;
    private entity?: BlockMergeEntity;

    constructor() {
        super();
        this.icon = new PIXI.Sprite();
        this.icon.anchor.set(0.5);

        this.label = new PIXI.Text('', new PIXI.TextStyle({
            ...MergeAssets.MainFont,
            fontSize: 34,
            strokeThickness: 4
        }));
        this.label.anchor.set(0.5);
        this.label.y = 50

        this.addChild(this.icon);
        this.addChild(this.label);
    }
    /** Returns the icon sprite for the effect layer to copy */
    public getIconSprite(): PIXI.Sprite {
        return this.icon;
    }

    /** Hides the icon so the physical effect looks seamless */
    public hideIcon(): void {
        this.icon.visible = false;
        if (this.background) this.background.alpha = 0.5; // Optional: dim the bg
    }
    public setup(prize: PrizeItem): void {
        const tierData = prize.tier ? RewardRegistry.Tiers[prize.tier] : null;

        this.icon.visible = true;
        if (this.background) this.background.alpha = 1; // Optional: dim the bg


        // 1. Automatic Background by Tier
        if (tierData) {
            if (!this.background) {
                // Using 150 offset for the NineSlice as per your flag adjustment
                this.background = new PIXI.NineSlicePlane(PIXI.Texture.from(tierData.bg), 30, 30, 30, 30);
                this.addChildAt(this.background, 0);
            } else {
                this.background.texture = PIXI.Texture.from(tierData.bg);
                this.background.visible = true;
            }
            this.background.width = 150;
            this.background.height = 220;
            this.background.pivot.set(75, 110);
        } else if (this.background) {
            this.background.visible = false;
        }

        if (this.entity) {
            Pool.instance.returnElement(this.entity);
            this.entity = undefined;
        }
        // 2. Automatic Icon Logic
        if (prize.type === CurrencyType.ENTITY) {
            const level = parseInt(prize.value)
            const test = StaticData.getAnimalData(level)
            this.entity = Pool.instance.getElement<BlockMergeEntity>(BlockMergeEntity);
            this.entity.init(level, '', '')
            this.addChild(this.entity)
            // value is likely the cat level/id
            this.icon.texture = PIXI.Texture.from(RewardRegistry.Entities[prize.value as string] || MergeAssets.Textures.Icons.Badge1);
            this.label.text = prize.label || test.name;
        } else {
            // Currency Icons
            this.icon.texture = prize.type === CurrencyType.MONEY ?
                PIXI.Texture.from(MergeAssets.Textures.Icons.Coin) :
                PIXI.Texture.from(MergeAssets.Textures.Icons.Gem);
            this.label.text = `${prize.value}`;
        }

        this.icon.scale.set(ViewUtils.elementScaler(this.icon, 80))
        this.icon.y = -50
        // 3. Optional Tinting based on Tier
        if (tierData?.tint) this.icon.tint = 0xffffff; // Reset or apply specific tint
    }
    public updateValue(newValue: string): void {
        // Update the value text
        if (this.label) {
            this.label.text = newValue;
        }
    }

    public setValueStyle(color: number, scale: number): void {
        if (this.label) {
            this.label.tint = color;
            gsap.to(this.label.scale, {
                x: scale,
                y: scale,
                duration: 0.3,
                ease: "back.out"
            });
        }
    }
}