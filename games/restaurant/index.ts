// Restaurant — run a little restaurant: customers come in and order, you cook it at the bench, they're happy or not
// (see README.md). Boot: platform and save, the font and the UI atlas (the Layer Lab pack's sprites, raw-assets/images/
// ui{tps}), the sounds, then where the player is: the restaurant (RestaurantScene) or the supermarket before the next
// day (MarketScene). Each loads its own 3D models; the curtain (Curtain.ts) covers the switch between them, and each
// switch builds the scene afresh.

import { Game } from 'core/Game';
import SoundManager from 'core/audio/SoundManager';
import HtmlLoader from 'core/loader/HtmlLoader';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlatformInstance } from 'core/platforms/PlatformFactory';
import { SceneManager } from 'core/scene/SceneManager';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import * as PIXI from 'pixi.js';

import loaderConfig from './loader.config';
import platformConfig from './platforms.config.json';
import RestaurantScene from './game/scenes/RestaurantScene';
import MarketScene from './game/scenes/MarketScene';
import DeliveryScene from './game/scenes/DeliveryScene';
import { curtain } from './game/ui/Curtain';
import { SETTINGS } from './game/data/Settings';
import { RestaurantSave } from './game/data/RestaurantSave';
import { FLAVORS, Order, PizzaTopping, Topping, dealDay } from './game/data/Recipes';
import { RestaurantAudio } from './game/audio/RestaurantAudio';

type PlatformConfigEntry = { gameId?: string; enableAds?: boolean };

const FONTS = ['Baloo2-ExtraBold'];

export default class RestaurantGame extends Game {
    private readonly gameContainer = new PIXI.Container();
    private sceneManager!: SceneManager;
    private readonly loaderScene: HtmlLoader;
    private scenes = 0;

    public constructor() {
        super({ resolution: Math.min(2, devicePixelRatio), backgroundAlpha: 0 }, false);
        this.loaderScene = new HtmlLoader(loaderConfig);
        PIXI.Ticker.shared.maxFPS = 60;
        this.folderPath = 'restaurant';
        SoundManager.STORAGE_ID = 'restaurant.';
        void this.initialize();
    }

    protected async initialize(): Promise<void> {
        const platformName = import.meta.env.VITE_PLATFORM || 'local';
        const config = (platformConfig as Record<string, PlatformConfigEntry>)[platformName];
        try {
            this.setCanvasZIndex(8);
            PlatformHandler.GAME_ID = config?.gameId || '';
            PlatformHandler.ENABLE_VIDEO_ADS = config?.enableAds ?? true;
            await PlatformHandler.instance.initialize(await getPlatformInstance(platformName));
            await RestaurantSave.init();
            PlatformHandler.instance.platform.startLoad();
            DebugOverlay.instance.initialize(Boolean(Game.debugParams.dev || Game.debugParams.debug), 'restaurant');
            this.stageContainer.addChild(this.gameContainer);
            this.sceneManager = new SceneManager(this.gameContainer);
            await Promise.all(FONTS.map(async (family) => {
                const face = new FontFace(family, `url(./${this.folderPath}/fonts/${family}.woff2) format('woff2')`);
                document.fonts.add(await face.load());
            }));
            await PIXI.Assets.load(`${this.folderPath}/images/ui.webp.json`);
            RestaurantAudio.initialize(this.folderPath);
            this.buildDebug();
            if (RestaurantSave.place === 'market') this.showMarket();
            else if (RestaurantSave.place === 'delivery') this.showDelivery();
            else this.showRestaurant();
            PlatformHandler.instance.platform.loadFinished();
            this.loaderScene.hide();
        } catch (error) {
            console.error('Failed to initialize:', error);
        }
    }

