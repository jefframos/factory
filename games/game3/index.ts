import { Game } from '@core/Game';
import LoaderScene from '@core/loader/LoaderScene';
import { ManifestHelper } from '@core/loader/ManifestHelper';
import PlatformHandler from '@core/platforms/PlatformHandler';
import PokiPlatform from '@core/platforms/PokiPlatform';
import { PopupManager } from '@core/popup/PopupManager';
import { SceneManager } from '@core/scene/SceneManager';
import { ExtractTiledFile } from '@core/tiled/ExtractTiledFile';
import * as PIXI from 'pixi.js';
import Gameplay2048Scene from './game/2048/scene/Gameplay2048Scene';
import GameplayCafeScene from './game/cafe/GameplayCafeScene';
import { DevGuiManager } from './game/cafe/utils/DevGuiManager';
import GameplayCharacterData from './game/character/GameplayCharacterData';
import { convertCharacterSetTable, Fonts } from './game/character/Types';
import { ConfirmationPopup } from './game/popup/ConfirmationPopup';
import { GameOverPopup } from './game/popup/GameOverPopup';
import StartupScene from './game/scenes/StartupScene';
import fontManifest from './manifests/fonts.json'; // adjust path
import imageManifest from './manifests/images.json'; // adjust path
import jsonManifest from './manifests/json.json'; // adjust path


export default class MyGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene!: LoaderScene;

    private folder: string = 'game3'

    private popupManager: PopupManager = new PopupManager();


    constructor() {
        super(undefined, true);

        PlatformHandler.instance.initialize(new PokiPlatform())

        PlatformHandler.instance.platform.startLoad();
        this.stageContainer.addChild(this.gameContainer);
        this.sceneManager = new SceneManager(this.gameContainer);
        this.loaderScene = this.sceneManager.register('loader', LoaderScene);
        this.sceneManager.changeScene('loader');
        this.loadAssets();
    }



    protected async loadAssets() {
        // initial sizing
        await PIXI.Assets.init();

        const bundles = []
        const images = ManifestHelper.patchPaths(imageManifest, `${this.folder}/images/`);
        PIXI.Assets.addBundle('images', images.bundles[0].assets)
        bundles.push(images)

        const fonts = ManifestHelper.patchPaths(fontManifest, `${this.folder}/fonts/`);
        PIXI.Assets.addBundle('fonts', fonts.bundles[0].assets)
        bundles.push(fonts)

        console.log(jsonManifest)
        const json = ManifestHelper.patchPaths(jsonManifest, `${this.folder}/json/`);
        PIXI.Assets.addBundle('json', json.bundles[0].assets)
        bundles.push(json)


        console.log(json.bundles[0].assets)

        await PIXI.Assets.loadBundle('json', (p) => {
            this.loaderScene.updateLoader(p * 1 / bundles.length);
        })

        await PIXI.Assets.loadBundle('fonts', (p) => {
            this.loaderScene.updateLoader(p * 1 / bundles.length);
        })

        const aliases = ManifestHelper.getAliasesWithoutExtension(fontManifest)

        aliases.forEach(async element => {
            const font = PIXI.Assets.get(element)
            const style = document.createElement('style');
            style.textContent = `
            @font-face {
                font-family: ${element};
                src: url('./${this.folder}/fonts/${element}.woff2') format('woff2');
                font-weight: normal;
                font-style: normal;
            }
            `;
            document.head.appendChild(style);
            document.fonts.add(font);
            await document.fonts.ready;
            await document.fonts.load('16px ' + element);

        });


        await PIXI.Assets.loadBundle('images', (p) => {
            this.loaderScene.updateLoader(p * 1 / bundles.length);
        })


        PlatformHandler.instance.platform.loadFinished();

        const externalSet = PIXI.Assets.get('characterMemeSet.json')
        if (externalSet) {
            GameplayCharacterData.registerTable('meme', convertCharacterSetTable(PIXI.Assets.get('characterMemeSet.json')))
        }

        const externalSetMonster = PIXI.Assets.get('characterMonsterSet.json')
        if (externalSetMonster) {
            GameplayCharacterData.registerTable('monster', convertCharacterSetTable(PIXI.Assets.get('characterMonsterSet.json')))

            GameplayCharacterData.setTable('monster')
        }

        const externalSetUnicorn = PIXI.Assets.get('characterUnicornSet.json')
        if (externalSetUnicorn) {
            GameplayCharacterData.registerTable('unicorn', convertCharacterSetTable(PIXI.Assets.get('characterUnicornSet.json')))

            // GameplayCharacterData.setTable('unicorn')
        }

        const tiled = PIXI.Assets.get('tiled.json')
        if (tiled) {
            ExtractTiledFile.parseTiledData(tiled, '2048')
        }

        const memeWorld = PIXI.Assets.get('memeWorld.json')
        if (memeWorld) {
            ExtractTiledFile.parseTiledData(memeWorld, 'memeWorld')
        }

        const memeUi = PIXI.Assets.get('memeUi.json')
        if (memeUi) {
            ExtractTiledFile.parseTiledData(memeUi, 'memeUi')
        }

        PIXI.BitmapFont.from(Fonts.MainFamily, {
            ...Fonts.Main,
            letterSpacing: 8,
        }, {
            chars: ['0123456789: ?!{}()@#$%^&*-+', ['a', 'z'], ['A', 'Z']]
        });



        this.overlayContainer.addChild(this.popupManager)
        this.popupManager.registerPopup('confirm', new ConfirmationPopup(), false);
        this.popupManager.registerPopup('gameOver', new GameOverPopup(), false);



        this.startGame();

    }
    /** After load: wire up scenes and show first one */
    protected startGame(): void {

        DevGuiManager.instance.initialize(Game.debugParams.dev);
        const mainMenu = this.sceneManager.register<StartupScene>('menu', StartupScene);
        mainMenu.onGamePlay.add(() => {

            this.sceneManager.changeScene('game');
        })

        const gameplay = this.sceneManager.register<Gameplay2048Scene>('game', Gameplay2048Scene);

        gameplay.onQuit.add(() => {

            this.sceneManager.changeScene('menu');
        })
        const gameplayCafe = this.sceneManager.register<GameplayCafeScene>('cafe', GameplayCafeScene);

        this.sceneManager.changeScene(Game.debugParams.scene || 'game');
        this.sceneManager.resize();
    }

    protected override update(delta: number): void {
        this.sceneManager?.update(delta);
        this.popupManager?.update(delta)

    }

    protected override onResize(): void {
        super.onResize();
        this.sceneManager?.resize();
    }
}

// bootstrap
new MyGame();
