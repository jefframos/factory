import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import MainSceneUi from "../ui/MainSceneUi";

export interface MenuButtonData {
    id: string;
    label: string;
}

export default class StartupScene extends GameScene {

    public onGamePlay: Signal = new Signal();

    private title!: PIXI.Text;

    private mainScene!: MainSceneUi;

    constructor() {
        super();
        this.mainScene = new MainSceneUi(ExtractTiledFile.TiledData, ['MainScreen']);
        this.addChild(this.mainScene);

        this.mainScene.onPlay.add(() => {
            this.onGamePlay.dispatch()
        })

    }
    public build(...data: any[]): void {

    }
    public override destroy(): void {
    }

    public update(delta: number): void {

    }
}
