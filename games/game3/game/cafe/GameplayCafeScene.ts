import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledLayerObject, { FoundTiledObject } from "@core/tiled/TiledLayerObject";
import { DebugGraphicsHelper } from "@core/utils/DebugGraphicsHelper";
import { StringUtils } from "@core/utils/StringUtils";
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { StaticColliderLayer } from "../../../../core/collision/StaticColliderLayer";
import GameplayCharacterData from "../character/GameplayCharacterData";
import AnalogInput from "../io/AnalogInput";
import KeyboardInputMovement from "../io/KeyboardInputMovement";
import { CameraComponent } from "./camera/CameraComponent";
import { ClassRegistry } from "./manager/ClassRegistry";
import { GameManager } from "./manager/GameManager";
import { TriggerManager } from "./manager/TriggerManager";
import ActiveableTrigger from "./manager/triggers/ActiveableTrigger";
import DispenserTrigger from "./manager/triggers/DispenserTrigger";
import CaffeeStation from "./manager/triggers/stations/CaffeeStation";
import CashierStation from "./manager/triggers/stations/CashierStation";
import TimeDispenserTrigger from "./manager/triggers/TimeDispenserTrigger";
import { UpgradeManager } from "./manager/upgrade/UpgradeManager";
import { createAreaInstance, ItemType, ProgressionManager } from "./progression/ProgressionManager";
import { DevGuiManager } from "./utils/DevGuiManager";
import ActionEntity from "./view/ActionEntity";
import EntityView from "./view/EntityView";
import GameplayHud from "./view/GameplayHud";
ClassRegistry.register('ActiveableTrigger', ActiveableTrigger);
ClassRegistry.register('CaffeeStation', CaffeeStation);
ClassRegistry.register('CashierStation', CashierStation);


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

    private player: ActionEntity;
    private camera: CameraComponent

    static tiledGameplayLayer: TiledLayerObject = new TiledLayerObject()
    static tiledTriggerLayer: TiledLayerObject = new TiledLayerObject()

    private hud!: GameplayHud;

    static belongGroup: Record<string, Array<FoundTiledObject>>

    constructor() {
        super();

        GameplayCharacterData.setTable('meme')

        const gm = GameManager.instance;
        const level = gm.getLevelData();


        ProgressionManager.instance.initialize(PIXI.Cache.get('cafeProgression.json'));
        UpgradeManager.instance.initialize(PIXI.Cache.get('upgradeSettings.json'));

        const worldSettings = ExtractTiledFile.getTiledFrom('memeWorld')

        GameplayCafeScene.tiledGameplayLayer.build(worldSettings!, ['Floor', 'Background'])
        this.worldContainer.addChild(GameplayCafeScene.tiledGameplayLayer);
        GameplayCafeScene.tiledGameplayLayer.sortableChildren = true;

        GameplayCafeScene.tiledTriggerLayer.build(worldSettings!, ['Gameplay'])
        this.worldContainer.addChild(GameplayCafeScene.tiledTriggerLayer);
        GameplayCafeScene.tiledTriggerLayer.sortableChildren = true;

        GameplayCafeScene.tiledGameplayLayer.addColliders()
        GameplayCafeScene.belongGroup = GameplayCafeScene.tiledGameplayLayer.groupByProperty('belongsTo')

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

        this.player = new ActionEntity('PLAYER')
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
        const playerProps = GameplayCafeScene.tiledGameplayLayer.findAndGetFromProperties('id', 'player')
        if (playerProps) {
            this.player.setPosition(playerProps.object.x + playerProps.object.width / 2, playerProps.object.y + playerProps.object.height / 2)
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




        this.buildArea('cashier-1')
        this.buildArea('coffee-1')
        this.buildArea('clientDispenser-1')


        const overtime = new TimeDispenserTrigger('upgrade3');
        this.gameplayContainer.addChild(overtime.getView());
        overtime.setPosition(700, 300);
        overtime.setUpStackList(3, 5, 40, 15, 60)


        const dispenserTrigger = new DispenserTrigger('upgrade4');
        this.gameplayContainer.addChild(dispenserTrigger.getView());
        dispenserTrigger.setPosition(820, 300);
        dispenserTrigger.setUpStackList(3, 5, 40, 15, 60)

        TriggerManager.onTriggerAction.add((trigger, action) => {

        })

        TriggerManager.onTriggerEnter.add((trigger, source) => {
            const component = TriggerManager.getComponent(trigger.id)
            if (source == this.player) {
                if (component instanceof DispenserTrigger) {
                    const stackList = component.stackList;

                    if (component.itemType == ItemType.MONEY && stackList.totalAmount) {
                        const level = GameManager.instance.getLevelData();
                        level.soft.coins.update(stackList.totalAmount * 5);
                        stackList.clear();
                    }
                }
            }
        })

        // const collector = new CollectorStayTrigger('collector', 50);
        // this.gameplayContainer.addChild(collector.getView());
        // collector.setPosition(1000, 600);
        // collector.onUpgrade.add((id, value) => {
        //     const level = GameManager.instance.getLevelData();
        //     level.soft.coins.update(1);
        // })

        ProgressionManager.instance.onAreaUnlocked.add((id) => {
            const area = ProgressionManager.instance.getAreaProgress(id);
            if (area) {
                console.log(`Area Unlocked: ${id}: Current Value: ${area.currentValue.value}, Level: ${area.level.value}`);
                const areaComponent = TriggerManager.getComponent(id)
                areaComponent?.enable();

            }
        });
        ProgressionManager.instance.onLevelUp.add((id) => {
            const area = ProgressionManager.instance.getAreaProgress(id);
            if (area) {

                const trigger = TriggerManager.getComponent(id)
                trigger?.levelUp()
                console.log(`Area Level Up: ${id}: New Level: ${area.level.value}, Actions Completed: ${area.actionsCompleted.value}`, trigger);
            }
        });



        DevGuiManager.instance.addButton('Add Value', () => {
            ProgressionManager.instance.addValue('upgrade1', 20)
            const area = ProgressionManager.instance.getAreaProgress('upgrade1');
            if (area) {
                console.log(`Current Value: ${area.currentValue.value}, Level: ${area.level.value}`);
            }
        }, "MISC");

        DevGuiManager.instance.addButton('Add Value on Dispenser', () => {
            const component = TriggerManager.getComponent('upgrade4')
            if (component instanceof DispenserTrigger) {
                component.tryExecuteAction()
            }

        }, "MISC");
    }
    private buildArea(id: string) {
        const ups = UpgradeManager.instance.getUpgrade(id)

        console.log('check the required level, if it is the correct level make this statio works, must attach the trigger with the station', ups, id, UpgradeManager.instance)

        GameplayCafeScene.tiledTriggerLayer.findAndGetByName(id).then((obj) => {

            let states = obj?.object?.properties?.states
            if (states) {
                states = StringUtils.parseStringArray(states)
            }
            const instance = ProgressionManager.instance.getRawArea(id)
            const cashier = createAreaInstance(instance!, [id, obj?.object.width / 2])

            this.gameplayContainer.addChild(cashier.getView());
            cashier.setPosition(obj?.object.x + obj?.object.width / 2, obj?.object.y + obj?.object.height / 2)

            cashier.setProgressData(ProgressionManager.instance.getAreaProgress(id));
            cashier.onUpgrade.add((id, value) => {
                ProgressionManager.instance.addValue(id, value);
            })

        })
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

        TriggerManager.updateTriggers(delta);
    }
    public resize(): void {
        this.camera.setScreenBounds(new PIXI.Rectangle(Game.gameScreenData.topLeft.x, Game.gameScreenData.topLeft.y, Game.gameScreenData.width, Game.gameScreenData.height));
    }
}
