import { Signal } from "signals";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import GameStorage, { IMissionState, IMissionsSaveData, ProgressionType } from "../storage/GameStorage";
import { MissionFactory, MissionFactoryConfig } from "./MissionFactory";
import { MISSION_TEMPLATES } from "./MissionRegistry";
import { MissionStats } from "./MissionStats";
import { MissionDefinition } from "./MissionTypes";

export class MissionManager {
    private static _instance: MissionManager;
    public static get instance(): MissionManager {
        return this._instance || (this._instance = new MissionManager());
    }

    // UI Signals
    public readonly onActiveMissionChanged: Signal = new Signal();
    public readonly onActiveMissionProgress: Signal = new Signal();
    public readonly onNextMissionTimerChanged: Signal = new Signal();

    private _defsById: Map<string, MissionDefinition> = new Map();
    private _save: IMissionsSaveData;
    private factory!: MissionFactory;

    private constructor() {
        const state = GameStorage.instance.getFullState();
        // Initialize with default if null
        this._save = state.missions || { activeMissionId: null, states: {} };
    }

    /**
     * Rebuilds active mission from code templates to ensure icons/titles are current.
     */
    public initDynamic(factoryCfg: MissionFactoryConfig): void {
        this.factory = new MissionFactory(factoryCfg);

        // Standardize save structure
        this._save.counters ??= {};
        this._save.tierCounters ??= {};
        this._save.tierCycleIndex ??= 0;

        // RE-HYDRATE: Use saved TemplateID and K to rebuild the definition
        if (this._save.activeMissionId && this._save.activeTemplateId) {
            const tid = this._save.activeTemplateId;
            const k = this._save.activeK ?? 0;
            const template = MISSION_TEMPLATES.find(t => t.templateId === tid);

            if (template) {
                const freshDef = template.build(this.factory.getContext(), k);
                this._defsById.set(freshDef.id, freshDef);
                this._save.activeDef = freshDef;
            } else {
                // If template no longer exists in code, clear active mission
                this._save.activeMissionId = null;
            }
        }

        // If no mission and no timer, try to pick one immediately
        if (!this._save.activeMissionId && (this._save.nextMissionAtMs || 0) <= Date.now()) {
            this.tryPickMissionNow();
        }

        this.refreshActiveMission(true);
    }

    /**
     * Called every frame to handle the cooldown timer.
     */
    public update(dtSec: number): void {
        const nextAt = this._save.nextMissionAtMs || 0;

        if (!this._save.activeMissionId && nextAt > 0) {
            const remMs = nextAt - Date.now();
            const remSec = Math.max(0, Math.ceil(remMs / 1000));
            this.onNextMissionTimerChanged.dispatch(remSec);

            if (remMs <= 0) {
                this._save.nextMissionAtMs = 0;
                this.sync();
                this.tryPickMissionNow();
            }
        }
    }

    private tryPickMissionNow(): void {
        if (this._save.activeMissionId) return;

        const result = this.factory.createNextMission({
            counters: this._save.counters || {},
            tierCounters: this._save.tierCounters || {},
            tierCycleIndex: this._save.tierCycleIndex || 0
        });

        const def = result.def;

        // Save the reference pointers
        this._save.activeMissionId = def.id;
        this._save.activeTemplateId = def.templateId;
        this._save.activeK = def.k;
        this._save.activeDef = def;
        this._save.tierCycleIndex = result.tierCycleIndexNext;

        this._defsById.set(def.id, def);
        this.ensureStateExists(def.id);

        const st = this._save.states[def.id];
        st.startValue = this.getRawProgressValue(def);

        this.sync();
        this.refreshActiveMission(true);
        this.onNextMissionTimerChanged.dispatch(0);
    }

    // ----- Reporting API (Gameplay Hooks) -----

    public reportCreatureTapped(amount: number = 1): void {
        MissionStats.instance.incCreatureTap(amount);
        this.refreshActiveMission(false);
    }

