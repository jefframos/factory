import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import AutoPositionTiledContainer from "@core/tiled/AutoPositionTiledContainer";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import { ScaleMode } from "@core/tiled/TiledAutoPositionObject";
import TiledLayerObject from "@core/tiled/TiledLayerObject";
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import GameplayCharacterData from "../character/GameplayCharacterData";
import AnalogInput from "../io/AnalogInput";
import KeyboardInputMovement from "../io/KeyboardInputMovement";
import { CameraComponent } from "./camera/CameraComponent";
import EntityView from "./view/EntityView";
import MoveableEntity from "./view/MoveableEntity";


export default class GameplayCafeScene extends GameScene {

    public onGamePlay: Signal = new Signal();

    private title!: PIXI.Text;

    private analogInput: AnalogInput;
    private keyboardInput: KeyboardInputMovement;

    private worldContainer: PIXI.Container = new PIXI.Container();
    private inputContainer: PIXI.Container = new PIXI.Container();
    private uiContainer: PIXI.Container = new PIXI.Container();
    private inputShape: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)

    private player: MoveableEntity;
    private camera: CameraComponent

    private tiledWorld: TiledLayerObject = new TiledLayerObject()
    private hud: AutoPositionTiledContainer;

    constructor() {
        super();

        const worldSettings = ExtractTiledFile.getTiledFrom('memeWorld')
        const uiSettings = ExtractTiledFile.getTiledFrom('memeUi')



        this.tiledWorld.build(worldSettings, ['Floor', 'Background'])
        this.worldContainer.addChild(this.tiledWorld);
        this.tiledWorld.sortableChildren = true;

        this.addChild(this.worldContainer)
        this.addChild(this.inputContainer)

        this.inputContainer.addChild(this.inputShape)
        this.inputShape.alpha = 0.2

        this.analogInput = new AnalogInput(this.inputContainer)
        this.analogInput.onMove.add(({ direction, magnitude }) => {
            this.player.setInput(direction, magnitude);
        });

        this.keyboardInput = new KeyboardInputMovement()
        this.keyboardInput.onMove.add(({ direction, magnitude }) => {
            this.player.setInput(direction, magnitude);
        });

        this.player = new MoveableEntity()
        this.player.setCharacter(new EntityView(GameplayCharacterData.fetchById(0)!))
        this.player.maxSpeed = 400

        this.camera = new CameraComponent(this.worldContainer)
        this.camera.target = this.player;

        this.camera.setWorldBounds(new PIXI.Rectangle(0, 0, worldSettings?.settings?.properties.screenWidth, worldSettings?.settings?.properties.screenHeight));

        const playerProps = this.tiledWorld.findFromProperties('id', 'player')
        if (playerProps) {
            this.player.x = playerProps.object.x
            this.player.y = playerProps.object.y
            playerProps.view?.parent.addChild(this.player)
            playerProps.view.parent.sortableChildren = true;
            // const layerContainer = this.tiledWorld.getLayerByName()
            // if (layerContainer) {
            //     layerContainer.container.addChild(this.player)
            //     layerContainer.container.sortableChildren = true;
            // }
        }

        this.hud = new AutoPositionTiledContainer(uiSettings, ['HUD'], { scaleMode: ScaleMode.MATCH, matchRatio: 0 })
        this.uiContainer.addChild(this.hud);
        this.addChild(this.uiContainer)

    }
    public build(...data: any[]): void {

    }
    public override destroy(): void {
    }

    public update(delta: number): void {
        this.player?.update(delta)
        this.camera?.update(delta)


        //console.log(this.player.zIndex)
        this.inputShape.width = Game.overlayScreenData.width
        this.inputShape.height = Game.overlayScreenData.height

        this.inputShape.x = Game.overlayScreenData.topLeft.x
        this.inputShape.y = Game.overlayScreenData.topLeft.y
    }
    public resize(): void {
        this.camera.setScreenBounds(new PIXI.Rectangle(Game.gameScreenData.topLeft.x, Game.gameScreenData.topLeft.y, Game.gameScreenData.width, Game.gameScreenData.height));
        //this.camera.setScreenBounds(new PIXI.Rectangle(0, 0, Game.gameScreenData.width, Game.gameScreenData.height));

    }
}
