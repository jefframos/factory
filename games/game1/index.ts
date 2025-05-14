import { Game } from '@core/Game';
import LoaderScene from '@core/loader/LoaderScene';
import { ManifestHelper } from '@core/loader/ManifestHelper';
import { SceneManager } from '@core/scene/SceneManager';
import * as PIXI from 'pixi.js';
import fontManifest from '../../public/game1/fonts/manifest.json'; // adjust path
import imageManifest from '../../public/game1/images/manifest.json'; // adjust path
import CardScene from './game/scenes/card/CardScene';
import MainMenuScene, { MenuButtonData } from './game/scenes/MainMenuScene';
import ParticleScene from './game/scenes/particles/ParticleScene';
import WordsScene from './game/scenes/words/WordsScene';


export default class MyGame extends Game {
    private gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private loaderScene!: LoaderScene;

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
        const images = ManifestHelper.patchPaths(imageManifest, 'game1/images/');
        PIXI.Assets.addBundle('images', images.bundles[0].assets)

        const fonts = ManifestHelper.patchPaths(fontManifest, 'game1/fonts/');
        PIXI.Assets.addBundle('fonts', fonts.bundles[0].assets)


        console.log(fonts)

        await PIXI.Assets.loadBundle('fonts', (p) => {
            this.loaderScene.updateLoader(p * 0.5);
        })

        const aliases = ManifestHelper.getAliasesWithoutExtension(fontManifest)

        aliases.forEach(async element => {
            const font = PIXI.Assets.get(element)
            const style = document.createElement('style');
            style.textContent = `
            @font-face {
                font-family: ${element};
                src: url('./game1/fonts/${element}.woff2') format('woff2');
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
            this.loaderScene.updateLoader(p * 0.5 + 0.5);
        })
        this.startGame();

    }
    /** After load: wire up scenes and show first one */
    protected startGame(): void {

        const buttonData: MenuButtonData[] = [
            { id: 'card', label: 'Cards' },
            { id: 'word', label: 'Word' },
            { id: 'particles', label: 'Particles' },
        ];
        const mainMenu = this.sceneManager.register<MainMenuScene>('menu', MainMenuScene, buttonData);
        mainMenu.onButtonPressed.add((targetScene: string) => {

            this.sceneManager.changeScene(targetScene);
        })
        this.sceneManager.register<CardScene>('card', CardScene).onButtonPressed.add(() => {
            this.sceneManager.changeScene('menu');
        });
        this.sceneManager.register<WordsScene>('word', WordsScene).onButtonPressed.add(() => {
            this.sceneManager.changeScene('menu');
        });
        this.sceneManager.register<ParticleScene>('particles', ParticleScene).onButtonPressed.add(() => {
            this.sceneManager.changeScene('menu');
        });
        this.sceneManager.changeScene('menu');
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
