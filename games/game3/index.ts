import { Game } from '@core/Game';
import LoaderScene from '@core/loader/LoaderScene';
import { ManifestHelper } from '@core/loader/ManifestHelper';
import { SceneManager } from '@core/scene/SceneManager';
import { ExtractTiledFile } from '@core/tiled/ExtractTiledFile';
import * as PIXI from 'pixi.js';
import { CharacterTableStore, convertCharacterSetTable } from './game/character/Types';
import GameplayScene from './game/scenes/GameplayScene';
import fontManifest from './manifests/fonts.json'; // adjust path
import imageManifest from './manifests/images.json'; // adjust path
import jsonManifest from './manifests/json.json'; // adjust path


export default class MyGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene!: LoaderScene;

    private folder: string = 'game3'

    constructor() {
        super(undefined, true);
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

        const externalSet = PIXI.Assets.get('characterMemeSet.json')
        if (externalSet) {
            CharacterTableStore.data = convertCharacterSetTable(PIXI.Assets.get('characterMemeSet.json'))
        }

        const tiled = PIXI.Assets.get('tiled.json')
        if (tiled) {
            ExtractTiledFile.parseTiledData(tiled)
        }

        this.startGame();

    }
    /** After load: wire up scenes and show first one */
    protected startGame(): void {

        const mainMenu = this.sceneManager.register<GameplayScene>('game', GameplayScene);
        this.sceneManager.changeScene('game');
        this.sceneManager.resize();
    }

    protected override update(delta: number): void {
        this.sceneManager?.update(delta);
    }

    protected override onResize(): void {
        super.onResize();
        this.sceneManager?.resize();
    }
}

// bootstrap
new MyGame();