    public reportMergeDone(amount: number = 1): void {
        MissionStats.instance.incMerge(amount);
        this.refreshActiveMission(false);
    }

    public reportCurrencyEarned(type: CurrencyType, amount: number): void {
        MissionStats.instance.addLifetimeEarned(type, amount);
        this.refreshActiveMission(false);
    }

    public reportEggHatched(amount: number = 1): void {
        MissionStats.instance.incEggHatched(amount);
        this.refreshActiveMission(false);
    }

    // ----- Claiming -----

    public claimActive(): boolean {
        const def = this.activeMissionDef;
        const st = this.activeMissionState;
        if (!def || !st || !st.completed || st.claimed) return false;

        // Grant rewards
        if (def.reward.currencies) {
            for (const [type, amt] of Object.entries(def.reward.currencies)) {
                if (amt && amt > 0) {
                    InGameEconomy.instance.add(type as CurrencyType, amt);
                }
            }
        }

        st.claimed = true;
        st.claimedAt = Date.now();

        // Clear references
        this._save.activeMissionId = null;
        this._save.activeTemplateId = undefined;
        this._save.activeK = undefined;
        this._save.activeDef = null;

        // Cooldown
        const delaySec = this.factory.nextDelaySec;
        this._save.nextMissionAtMs = delaySec <= 0 ? 0 : (Date.now() + delaySec * 1000);

        this.sync();
        this.onActiveMissionChanged.dispatch(null, null);

        if (this._save.nextMissionAtMs === 0) {
            this.tryPickMissionNow();
        } else {
            this.onNextMissionTimerChanged.dispatch(delaySec);
        }

        return true;
    }

    // ----- Calculations -----

    private getRawProgressValue(def: MissionDefinition): number {
        const stats = MissionStats.instance.snapshot;
        switch (def.type) {
            case "tap_creature": return stats.tapsOnCreatures;
            case "merge_creatures": return stats.mergesDone;
            case "hatch_eggs": return stats.eggsHatched;
            case "collect_currency": return def.currencyType ? (stats.lifetimeEarned[def.currencyType] || 0) : 0;
            case "reach_player_level": return InGameProgress.instance.getProgression(ProgressionType.MAIN).level;
            case "reach_creature_level": return InGameProgress.instance.getProgression(ProgressionType.MAIN).highestMergeLevel;
            default: return 0;
        }
    }

    private computeMissionProgress(def: MissionDefinition, st: IMissionState): number {
        const raw = this.getRawProgressValue(def);
        if (def.type === "reach_player_level" || def.type === "reach_creature_level") {
            return raw;
        }
        return Math.max(0, raw - (st.startValue || 0));
    }

    private refreshActiveMission(forceChangedEvent: boolean): void {
        const def = this.activeMissionDef;
        const st = this.activeMissionState;

        if (!def || !st) {
            this.onActiveMissionChanged.dispatch(null, null);
            return;
        }

        const value = this.computeMissionProgress(def, st);
        st.progress = Math.max(st.progress, value);

        if (!st.completed && st.progress >= def.target) {
            st.completed = true;
            st.completedAt = Date.now();
        }

        this.sync();

        if (forceChangedEvent) {
            this.onActiveMissionChanged.dispatch(def, st);
        }
        this.onActiveMissionProgress.dispatch(st.progress, def.target, st.completed);
    }

    // ----- Getters & Helpers -----

    public get activeMissionDef(): MissionDefinition | null {
        if (!this._save.activeMissionId) return null;
        return this._defsById.get(this._save.activeMissionId) || null;
    }

    public get activeMissionState(): IMissionState | null {
        if (!this._save.activeMissionId) return null;
        return this._save.states[this._save.activeMissionId] || null;
    }

    private ensureStateExists(id: string): void {
        if (!this._save.states[id]) {
            this._save.states[id] = { id, progress: 0, completed: false, claimed: false };
        }
    }

    private sync(): void {
        GameStorage.instance.updateState({ missions: this._save });
    }
}