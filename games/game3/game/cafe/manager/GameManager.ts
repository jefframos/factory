import { DevGuiManager } from '../utils/DevGuiManager';
import { Observable } from '../utils/Observable';
import { LevelCurrencyData, SoftCurrency } from './LevelCurrencyData';
import { PlayerAttribute, PlayerData } from './PlayerData';

const STORAGE_KEY = 'dogeCafe';

export class GameManager {
    private static _instance: GameManager;
    public static get instance(): GameManager {
        if (!GameManager._instance) {
            GameManager._instance = new GameManager();
            GameManager._instance.load();
        }
        return GameManager._instance;
    }

    private levelData: Record<string, LevelCurrencyData> = {};
    private playerData: PlayerData = new PlayerData();

    private constructor() {
        DevGuiManager.instance.addButton('Add 100 Coins', () => {
            const level = this.getLevelData();
            level.soft.coins.update(100)
            console.log('Added 100 coins:', level.soft[SoftCurrency.COINS].value);
        });

        DevGuiManager.instance.addButton('Remove 100 Coins', () => {
            const level = this.getLevelData();
            level.soft.coins.update(-100)
            console.log('Added 100 coins:', level.soft[SoftCurrency.COINS].value);
        });

        DevGuiManager.instance.addButton('Wipe GameData', () => {
            this.wipe()
        });

        DevGuiManager.instance.addButton('Increase Speed', () => {
            this.updateAttribute(PlayerAttribute.SPEED, 0.5);
            this.logAttributes()
        });

    }
    public updateAttribute(attr: PlayerAttribute, delta: number): void {
        const observable = this.playerData.attributes[attr];
        if (observable) {
            observable.update(delta);
        }
    }
    public logAttributes(): void {
        console.log('%cPlayer Attributes:', 'color: cyan; font-weight: bold;');

        for (const [key, observable] of Object.entries(this.playerData.attributes)) {
            console.log(`%c${key}: %c${observable.value}`, 'color: orange;', 'color: white;');
        }
    }
    public getLevelData(levelId: string = 'default'): LevelCurrencyData {
        if (!this.levelData[levelId]) {
            const level = new LevelCurrencyData();
            Object.values(level.soft).forEach(c => this.bindAutoSave(c));
            Object.values(level.hard).forEach(c => this.bindAutoSave(c));
            Object.values(level.special).forEach(c => this.bindAutoSave(c));
            this.levelData[levelId] = level;
        }
        return this.levelData[levelId];
    }
    private bindAutoSave(currency: Observable): void {
        currency.onChange.add(() => this.save());
    }
    public save(): void {
        const rawData: Record<string, any> = {
            levels: {},
            player: this.playerData.toJSON(),
        };
        for (const [levelId, data] of Object.entries(this.levelData)) {
            rawData.levels[levelId] = data.toJSON();
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rawData));
    }


    public load(): void {
        const json = localStorage.getItem(STORAGE_KEY);
        if (!json) {
            // Fallback: ensure player data and default level exist
            this.playerData = new PlayerData();
            Object.values(this.playerData.attributes).forEach(attr => this.bindAutoSave(attr));
            this.getLevelData('default');
            return;
        }

        try {
            const rawData = JSON.parse(json);

            // Load player data, or create empty if missing
            this.playerData = PlayerData.fromJSON(rawData.player ?? {});
            Object.values(this.playerData.attributes).forEach(attr => this.bindAutoSave(attr));

            // Load level data
            const levels = rawData.levels ?? {};
            for (const [levelId, data] of Object.entries(levels)) {
                const level = LevelCurrencyData.fromJSON(data);
                Object.values(level.soft).forEach(c => this.bindAutoSave(c));
                Object.values(level.hard).forEach(c => this.bindAutoSave(c));
                Object.values(level.special).forEach(c => this.bindAutoSave(c));
                this.levelData[levelId] = level;
            }

            // Ensure default level exists if not found in storage
            this.getLevelData('default');
        } catch (err) {
            console.warn('Failed to parse saved data:', err);

            // Fallback in case of corrupted or invalid JSON
            this.playerData = new PlayerData();
            Object.values(this.playerData.attributes).forEach(attr => this.bindAutoSave(attr));
            this.getLevelData('default');
        }
    }


    public wipe(): void {
        this.dispose();
        localStorage.removeItem(STORAGE_KEY);
    }

    public dispose(): void {
        Object.values(this.levelData).forEach(d => d.dispose());
        Object.values(this.playerData.attributes).forEach(a => a.dispose());
        this.levelData = {};
    }

}
