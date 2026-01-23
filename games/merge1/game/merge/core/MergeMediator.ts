import Pool from "@core/Pool";
import * as PIXI from "pixi.js";
import { DevGuiManager } from "../../utils/DevGuiManager";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import { StaticData } from "../data/StaticData";
import { Coin } from "../entity/Coin";
import { EggGenerator } from "../entity/EggGenerator";
import { EntityGridView } from "../entity/EntityGridView";
import { EntityState, MergeAnimal } from "../entity/MergeAnimal";
import { MergeEgg } from "../entity/MergeEgg";
import { InputManager } from "../input/InputManager";
import GameStorage, { ProgressionType } from "../storage/GameStorage";
import MergeHUD from "../ui/MergeHUD";
import { CoinEffectLayer } from "../vfx/CoinEffectLayer";
import { CoinGenerator } from "./CoinGenerator";
import { GridBaker } from "./GridBaker";

export interface IEntityData {
    id: string;
    type: "animal" | "egg";
    level: number;
    x: number;
    y: number;
    lastCoinTimestamp: number;
    pendingCoins: number;
}

export interface ICoinData {
    x: number;
    y: number;
    value: number;
    ownerId: string; // Linked to IEntityData.id
}

export class MergeMediator {
    private gridView: EntityGridView;
    private input: InputManager;
    private generator: EggGenerator;
    private baker: GridBaker;
    private coinLayer: PIXI.Container = new PIXI.Container();

    private activeEntity: MergeAnimal | MergeEgg | null = null;
    private entityMap: Map<PIXI.DisplayObject, { data: IEntityData, generator: CoinGenerator | null }> = new Map();
    private coins: Coin[] = [];

    public maxEntities: number = 12;
    private readonly MAX_COINS_PER_ENTITY: number = 3;
    private autoCollectCoins: boolean = true;
    private currentHighlightedEntity: MergeAnimal | null = null;

    constructor(
        private container: PIXI.Container,
        private inputBounds: PIXI.Rectangle,
        private walkBounds: PIXI.Rectangle,
        private coinEffects: CoinEffectLayer,
        private hud: MergeHUD
    ) {
        this.gridView = new EntityGridView();
        this.container.addChild(this.gridView);
        this.container.addChild(this.coinLayer);

        console.log('PIXI.Assets', PIXI.Assets)
        StaticData.parseData(PIXI.Assets.get('data/animals.json'))

        DevGuiManager.instance.addButton('wipe', () => {
            GameStorage.instance.resetGameProgress(true);
        });

        this.baker = new GridBaker(this.walkBounds, 90);
        this.generator = new EggGenerator(() => this.spawnEgg());

        this.input = new InputManager(
            this.container,
            this.inputBounds,
            this.gridView,
            (ent) => this.handleGrab(ent),
            (pos) => this.handleMove(pos),
            (pos) => this.handleRelease(pos),
            (target) => this.handleHover(target) // New callback handler
        );

        this.hud.onSpeedUpRequested = () => this.generator.activateSpeedUp(50);

        InGameProgress.instance.onMaxEntitiesChanged.add(this.handleGridExpanded, this);
        this.maxEntities = InGameProgress.instance.getMaxGridSlots();

        this.loadGameState();
    }
    private handleGridExpanded(newMax: number): void {
        this.maxEntities = newMax;

        // Trigger any "Juice" or VFX here
        console.log("BOOM! New slot unlocked. Total:", newMax);

        // Update the HUD counter immediately
        this.hud.updateEntityCount(this.entityMap.size, this.maxEntities);

        // Optional: Play a sound or show a popup
        // SoundManager.play("unlock_slot");
    }
    // --- PERSISTENCE ---

    private saveGameState(): void {
        const entityList: IEntityData[] = [];
        this.entityMap.forEach(logic => {
            if (logic.generator) {
                const interval = logic.generator.interval;
                const progressMS = (interval - logic.generator.timer) * 1000;
                logic.data.lastCoinTimestamp = Date.now() - progressMS;
            }
            entityList.push(logic.data);
        });

        const coinList: ICoinData[] = this.coins.map(c => ({
            x: c.x,
            y: c.y,
            value: c.value,
            ownerId: (c as any).ownerId // Retrieve the linked ID
        }));

        GameStorage.instance.saveFullState({
            currencies: InGameEconomy.instance.currencies,
            entities: entityList,
            coinsOnGround: coinList,
            progressions: InGameProgress.instance.getProgressions()
        });
    }

    private loadGameState(): void {
        const savedData = GameStorage.instance.getFullState();
        if (!savedData) return;

        // Restore HUD

        // 1. Load Entities - Reset pendingCoins to 0 during load to avoid double counting
        if (savedData.entities) {
            savedData.entities.forEach(data => {
                data.pendingCoins = 0; // Fresh start for the counter
                if (data.type === "animal") {
                    this.spawnAnimal(data.level, new PIXI.Point(data.x, data.y), data);
                } else {
                    this.spawnEgg(data);
                }
            });
        }

        // 2. Load Coins - Link them back to their owners
        if (savedData.coinsOnGround) {
            savedData.coinsOnGround.forEach(c => {
                this.dropCoin(c.x, c.y, c.value, c.ownerId, true);

                // Re-increment the specific owner's counter
                this.entityMap.forEach(logic => {
                    if (logic.data.id === c.ownerId) {
                        logic.data.pendingCoins++;
                    }
                });
            });
        }
    }

