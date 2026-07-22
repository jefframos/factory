import { Game } from "core/Game";
import SoundToggleButton from "core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import { NextPiecePreview } from "./NextPiecePreview";
import { PieceDefinition } from "./PieceStorage";

export class GameHud extends PIXI.Container {
    private soundBtn!: SoundToggleButton;

    private nextPiecePreview!: NextPiecePreview;

    private readonly gameplayLayer: PIXI.Container = new PIXI.Container();

    constructor() {
        super();

        this.addChild(this.gameplayLayer);

        this.nextPiecePreview = new NextPiecePreview();

        this.soundBtn = new SoundToggleButton(
            "PictoIcon_Music_1",
            "PictoIcon_Music_1_Off"
        );
        this.gameplayLayer.addChild(this.soundBtn);
        this.gameplayLayer.addChild(this.nextPiecePreview);

        this.soundBtn.scale.set(0.7)

    }

    public showNextPiece(piece: PieceDefinition) {
        this.nextPiecePreview.show(piece)
    }
    public layout(): void {
        const padding = 20;
        const topY = Game.overlayScreenData.topLeft.y;
        const bottomY = Game.overlayScreenData.bottomLeft.y;
        const rightX = Game.overlayScreenData.topRight.x;
        const leftX = Game.overlayScreenData.topLeft.x;
        const centerX = Game.DESIGN_WIDTH / 2;


        this.soundBtn.position.set(rightX - this.soundBtn.width / 2 - padding, topY + this.soundBtn.height / 2 + padding);
        this.nextPiecePreview.position.set(rightX - this.nextPiecePreview.width - padding, this.soundBtn.y + this.soundBtn.height / 2 + padding);


    }
}