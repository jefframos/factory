import { DevGuiManager } from "../utils/DevGuiManager";
import { UpgradeTriggerSaveData } from "./UpdateTriggerSaveData";
import { UpgradeTrigger } from "./triggers/UpgradeTrigger";


const WORLD_STORAGE_KEY = 'dogeCafe_world';

export class WorldManager {
    private static _instance: WorldManager;
    public static get instance(): WorldManager {
        if (!WorldManager._instance) {
            WorldManager._instance = new WorldManager();
        }
        return WorldManager._instance;
    }

    private triggers: Map<string, UpgradeTrigger> = new Map();
    private savedData: Record<string, UpgradeTriggerSaveData> = {};
    private constructor() {
        this.savedData = this.load(); // preload saved data

        DevGuiManager.instance.addButton('Wipe WorldData', () => {
            this.wipe()
            window.location.reload();
        });
    }

    public registerTrigger(trigger: UpgradeTrigger): void {
        this.triggers.set(trigger.id, trigger);

        const data = this.savedData[trigger.id];
        if (data) {
            trigger.updateData(data);
        }
    }

    public getTriggerById(id: string): UpgradeTrigger | undefined {
        return this.triggers.get(id);
    }

    public save(): void {
        const saveData: Record<string, UpgradeTriggerSaveData> = {};
        for (const [id, trigger] of this.triggers) {
            saveData[id] = trigger.getSaveData();
        }
        localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(saveData));
    }

    public load(): Record<string, UpgradeTriggerSaveData> {
        const json = localStorage.getItem(WORLD_STORAGE_KEY);
        if (!json) return {};
        try {
            return JSON.parse(json);
        } catch (e) {
            console.warn('Failed to load world data:', e);
            return {};
        }
    }

    public wipe(): void {
        this.triggers.clear();
        localStorage.removeItem(WORLD_STORAGE_KEY);
    }
}