    // --- SPAWNING ---

    public spawnAnimal(level: number, pos: PIXI.Point, existingData?: IEntityData): void {
        const animal = Pool.instance.getElement(MergeAnimal);

        // 1. Get the static configuration for this level
        const config = StaticData.getAnimalData(level);

        // 2. Initialize the view with sprite and animation from config
        animal.init(level, config.spriteId, config.animationId);
        animal.position.copyFrom(pos);
        this.gridView.addEntity(animal);

        const data = existingData || {
            id: Math.random().toString(36).substring(2, 9),
            type: "animal",
            level,
            x: pos.x,
            y: pos.y,
            lastCoinTimestamp: Date.now(),
            pendingCoins: 0
        };

        // 3. Create generator using the timer from StaticData
        this.entityMap.set(animal, {
            data,
            generator: new CoinGenerator(data.lastCoinTimestamp, config.spawnTimer)
        });

        this.saveGameState();
    }

    public spawnEgg(existingData?: IEntityData): void {
        if (this.entityMap.size >= this.maxEntities && !existingData) return;

        const egg = Pool.instance.getElement(MergeEgg);
        egg.init();

        const spawnPos = existingData ? new PIXI.Point(existingData.x, existingData.y) : this.baker.getNextPoint();
        egg.position.copyFrom(spawnPos);
        this.gridView.addEntity(egg);

        const data = existingData || {
            id: Math.random().toString(36).substring(2, 9),
            type: "egg",
            level: 1,
            x: spawnPos.x,
            y: spawnPos.y,
            lastCoinTimestamp: Date.now(),
            pendingCoins: 0
        };

        this.entityMap.set(egg, { data, generator: null });
        this.saveGameState();
    }

    private dropCoin(x: number, y: number, level: number, ownerId: string, isLoading: boolean = false): void {
        const coin = Pool.instance.getElement(Coin);
        (coin as any).ownerId = ownerId; // Link owner

        let ox = isLoading ? x : x;// + (Math.random() - 0.5) * 60;
        let oy = isLoading ? y : y;// + (Math.random() - 0.5) * 40;

        const padding = 20;
        ox = Math.max(this.walkBounds.left + padding, Math.min(ox, this.walkBounds.right - padding));
        oy = Math.max(this.walkBounds.top + padding, Math.min(oy, this.walkBounds.bottom - padding));

        coin.init(ox, oy, level);

        if (this.autoCollectCoins && !isLoading) {
            // If auto-collect is ON, don't even add the physical coin to the board.
            // Just trigger the "Pop and Fade" effect immediately.
            // this.coinEffects.popAndFade(ox, oy, coin.value, coin.coinSprite);

            // // Logic for auto-collect: skip ground save, increment money
            // InGameEconomy.instance.add(CurrencyType.MONEY, coin.value);

            this.collectCoin(coin, false);

            // Recycle immediately
            coin.reset();
            Pool.instance.returnElement(coin);
        } else {
            // Manual collect: Add to grid or layer for interaction
            this.gridView.addChild(coin);
            this.coins.push(coin);
            if (!isLoading) this.saveGameState();
        }
    }
    private handleRelease(globalPos: PIXI.Point): void {
        if (this.currentHighlightedEntity) {
            this.currentHighlightedEntity.setHighlight(false);
            this.currentHighlightedEntity = null;
        }
        if (!this.activeEntity) return;

        const checkPos = this.gridView.toGlobal(this.activeEntity.position);
        const target = this.gridView.getEntityAt(checkPos, this.activeEntity);

        if (this.activeEntity instanceof MergeAnimal && target instanceof MergeAnimal && target.level === this.activeEntity.level) {
            this.merge(this.activeEntity, target);
        } else if (this.activeEntity instanceof MergeAnimal) {
            this.activeEntity.state = EntityState.IDLE;
        }

        this.activeEntity = null;
        this.saveGameState();
    }

    // --- INTERACTION ---
    private handleHover(target: any | null): void {
        // 1. If we are hovering the SAME thing we already highlighted, do nothing
        if (target === this.currentHighlightedEntity) return;

        // 2. Clear old highlight
        if (this.currentHighlightedEntity) {
            this.currentHighlightedEntity.setHighlight(false);
            this.currentHighlightedEntity = null;
        }

        // 3. New highlight logic
        if (this.activeEntity && target && target !== this.activeEntity) {
            if (this.activeEntity instanceof MergeAnimal && target instanceof MergeAnimal) {
                if (this.activeEntity.level === target.level) {
                    this.currentHighlightedEntity = target;
                    target.setHighlight(true);
                }
            }
        }
    }
    private handleGrab(entity: any): void {
        if (entity instanceof MergeEgg) {
            this.hatchEgg(entity);
            return;
        }
        this.activeEntity = entity;
        if (this.activeEntity instanceof MergeAnimal) {
            this.activeEntity.state = EntityState.GRABBED;
        }
        this.gridView.addChild(this.activeEntity!);
    }