    /**
     * The debug panel (?dev=1): every area, to jump straight to it (through the curtain, as the game goes there). New
     * areas go in AREAS.
     */
    private buildDebug(): void {
        const areas: { name: string; go: () => void }[] = [
            { name: 'RESTAURANT', go: () => { RestaurantSave.openRestaurant(); this.showRestaurant(); } },
            { name: 'SUPERMARKET', go: () => { RestaurantSave.openMarket(); this.showMarket(); } },
            // Stand-alone: the delivery at the stage the player's on (its town and restaurant).
            { name: 'PIZZA DELIVERY', go: () => { RestaurantSave.openDelivery(); this.showDelivery(); } },
            // Each stage of the restaurant (levels/restaurant.json's `from` / `until`).
            ...SETTINGS.stages.map((stage, i) => ({
                name: `${i + 1}: ${stage.name.toUpperCase()}`,
                go: () => { RestaurantSave.setStage(i); RestaurantSave.openRestaurant(); this.showRestaurant(); },
            })),
        ];
        const panel = DebugOverlay.instance.panel('Areas', { id: 'restaurant.areas' });
        // One per line (a list to pick from).
        for (const { name, go } of areas) panel.button(name, () => curtain(this, name, 'Debug jump', 'ItemIcon_Shop', go));

        // Minigames: a day set up to try one thing at once (it replaces the day the player's on). New ones go in GAMES.
        const stageOf = (id: string) => Math.max(0, SETTINGS.stages.findIndex((s) => s.id === id));
        const burger = (toppings: Topping[]): Order => ({ toppings });
        const games: { name: string; go: () => void }[] = [
            {
                // Every flavour, the machine's hints on (as a first time).
                name: 'ICE CREAM (one of each flavour)',
                go: () => {
                    RestaurantSave.forgetIceCream();
                    RestaurantSave.practice(stageOf('smallDiner'), 1, FLAVORS.map((iceCream) => ({ toppings: [], iceCream })));
                },
            },
            {
                // Every pizza, the oven's hints on (as a first time).
                name: 'PIZZA (cheese, then toppings)',
                go: () => {
                    RestaurantSave.forgetPizza();
                    const pizzas: PizzaTopping[][] = [[], ['pepperoni'], ['mushroom', 'onion'], ['tomato', 'pickles']];
                    RestaurantSave.practice(stageOf('restaurant'), 1, pizzas.map((pizza) => ({ toppings: [], pizza })));
                },
            },
            {
                // Sundaes, simple to full (the bar's hints on, as a first time): a cone, a bowl with sauce, a full one.
                name: 'SUNDAE BAR (cones and bowls)',
                go: () => {
                    RestaurantSave.forgetSundae();
                    RestaurantSave.practice(stageOf('diner'), 1, [
                        { toppings: [], sundae: { base: 'cone', scoops: ['vanilla'], sauce: null, toppings: [] } },
                        { toppings: [], sundae: { base: 'bowl', scoops: ['chocolate', 'mint'], sauce: 'caramel', toppings: ['cherry'] } },
                        { toppings: [], sundae: { base: 'bowl', scoops: ['strawberry', 'mango', 'blueberry'], sauce: 'chocolate', toppings: ['sprinkles', 'waffle'] } },
                        { toppings: [], sundae: { base: 'cone', scoops: ['chocolate', 'chocolate'], sauce: 'caramel', toppings: ['cookie'] } },
                    ]);
                },
            },
            { name: 'MIXED: BURGERS, PIZZA AND ICE CREAM', go: () => RestaurantSave.practice(stageOf('restaurant'), 1, [{ toppings: [], pizza: ['pepperoni'] }, burger(['cheese', 'onion']), { toppings: [], iceCream: 'vanilla' }, { toppings: [], pizza: ['mushroom', 'tomato'] }]) },
            { name: 'BURGERS: FOOD TRUCK QUEUE', go: () => RestaurantSave.practice(stageOf('truck'), 1, [burger(['cheese']), burger(['lettuce', 'tomato']), burger(['cheese', 'lettuce', 'tomato'])]) },
            { name: 'BURGERS: NEW TOPPINGS (pickles, onion)', go: () => RestaurantSave.practice(stageOf('smallDiner'), 1, [burger(['pickles']), burger(['onion']), burger(['cheese', 'pickles', 'onion'])]) },
            { name: 'SEATED: CLEARING PLATES (3 stools, 4 customers)', go: () => RestaurantSave.practice(stageOf('smallDiner'), 0, dealDay(RestaurantSave.day, stageOf('smallDiner'), SETTINGS.stages[stageOf('smallDiner')].firstDay?.customers)) },
            { name: 'MIXED: BURGERS AND ICE CREAM', go: () => RestaurantSave.practice(stageOf('smallDiner'), 1, [burger(['cheese']), { toppings: [], iceCream: 'chocolate' }, burger(['pickles', 'tomato']), { toppings: [], iceCream: 'strawberry' }]) },
        ];
        const minigames = DebugOverlay.instance.panel('Minigames', { id: 'restaurant.minigames' });
        for (const { name, go } of games) {
            minigames.button(name, () => curtain(this, name.split(' (')[0], 'Minigame', 'ItemIcon_Meat', () => {
                go();
                this.showRestaurant();
            }));
        }
    }

    /** The restaurant, for the day the player's on; its day's card goes on to the pizza delivery (a day with the oven) or the supermarket. */
    private showRestaurant(): void {
        const key = `restaurant-${this.scenes++}`;
        this.sceneManager.register<RestaurantScene>(key, RestaurantScene, this, () => {
            if (RestaurantSave.place === 'delivery') curtain(this, 'PIZZA DELIVERY', 'Take the pizzas out', 'ItemIcon_Meat', () => this.showDelivery());
            else curtain(this, 'SUPERMARKET', 'Shop for tomorrow', 'ItemIcon_Shop', () => this.showMarket());
        });
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
    }

    /** The pizza delivery (drive the pizzas round the town); done, the supermarket. */
    private showDelivery(): void {
        const key = `delivery-${this.scenes++}`;
        this.sceneManager.register<DeliveryScene>(key, DeliveryScene, this, () => {
            RestaurantSave.openMarket();
            curtain(this, 'SUPERMARKET', 'Shop for tomorrow', 'ItemIcon_Shop', () => this.showMarket());
        });
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
    }

    /** The supermarket; done shopping, the next day opens. */
    private showMarket(): void {
        const key = `market-${this.scenes++}`;
        this.sceneManager.register<MarketScene>(key, MarketScene, this, () => {
            RestaurantSave.openRestaurant();
            curtain(this, `DAY ${RestaurantSave.day + 1}`, 'Open for business!', 'ItemIcon_Meat', () => this.showRestaurant());
        });
        this.sceneManager.changeScene(key);
        this.sceneManager.resize();
    }

    protected override update(delta: number): void {
        this.sceneManager?.update(delta);
    }

    protected override fixedUpdate(delta: number): void {
        this.sceneManager?.fixedUpdate(delta);
    }

    protected override onResize(): void {
        super.onResize();
        this.sceneManager?.resize();
    }
}

new RestaurantGame();
