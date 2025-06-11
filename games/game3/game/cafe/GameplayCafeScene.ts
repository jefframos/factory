import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledLayerObject from "@core/tiled/TiledLayerObject";
import { DebugGraphicsHelper } from "@core/utils/DebugGraphicsHelper";
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { StaticColliderLayer } from "../../../../core/collision/StaticColliderLayer";
import GameplayCharacterData from "../character/GameplayCharacterData";
import AnalogInput from "../io/AnalogInput";
import KeyboardInputMovement from "../io/KeyboardInputMovement";
import { CameraComponent } from "./camera/CameraComponent";
import { GameManager } from "./manager/GameManager";
import { UpgradeTrigger } from "./manager/UpgradeTrigger";
import { WorldManager } from "./manager/WorldManager";
import EntityView from "./view/EntityView";
import GameplayHud from "./view/GameplayHud";
import MoveableEntity from "./view/MoveableEntity";


export default class GameplayCafeScene extends GameScene {

    public onGamePlay: Signal = new Signal();

    private title!: PIXI.Text;

    private analogInput: AnalogInput;
    private keyboardInput: KeyboardInputMovement;

    private worldContainer: PIXI.Container = new PIXI.Container();
    private inputContainer: PIXI.Container = new PIXI.Container();

    private gameplayContainer: PIXI.Container = new PIXI.Container();


    private uiContainer: PIXI.Container = new PIXI.Container();
    private inputShape: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)

    private player: MoveableEntity;
    private camera: CameraComponent

    private tiledWorld: TiledLayerObject = new TiledLayerObject()

    private hud!: GameplayHud;

    constructor() {
        super();


        const gm = GameManager.instance;
        const level = gm.getLevelData();

        const worldSettings = ExtractTiledFile.getTiledFrom('memeWorld')

        this.tiledWorld.build(worldSettings!, ['Floor', 'Background'])
        this.worldContainer.addChild(this.tiledWorld);
        this.tiledWorld.sortableChildren = true;

        this.addChild(this.worldContainer)
        this.addChild(this.inputContainer)
        this.addChild(this.uiContainer);


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

        this.player = new MoveableEntity('PLAYER')
        this.player.setCharacter(new EntityView(GameplayCharacterData.fetchById(0)!))
        this.player.maxSpeed = 200
        DebugGraphicsHelper.addCircle(this.player)

        this.camera = new CameraComponent(this.worldContainer)
        this.camera.target = this.player;
        this.camera.setWorldBounds(new PIXI.Rectangle(
            0,
            0,
            worldSettings?.settings?.properties?.screenWidth ?? 800,
            worldSettings?.settings?.properties?.screenHeight ?? 600
        ));

        //this position the player on the correct world container
        const playerProps = this.tiledWorld.findAndGetFromProperties('id', 'player')
        if (playerProps) {

            this.player.setPosition(playerProps.object.x, playerProps.object.y)
            if (playerProps.view) {
                playerProps.view?.parent.addChild(this.player)
                this.gameplayContainer = playerProps.view?.parent;
                this.gameplayContainer.sortableChildren = true;
            }
        }

        const uiSettings = ExtractTiledFile.getTiledFrom('memeUi')

        this.hud = new GameplayHud(uiSettings!);
        this.uiContainer.addChild(this.hud);


        new StaticColliderLayer(worldSettings?.layers.get('Colliders')!, this.worldContainer, true)

        this.tiledWorld.addColliders()

        //this.tiledWorld.setActiveObjectByName('Bench2', false)
        const upgrade1 = new UpgradeTrigger('upgrade1', 100);
        this.gameplayContainer.addChild(upgrade1.getView());
        upgrade1.setPosition(750, 500);
        const upgrade2 = new UpgradeTrigger('upgrade2', 50);
        this.gameplayContainer.addChild(upgrade2.getView());
        upgrade2.setPosition(1000, 300);

        WorldManager.instance.registerTrigger(upgrade1);
        WorldManager.instance.registerTrigger(upgrade2);

        upgrade1.refresh()
        upgrade2.refresh()

    }
    public build(...data: any[]): void {

    }
    public override destroy(): void {
    }

    public update(delta: number): void {
        this.player?.update(delta)
        this.camera?.update(delta)

        this.inputShape.width = Game.overlayScreenData.width
        this.inputShape.height = Game.overlayScreenData.height

        this.inputShape.x = Game.overlayScreenData.topLeft.x
        this.inputShape.y = Game.overlayScreenData.topLeft.y

        this.worldContainer.x = Game.overlayScreenData.center.x
        this.worldContainer.y = Game.overlayScreenData.center.y
    }
    public resize(): void {
        this.camera.setScreenBounds(new PIXI.Rectangle(Game.gameScreenData.topLeft.x, Game.gameScreenData.topLeft.y, Game.gameScreenData.width, Game.gameScreenData.height));
    }
}
