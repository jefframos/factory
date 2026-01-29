import Pool from "@core/Pool";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import { ICoinData } from "../data/MergeSaveTypes";
import { ProgressionStats } from "../data/ProgressionStats";
import { Coin } from "../entity/Coin";
import MergeAssets from "../MergeAssets";
import MergeHUD from "../ui/MergeHUD";
import { CoinEffectLayer } from "../vfx/CoinEffectLayer";

export interface ClearCoinsOptions {
    silent?: boolean;
}

export interface ImportCoinsOptions {
    silent?: boolean;
}

export class CoinManager {
    public readonly onCoinDropped: Signal = new Signal();
    public readonly onCoinCollected: Signal = new Signal();
    public readonly onDirty: Signal = new Signal();

    private readonly coins: Coin[] = [];

    public constructor(
        private readonly gridView: PIXI.Container,
        private readonly walkBounds: PIXI.Rectangle,
        private readonly coinEffects: CoinEffectLayer,
        private readonly hud: MergeHUD,
        private readonly decrementPendingCoin: (ownerId: string) => void,
        private readonly autoCollectCoinsGetter: () => boolean,
    ) { }

    public getCoinsOnGround(): ReadonlyArray<Coin> {
        return this.coins;
    }

    // -------------------------
    // Room support: export/import
    // -------------------------

    public exportCoins(): ICoinData[] {
        return this.serializeCoinsForSave();
    }

    public importCoins(list: ICoinData[], opts?: ImportCoinsOptions): void {
        const silent = opts?.silent === true;

        this.clearAll({ silent: true });

        if (!list || list.length <= 0) {
            if (!silent) {
                this.onDirty.dispatch();
            }
            return;
        }

        for (let i = 0; i < list.length; i++) {
            const c = list[i];
            this.dropCoin(
                c.x,
                c.y,
                c.value,
                c.ownerId,
                true, // isLoading
                c.currencyType
            );
        }

        if (!silent) {
            this.onDirty.dispatch();
        }
    }

    // -------------------------
    // Coin placement helpers
    // -------------------------

    /**
     * Picks a point inside walkBounds that tries to keep a minimum distance from existing coins.
     * This is primarily for "hidden room generation" / avoiding clustering.
     */
    private pickNonClusteringPoint(
        nearX: number,
        nearY: number,
        minDistPx: number,
        tries: number,
        padding: number
    ): PIXI.Point {
        const minD2 = minDistPx * minDistPx;

        const left = this.walkBounds.left + padding;
        const right = this.walkBounds.right - padding;
        const top = this.walkBounds.top + padding;
        const bottom = this.walkBounds.bottom - padding;

        const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(v, b));

        // Center the first attempt near the requested position, then spread out.
        for (let t = 0; t < tries; t++) {
            const radius = 40 + t * 6;
            const a = Math.random() * Math.PI * 2;

            const x = clamp(nearX + Math.cos(a) * radius + (Math.random() - 0.5) * 10, left, right);
            const y = clamp(nearY + Math.sin(a) * radius + (Math.random() - 0.5) * 10, top, bottom);

            let ok = true;
            for (let i = 0; i < this.coins.length; i++) {
                const c = this.coins[i];
                if (c.isCollected) {
                    continue;
                }
                const dx = c.x - x;
                const dy = c.y - y;
                if ((dx * dx + dy * dy) < minD2) {
                    ok = false;
                    break;
                }
            }

            if (ok) {
                return new PIXI.Point(x, y);
            }
        }

