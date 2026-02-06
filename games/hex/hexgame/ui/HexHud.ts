import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import HexAssets from "../HexAssets";
export class HexHUD extends PIXI.Container {
    // Signals
    public readonly onNewPuzzle: Signal = new Signal();
    public readonly onAutoComplete: Signal = new Signal();
    public readonly onResetBoard: Signal = new Signal();

    private readonly buttons: BaseButton[] = [];

    constructor() {
        super();
        this.init();
    }

    private init(): void {
        // Shared config factory
        const createCfg = (icon: any, signal: Signal) => ({
            standard: {
                width: 80,
                height: 80,
                allPadding: 10,
                texture: PIXI.Texture.EMPTY,
                iconTexture: PIXI.Texture.from(icon),
                fontStyle: new PIXI.TextStyle({ ...HexAssets.MainFont }),
                centerIconHorizontally: true,
                centerIconVertically: true,
                iconSize: { height: 70, width: 70 }
            },
            over: { tint: 0xeeeeee },
            click: {
                callback: () => {
                    // Visual feedback like your speedUpBtn
                    const btn = (this as any).activeBtn;
                    signal.dispatch({});
                }
            }
        });

        // Instantiate Buttons
        const newBtn = new BaseButton(createCfg(HexAssets.Textures.Icons.ArrowRight, this.onNewPuzzle));
        const autoBtn = new BaseButton(createCfg(HexAssets.Textures.Icons.GiftFast, this.onAutoComplete));
        const resetBtn = new BaseButton(createCfg(HexAssets.Textures.Icons.Back, this.onResetBoard));

        // Layout
        [newBtn, autoBtn, resetBtn].forEach((btn, i) => {
            btn.x = i * 90;
            this.addChild(btn);
            this.buttons.push(btn);
        });
    }
}