import SoundLoadManager from '@core/audio/SoundLoaderManager';
import { Game } from '@core/Game';
import { ManifestHelper } from '@core/loader/ManifestHelper';
import GameDistributionPlatform from '@core/platforms/GameDistributionPlatform';
import PlatformHandler from '@core/platforms/PlatformHandler';
import { PopupManager } from '@core/popup/PopupManager';
import { SceneManager } from '@core/scene/SceneManager';
import { ExtractTiledFile } from '@core/tiled/ExtractTiledFile';
import * as PIXI from 'pixi.js';
import MergeLoader from './game/loader/MergeLoader';
import MergeAssets from './game/merge/MergeAssets';
import MergeScene from './game/merge/MergeScene';
import { PrizePopup } from './game/merge/ui/prize/PrizePopup';
import { DevGuiManager } from './game/utils/DevGuiManager';
import audioManifest from './manifests/audio.json'; // adjust path
import fontManifest from './manifests/fonts.json'; // adjust path
import imageManifest from './manifests/images.json'; // adjust path
import jsonManifest from './manifests/json.json'; // adjust path


export default class MyGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene!: MergeLoader;


    private popupManager: PopupManager = new PopupManager();


    constructor() {
        super({ resolution: Math.max(2, (devicePixelRatio || 1)) }, false);

        PIXI.Ticker.shared.maxFPS = 100;

        this.folderPath = 'merge1';

        PlatformHandler.ENABLE_VIDEO_ADS = true;
        GameDistributionPlatform.KAKAKAKAKAKA = 'f7cdc30e8fd14e50a3170c485f207936';
        PlatformHandler.instance.initialize(new GameDistributionPlatform()).then(() => {
            PlatformHandler.instance.platform.startLoad();
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            this.loaderScene = this.sceneManager.register('loader', MergeLoader);
            this.sceneManager.changeScene('loader');
            this.loadAssets();
        })

    }



    protected async loadAssets() {
        // initial sizing
        await PIXI.Assets.init();
        //await GameStorage.instance.getFullState();

        const bundles = []
        const images = ManifestHelper.patchPaths(imageManifest, `${this.folderPath}/images/`);
        PIXI.Assets.addBundle('images', images.bundles[0].assets)
        bundles.push(images)

        const fonts = ManifestHelper.patchPaths(fontManifest, `${this.folderPath}/fonts/`);
        PIXI.Assets.addBundle('fonts', fonts.bundles[0].assets)
        bundles.push(fonts)

        console.log(jsonManifest)
        const json = ManifestHelper.patchPaths(jsonManifest, `${this.folderPath}/json/`);
        PIXI.Assets.addBundle('json', json.bundles[0].assets)
        bundles.push(json)


        console.log(images.bundles[0].assets)

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
                src: url('./${this.folderPath}/fonts/${element}.woff2') format('woff2');
                font-weight: normal;
                font-style: normal;
            }
            `;
            document.head.appendChild(style);
            document.fonts.add(font);
            await document.fonts.ready;
            await document.fonts.load('16px ' + element);

        });

        console.log(bundles)
        await PIXI.Assets.loadBundle('images', (p) => {
            this.loaderScene.updateLoader(p * 1 / bundles.length);
        })


        //await PromiseUtils.await(5000)


        const sounds = ManifestHelper.patchPaths(audioManifest, `${this.folderPath}/audio`);
        SoundLoadManager.instance.setUpManifests([sounds], ["default"])

        PlatformHandler.instance.platform.loadFinished();

        const tiled = PIXI.Assets.get('tiled.json')
        if (tiled) {
            ExtractTiledFile.parseTiledData(tiled, 'garden')
        }



        //  const tiled = PIXI.Assets.get('tiled.json')
        //         if (tiled) {
        //             ExtractTiledFile.parseTiledData(tiled, '2048')
        //         }
        // const memeUi = PIXI.Assets.get('memeUi.json')
        // if (memeUi) {
        //     ExtractTiledFile.parseTiledData(memeUi, 'memeUi')
        // }

        PIXI.BitmapFont.from(MergeAssets.MainFont.fontFamily as string, {
            ...MergeAssets.MainFont,
            strokeThickness: 6,
            //resolution: 2,
            letterSpacing: 10,
        }, {
            chars: ['0123456789: ?!{}()@#$%^&*-+,./', ['a', 'z'], ['A', 'Z']]
        });



        this.overlayContainer.addChild(this.popupManager)
        // this.popupManager.registerPopup('confirm', new ConfirmationPopup(), false);
        // this.popupManager.registerPopup('gameOver', new GameOverPopup(), false);
        this.popupManager.registerPopup('prize', new PrizePopup(), false);



        this.startGame();

    }
    /** After load: wire up scenes and show first one */
    protected startGame(): void {

        DevGuiManager.instance.initialize(Game.debugParams.dev);
        const gameplay = this.sceneManager.register<MergeScene>('game', MergeScene, this);
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