    private handleMove(globalPos: PIXI.Point): void {
        const localPos = this.gridView.toLocal(globalPos);

        if (this.activeEntity) {
            const clampedX = Math.max(this.walkBounds.left, Math.min(localPos.x, this.walkBounds.right));
            const clampedY = Math.max(this.walkBounds.top, Math.min(localPos.y, this.walkBounds.bottom));
            this.activeEntity.position.set(clampedX, clampedY);

            const logic = this.entityMap.get(this.activeEntity);
            if (logic) { logic.data.x = clampedX; logic.data.y = clampedY; }
        }

        if (!this.autoCollectCoins) {
            this.checkCoinSwipe(localPos);
        }
    }


    private collectCoin(targetCoin: Coin, autoCollect: boolean) {
        if (targetCoin.isCollected) return;
        targetCoin.isCollected = true;

        const startX = targetCoin.x - targetCoin.width / 2;
        const startY = targetCoin.y - targetCoin.height;
        const val = targetCoin.value;
        const ownerId = (targetCoin as any).ownerId;

        // 1. Calculate Target (HUD position)
        const hudGlobal = this.hud.getCoinTargetGlobalPos();
        const effectTarget = this.coinEffects.toLocal(hudGlobal);

        // 2. Trigger Fly Effect
        this.coinEffects.popAndFlyToTarget(
            startX,
            startY,
            effectTarget.x,
            effectTarget.y,
            targetCoin.coinSprite,
            val,
            () => {
                // This runs when the coin reaches the bag
                InGameEconomy.instance.add(CurrencyType.MONEY, val)
            }
        );

        // 3. Clean up the physical world entity
        const index = this.coins.indexOf(targetCoin);
        if (index > -1) this.coins.splice(index, 1);

        if (autoCollect) {
            return;
        }

        this.decrementPendingCoin(ownerId);
        this.recycleCoin(targetCoin);
        this.saveGameState();
    }
    private checkCoinSwipe(localPos: PIXI.Point): void {
        const radius = 60;
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const coin = this.coins[i];
            const dist = Math.hypot(coin.x - localPos.x, coin.y - localPos.y);

            if (dist < radius && !coin.isCollected) {
                // We don't need a callback here anymore, collectCoin handles the visual
                this.collectCoin(coin, false);
            }
        }
    }

    private decrementPendingCoin(ownerId: string) {
        this.entityMap.forEach((logic) => {
            if (logic.data.id === ownerId) {
                logic.data.pendingCoins = Math.max(0, logic.data.pendingCoins - 1);
            }
        });
    }


    // --- SYSTEMS ---

    private merge(source: MergeAnimal, target: MergeAnimal): void {
        const nextLevel = source.level + 1;
        const spawnPos = new PIXI.Point(target.x, target.y);

        InGameProgress.instance.reportMergeLevel(nextLevel, ProgressionType.MAIN);
        this.maxEntities = InGameProgress.instance.getMaxGridSlots();

        InGameProgress.instance.addXP(source.level + 1, ProgressionType.MAIN)

        this.recycleEntity(source);
        this.recycleEntity(target);
        this.spawnAnimal(nextLevel, spawnPos);

        this.hud.updateEntityCount(this.entityMap.size, this.maxEntities);
    }

    private hatchEgg(egg: MergeEgg): void {
        const pos = new PIXI.Point(egg.x, egg.y);
        this.recycleEntity(egg);
        this.spawnAnimal(1, pos);
    }

    private recycleEntity(view: any): void {
        this.entityMap.delete(view);
        this.gridView.removeEntity(view);
        if (view.reset) view.reset();
        Pool.instance.returnElement(view);
    }

    private recycleCoin(coin: Coin): void {
        if (coin.parent) coin.parent.removeChild(coin);
        coin.reset();
        Pool.instance.returnElement(coin);
    }

    public update(delta: number): void {
        const dtSeconds = delta;
        this.gridView.update(delta, this.walkBounds);
        this.generator.update(delta);

        this.entityMap.forEach((logic, view) => {
            if (logic.generator && logic.data.type === "animal") {
                // Get config to know the value and timer
                const config = StaticData.getAnimalData(logic.data.level);

                if (logic.data.pendingCoins < this.MAX_COINS_PER_ENTITY) {
                    if (logic.generator.update(dtSeconds)) {
                        logic.data.pendingCoins++;
                        // Use config.coinValue for the drop
                        this.dropCoin(view.x, view.y, config.coinValue, logic.data.id);
                    }
                }
            }
        });

        const currentCount = this.entityMap.size;
        this.hud.updateEntityCount(currentCount, this.maxEntities);
        this.hud.setGeneratorFullState(currentCount >= this.maxEntities);
        this.hud.updateProgress(currentCount >= this.maxEntities ? 1 : this.generator.ratio);

        this.gridView.children.sort((a, b) => (a === this.activeEntity ? 1 : b === this.activeEntity ? -1 : a.y - b.y));
    }
}