        // Fallback: random anywhere
        return new PIXI.Point(
            left + Math.random() * Math.max(1, right - left),
            top + Math.random() * Math.max(1, bottom - top)
        );
    }

    /**
     * Drop coin but place it in a less clustered position.
     * Use this when coins are generated while the room is hidden/offscreen.
     */
    public dropCoinNonClustering(
        nearX: number,
        nearY: number,
        value: number,
        ownerId: string,
        isLoading: boolean,
        savedType?: CurrencyType,
        minDistPx: number = 55,
        tries: number = 18
    ): Coin {
        const padding = 20;
        const p = this.pickNonClusteringPoint(nearX, nearY, minDistPx, tries, padding);
        return this.dropCoin(p.x, p.y, value, ownerId, isLoading, savedType);
    }

    // -------------------------
    // Main API
    // -------------------------

    public dropCoin(
        x: number,
        y: number,
        value: number,
        ownerId: string,
        isLoading: boolean,
        savedType?: CurrencyType
    ): Coin {
        const coin = Pool.instance.getElement(Coin);
        (coin as any).ownerId = ownerId;

        let type = savedType;
        if (type === undefined) {
            type = CurrencyType.MONEY;//Math.random() < 0.05 ? CurrencyType.GEMS : CurrencyType.MONEY;
        }

        coin.setCurrencySprite(type);
        (coin as any).currencyType = type;

        // Keep original scatter, but clamp into bounds.
        // (RoomManager can call dropCoinNonClustering if it wants stronger dispersion)
        let ox = x + (Math.random() - 0.5) * 30;
        let oy = y + (Math.random() - 0.5) * -30;

        const padding = 20;
        ox = Math.max(this.walkBounds.left + padding, Math.min(ox, this.walkBounds.right - padding));
        oy = Math.max(this.walkBounds.top + padding, Math.min(oy, this.walkBounds.bottom - padding));

        const initValue = type === CurrencyType.GEMS ? 1 : value;
        coin.init(ox, oy, initValue);

        if (this.autoCollectCoinsGetter()) {//} && !isLoading) {
            this.collectCoin(coin, true);
            this.recycleCoin(coin);
        } else {
            this.gridView.addChild(coin);
            this.coins.push(coin);
        }

        this.onCoinDropped.dispatch(coin, {
            x: coin.x,
            y: coin.y,
            value: coin.value,
            ownerId,
            currencyType: type
        } satisfies ICoinData);

        if (!isLoading) {
            this.onDirty.dispatch();
        }

        return coin;
    }

    public checkCoinSwipe(localPos: PIXI.Point): void {
        const radius = 60;

        for (let i = this.coins.length - 1; i >= 0; i--) {
            const coin = this.coins[i];
            if (coin.isCollected) {
                continue;
            }

            const dist = Math.hypot(coin.x - localPos.x, coin.y - localPos.y);
            if (dist < radius) {
                this.collectCoin(coin, false);
            }
        }
    }

    public collectCoin(coin: Coin, autoCollect: boolean): void {
        if (coin.isCollected) {
            return;
        }

        coin.isCollected = true;

        MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Coin);

        const type = (coin as any).currencyType as CurrencyType;
        const coinGlobalPos = this.gridView.toGlobal(new PIXI.Point(coin.x, coin.y));
        const effectStart = this.coinEffects.toLocal(coinGlobalPos);

        const hudGlobal = this.hud.getCurrencyTargetGlobalPos(type);
        const effectTarget = this.coinEffects.toLocal(hudGlobal);

        const val = coin.value;
        const ownerId = (coin as any).ownerId as string;


        this.coinEffects.popAndFade(effectStart.x,
            effectStart.y, val, coin.coinSprite)

        ProgressionStats.instance.recordCurrencyGained(type, val);
        InGameEconomy.instance.add(type, val);

        // this.coinEffects.popAndFlyToTarget(
        //     effectStart.x,
        //     effectStart.y,
        //     effectTarget.x,
        //     effectTarget.y,
        //     coin.coinSprite,
        //     val,
        //     () => {
        //         ProgressionStats.instance.recordCurrencyGained(type, val);
        //         InGameEconomy.instance.add(type, val);
        //     }
        // );

        const idx = this.coins.indexOf(coin);
        if (idx >= 0) {
            this.coins.splice(idx, 1);
        }

        if (!autoCollect) {
            this.decrementPendingCoin(ownerId);
        }

        this.recycleCoin(coin);

        this.onCoinCollected.dispatch(coin, {
            x: coin.x,
            y: coin.y,
            value: val,
            ownerId,
            currencyType: type
        } satisfies ICoinData);

        if (!autoCollect) {
            this.onDirty.dispatch();
        }
    }

    public serializeCoinsForSave(): ICoinData[] {
        return this.coins.map((c) => {
            return {
                x: c.x,
                y: c.y,
                value: c.value,
                ownerId: (c as any).ownerId,
                currencyType: (c as any).currencyType
            };
        });
    }

    public clearAll(opts?: ClearCoinsOptions): void {
        const silent = opts?.silent === true;

        for (let i = this.coins.length - 1; i >= 0; i--) {
            this.recycleCoin(this.coins[i]);
        }
        this.coins.length = 0;

        if (!silent) {
            this.onDirty.dispatch();
        }
    }

    private recycleCoin(coin: Coin): void {
        if (coin.parent) {
            coin.parent.removeChild(coin);
        }
        coin.reset();
        Pool.instance.returnElement(coin);
    }
}
