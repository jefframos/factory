import SoundLoadManager from '@core/audio/SoundLoaderManager';
import { Game } from '@core/Game';
import LoaderScene from '@core/loader/LoaderScene';
import { ManifestHelper } from '@core/loader/ManifestHelper';
import PlatformHandler from '@core/platforms/PlatformHandler';
import { PopupManager } from '@core/popup/PopupManager';
import { SceneManager } from '@core/scene/SceneManager';
import * as PIXI from 'pixi.js';
import MergeLoader from './game/loader/MergeLoader';
import { ConfirmationPopup } from './game/popup/ConfirmationPopup';
import audioManifest from './manifests/audio.json'; // adjust path
import fontManifest from './manifests/fonts.json'; // adjust path
import imageManifest from './manifests/images.json'; // adjust path
import jsonManifest from './manifests/json.json'; // adjust path

import { getPlatformInstance } from '@core/platforms/PlatformFactory';
import { DevGuiManager } from '@core/utils/DevGuiManager';
import Assets from './Assets';
import LevelEditorScene from './netgame/editor/LevelEditorScene';
import NetScene from './netgame/scenes/NetScene';
import platformConfig from './platforms.config.json';

export default class MyGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene!: MergeLoader;


    private popupManager: PopupManager = new PopupManager();


    constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        PIXI.Ticker.shared.maxFPS = 60;

        this.folderPath = 'net';
        this.initialize();

    }
    protected async initialize() {
        // 1. Determine platform (fallback to 'local')
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = platformConfig[platformName];

        // 2. Set dynamic paths from config (if defined, else keep 'hex' as default)
        this.folderPath = config?.folder || 'net';

        try {

            this.setCanvasZIndex(8)
            PlatformHandler.GAME_ID = config?.gameId || '';
            PlatformHandler.ENABLE_VIDEO_ADS = config?.enableAds ?? true;

            // 3. Wait for the platform instance
            const plat = await getPlatformInstance(platformName);



            // 4. Initialize the Handler
            await PlatformHandler.instance.initialize(plat);

            // 5. Setup Game Flow
            PlatformHandler.instance.platform.startLoad();
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            this.loaderScene = this.sceneManager.register('loader', LoaderScene);
            this.sceneManager.changeScene('loader');

            // 6. Proceed to assets
            this.loadAssets();
        } catch (error) {
            console.error("Failed to initialize platform:", error);
            // Optional: Fallback logic if a platform SDK fails to load
        }
    }


    protected async loadAssets() {
        // initial sizing
        await PIXI.Assets.init();

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

        for (const element of aliases) {
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

        };

        console.log(bundles)
        await PIXI.Assets.loadBundle('images', (p) => {
            this.loaderScene.updateLoader(p * 1 / bundles.length);
        })


        //await PromiseUtils.await(5000)


        const sounds = ManifestHelper.patchPaths(audioManifest, `${this.folderPath}/audio`);
        SoundLoadManager.instance.setUpManifests([sounds], ["default"])

        PlatformHandler.instance.platform.loadFinished();



        PIXI.BitmapFont.from(Assets.MainFont.fontFamily as string, {
            ...Assets.MainFont,
            strokeThickness: 6,
            //resolution: 2,
            letterSpacing: 10,
        }, {
            chars: ['0123456789: ?!{}()@#$%^&*-+,./', ['a', 'z'], ['A', 'Z']]
        });

        PIXI.BitmapFont.from(Assets.MainFontTitle.fontFamily as string, {
            ...Assets.MainFontTitle,
            strokeThickness: 6,
            //resolution: 2,
            letterSpacing: 10,
        }, {
            chars: ['0123456789: ?!{}()@#$%^&*-+,./', ['a', 'z'], ['A', 'Z']]
        });



        this.overlayContainer.addChild(this.popupManager)
        this.popupManager.registerPopup('confirm', new ConfirmationPopup(), false);


        // this.popupManager.registerPopup('confirm', new ConfirmationPopup(), false);
        // this.popupManager.registerPopup('gameOver', new GameOverPopup(), false);
        // this.popupManager.registerPopup('prize', new PrizePopup(), false);



        this.startGame();

    }
    /** After load: wire up scenes and show first one */
    protected startGame(): void {

        DevGuiManager.instance.initialize(Game.debugParams.dev);
        const gameplay = this.sceneManager.register<NetScene>('game', NetScene, this);
        if (Game.debugParams.scene === 'level') {
            const editor = this.sceneManager.register<LevelEditorScene>('level', LevelEditorScene, this);
            this.sceneManager.changeScene('level');
        } else {
            this.sceneManager.changeScene(Game.debugParams.scene || 'game');
        }
        this.sceneManager.resize();
    }

    protected override update(delta: number): void {
        this.sceneManager?.update(delta);
        this.popupManager?.update(delta)

    }

    protected override fixedUpdate(delta: number): void {
        this.sceneManager?.fixedUpdate(delta);
    }

    protected override onResize(): void {
        super.onResize();
        this.sceneManager?.resize();
    }
}

// bootstrap
new MyGame();
