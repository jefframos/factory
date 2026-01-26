// missions/MissionManager.ts
import { Signal } from "signals";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import GameStorage, { IMissionState, IMissionsSaveData, ProgressionType } from "../storage/GameStorage";
import { MissionFactory, MissionFactoryConfig } from "./MissionFactory";
import { MissionStats } from "./MissionStats";
import { MissionDefinition } from "./MissionTypes";

function createDefaultSave(): IMissionsSaveData {
    return {
        activeMissionId: null,
        states: {}
    };
}

export class MissionManager {
    private static _instance: MissionManager;

    public static get instance(): MissionManager {
        return this._instance || (this._instance = new MissionManager());
    }

    // UI can subscribe to these:
    public readonly onActiveMissionChanged: Signal = new Signal(); // dispatch(def: MissionDefinition | null, state: IMissionState | null)
    public readonly onActiveMissionProgress: Signal = new Signal(); // dispatch(progress: number, target: number, completed: boolean)

    private _defs: MissionDefinition[] = [];
    private _defsById: Map<string, MissionDefinition> = new Map();

    private _save: IMissionsSaveData;

    private constructor() {
        const state = GameStorage.instance.getFullState();
        this._save = state.missions ? state.missions : createDefaultSave();

        // Keep storage consistent:
        this.sync();
    }
    public readonly onNextMissionTimerChanged: Signal = new Signal(); // dispatch(remainingSec: number)

    private factory!: MissionFactory;


    public initDynamic(factoryCfg: MissionFactoryConfig): void {
        this.factory = new MissionFactory(factoryCfg);

        this._save.counters ??= {};
        this._save.nextMissionAtMs ??= 0;
        this._save.activeDef ??= null;
        this._save.tierCycleIndex ??= 0;
        this._save.tierCounters ??= {};

        // REHYDRATE def map from save (this is the missing part)
        this._defsById.clear();
        if (this._save.activeMissionId && this._save.activeDef && this._save.activeDef.id === this._save.activeMissionId) {
            this._defsById.set(this._save.activeDef.id, this._save.activeDef);
        }

        // If no active mission, pick now or wait for timer
        if (!this._save.activeMissionId) {
            if ((this._save.nextMissionAtMs || 0) === 0) {
                this.tryPickMissionNow();
            } else {
                // show countdown on UI right away
                const remSec = Math.max(0, Math.ceil(((this._save.nextMissionAtMs || 0) - Date.now()) / 1000));
                this.onNextMissionTimerChanged.dispatch(remSec);
                this.onActiveMissionChanged.dispatch(null, null);
            }
        } else {
            // Ensure state exists and baseline exists
            this.ensureStateExists(this._save.activeMissionId);

            const st = this._save.states[this._save.activeMissionId];
            const def = this.activeMissionDef;

            // If mission exists but def is missing (older saves), just pick a new one safely
            if (!def) {
                this._save.activeMissionId = null;
                this._save.activeDef = null;
                this._save.nextMissionAtMs = 0;
                this.sync();
                this.tryPickMissionNow();
                return;
            }

            // If baseline missing, capture now (important for older saves)
            if (st.startValue === undefined) {
                this.captureBaselineForActive(def, st);
                this.sync();
            }

            this.refreshActiveMission(true);
        }
    }


    public update(dtSec: number): void {
        const now = Date.now();
        const nextAt = this._save.nextMissionAtMs || 0;

        if (!this._save.activeMissionId && nextAt > 0) {
            const remMs = nextAt - now;
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

        const counters = (this._save.counters ??= {});
        const tierCounters = (this._save.tierCounters ??= {});
        const tierCycleIndex = (this._save.tierCycleIndex ??= 0);

        const result = this.factory.createNextMission({
            counters,
            tierCounters,
            tierCycleIndex
        });

        const def = result.def;

        // persist updated cycle index + counters
        this._save.tierCycleIndex = result.tierCycleIndexNext;
        this._save.counters = counters;
        this._save.tierCounters = tierCounters;

        this._defsById.clear();
        this._defsById.set(def.id, def);

        this._save.activeMissionId = def.id;
        this._save.activeDef = def;

        this.ensureStateExists(def.id);
        this.captureBaselineForActive(def, this._save.states[def.id]);

        this.sync();

        this.refreshActiveMission(true);
        this.onNextMissionTimerChanged.dispatch(0);
    }


    private captureBaselineForActive(def: MissionDefinition, st: IMissionState): void {
        // Reset mission-visible state
        st.progress = 0;
        st.completed = false;
        st.claimed = false;
        delete st.completedAt;
        delete st.claimedAt;

        // Capture the relevant baseline
        st.startValue = this.getRawProgressValue(def);
    }
    private getRawProgressValue(def: MissionDefinition): number {
        const stats = MissionStats.instance.snapshot;

        switch (def.type) {
            case "tap_creature":
                return stats.tapsOnCreatures;

            case "merge_creatures":
                return stats.mergesDone;

            case "hatch_eggs":
                return stats.eggsHatched;

            case "collect_currency":
                if (!def.currencyType) return 0;
                return stats.lifetimeEarned[def.currencyType] || 0;

            // These two are “absolute”, not baseline-relative:
            case "reach_player_level":
                return InGameProgress.instance.getProgression(ProgressionType.MAIN).level;

            case "reach_creature_level":
                return InGameProgress.instance.getProgression(ProgressionType.MAIN).highestMergeLevel;
        }
    }

    private computeMissionProgress(def: MissionDefinition, st: IMissionState): number {
        const raw = this.getRawProgressValue(def);

        // Absolute missions ignore baseline.
        if (def.type === "reach_player_level" || def.type === "reach_creature_level") {
            return raw;
        }

        const baseline = st.startValue || 0;
        return Math.max(0, raw - baseline);
    }

    /**
     * Call once during boot, after your assets are ready (so texture ids exist).
     */
    public init(defs: MissionDefinition[]): void {
        this._defs = defs.slice().sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            return a.id.localeCompare(b.id);
        });

        this._defsById.clear();
        for (const d of this._defs) {
            this._defsById.set(d.id, d);
        }

        if (!this._save.activeMissionId) {
            const first = this._defs[0] || null;
            this._save.activeMissionId = first ? first.id : null;
            this.ensureStateExists(this._save.activeMissionId);
            this.sync();
        }

        this.refreshActiveMission(true);

        // Optional: listen to progress level-ups automatically
        InGameProgress.instance.onLevelUp.add(() => {
            this.refreshActiveMission(false);
        });

        // Optional: if your progress “highest merge level” changes, you can refresh too,
        // but you already have direct “reportMerge” hooks below.
    }

    public get activeMissionDef(): MissionDefinition | null {
        if (!this._save.activeMissionId) return null;
        return this._defsById.get(this._save.activeMissionId) || null;
    }

    public get activeMissionState(): IMissionState | null {
        if (!this._save.activeMissionId) return null;
        return this._save.states[this._save.activeMissionId] || null;
    }

    // ----- Reporting API (call these from gameplay) -----

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

    // ----- Claim / advance -----

    public claimActive(): boolean {
        const def = this.activeMissionDef;
        const st = this.activeMissionState;
        if (!def || !st) return false;
        if (!st.completed || st.claimed) return false;

        // Grant reward:
        if (def.reward.currencies) {
            for (const [k, v] of Object.entries(def.reward.currencies)) {
                const amt = v || 0;
                if (amt > 0) {
                    InGameEconomy.instance.add(k as CurrencyType, amt);
                }
            }
        }

        st.claimed = true;
        st.claimedAt = Date.now();

        // Clear active mission and schedule next
        this._save.activeMissionId = null;
        this._save.activeDef = null;

        const delaySec = this.factory ? this.factory.nextDelaySec : 0;
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



    public reportEggHatched(amount: number = 1): void {
        MissionStats.instance.incEggHatched(amount);
        this.refreshActiveMission(false);
    }

    private refreshActiveMission(forceChangedEvent: boolean): void {
        const def = this.activeMissionDef;
        const st = this.activeMissionState;

        if (!def || !st) {
            this.onActiveMissionChanged.dispatch(null, null);
            return;
        }


        const prevCompleted = st.completed;
        const prevProgress = st.progress;

        const value = this.computeMissionProgress(def, st);
        st.progress = Math.max(st.progress, value);

        if (!st.completed && st.progress >= def.target) {
            st.completed = true;
            st.completedAt = Date.now();
        }


        if (st.progress !== prevProgress || st.completed !== prevCompleted) {
            this.sync();
        }

        if (forceChangedEvent) {
            this.onActiveMissionChanged.dispatch(def, st);
        }

        this.onActiveMissionProgress.dispatch(st.progress, def.target, st.completed);
    }

    private ensureStateExists(missionId: string | null): void {
        if (!missionId) return;
        if (!this._save.states[missionId]) {
            this._save.states[missionId] = {
                id: missionId,
                progress: 0,
                completed: false,
                claimed: false
            };
        }
    }

    private sync(): void {
        GameStorage.instance.updateState({
            missions: this._save
        });
    }
}
