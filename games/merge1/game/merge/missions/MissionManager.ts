// missions/MissionManager.ts
import { Signal } from "signals";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import { ModifierManager, ModifierType } from "../modifiers/ModifierManager";
import GameStorage, { IMissionState, IMissionsSaveData, ProgressionType } from "../storage/GameStorage";
import { MissionFactory, MissionFactoryConfig } from "./MissionFactory";
import { MISSION_TEMPLATES } from "./MissionRegistry";
import { MissionStats } from "./MissionStats";
import { MissionDefinition } from "./MissionTypes";

export interface MissionClaimResult {
    success: boolean;

    missionId?: string;
    templateId?: string;

    rewards?: {
        currencies?: Partial<Record<CurrencyType, number>>;
        // later:
        // items?: ItemReward[];
        // xp?: number;
    };
}

export class MissionManager {
    private static _instance: MissionManager;

    public static get instance(): MissionManager {
        return this._instance || (this._instance = new MissionManager());
    }

    // UI Signals
    public readonly onActiveMissionChanged: Signal = new Signal();      // dispatch(def: MissionDefinition|null, st: IMissionState|null)
    public readonly onActiveMissionProgress: Signal = new Signal();     // dispatch(progress: number, target: number, completed: boolean)
    public readonly onNextMissionTimerChanged: Signal = new Signal();   // dispatch(remSec: number)

    private _defsById: Map<string, MissionDefinition> = new Map();
    private _save: IMissionsSaveData;
    private factory!: MissionFactory;

    private constructor() {
        const state = GameStorage.instance.getFullState();

        // IMPORTANT:
        // - Do NOT persist MissionDefinition (it can contain non-serializable data).
        // - Persist only pointers: activeMissionId + activeTemplateId + activeK.
        const s = state.missions || { activeMissionId: null, states: {} };

        // If an old save still has activeDef, strip it from memory immediately.
        delete (s as any).activeDef;

        this._save = s;

        //simulateRewards()
    }

    /**
     * Rebuilds active mission from code templates to ensure icons/titles are current.
     */
    public initDynamic(factoryCfg: MissionFactoryConfig): void {
        this.factory = new MissionFactory(factoryCfg);

        // Standardize save structure
        this._save.states ??= {};
        this._save.counters ??= {};
        this._save.tierCounters ??= {};
        this._save.tierCycleIndex ??= 0;

        // Ensure we never keep / re-save activeDef
        delete (this._save as any).activeDef;

        // RE-HYDRATE: Use saved TemplateID and K to rebuild the definition
        if (this._save.activeMissionId && this._save.activeTemplateId) {
            const tid = this._save.activeTemplateId;
            const k = this._save.activeK ?? 0;
            const template = MISSION_TEMPLATES.find(t => t.templateId === tid);

            if (template) {
                const freshDef = template.build(this.factory.getContext(), k);

                // If ID changed (shouldn't), heal pointers to match.
                this._save.activeMissionId = freshDef.id;

                this._defsById.set(freshDef.id, freshDef);
                this.ensureStateExists(freshDef.id);

                // Make sure baseline exists (older saves won’t have it)
                const st = this._save.states[freshDef.id];
                if (typeof st.startValue !== "number") {
                    st.startValue = this.getRawProgressValue(freshDef);
                }
            } else {
                // If template no longer exists in code, clear active mission
                this.clearActiveMissionPointers();
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

        // If nothing active and no cooldown, pick immediately
        if (!this._save.activeMissionId && nextAt === 0) {
            this.tryPickMissionNow();
            return;
        }

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

        // Save pointer refs (serializable only)
        this._save.activeMissionId = def.id;
        this._save.activeTemplateId = def.templateId;
        this._save.activeK = def.k;
        this._save.tierCycleIndex = result.tierCycleIndexNext;

        // Runtime cache
        this._defsById.set(def.id, def);

        // State + baseline
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

    public claimActive(): MissionClaimResult {
        const def = this.activeMissionDef;
        const st = this.activeMissionState;

        if (!def || !st || !st.completed || st.claimed) {
            return { success: false };
        }

        const claimedCurrencies: Partial<Record<CurrencyType, number>> = {};

        // Grant rewards
        if (def.reward.currencies) {
            const progress = InGameProgress.instance.getProgression('MAIN');
            const highestLvl = progress.highestMergeLevel;
            const playerLvl = progress.level;

            // Get the modifier bonus (e.g., 1.1 for a 10% boost)
            const missionBonus = ModifierManager.instance.getNormalizedValue(ModifierType.MissionRewards);

            for (const [type, percentage] of Object.entries(def.reward.currencies)) {
                if (percentage && percentage > 0) {
                    const currency = type as CurrencyType;
                    let amount = 0;

                    if (currency === CurrencyType.MONEY) {
                        // 1. Scale based on the shop price of the player's best piece
                        // Using your ShopManager formula: 500 * 2.5^(lvl-1)
                        const index = Math.max(0, highestLvl - 1);
                        const referencePrice = index === 0 ? 50 : 500 * Math.pow(2.5, index);

                        amount = referencePrice * percentage;
                        amount = Math.max(amount, 100); // Minimum 100 coins

                    } else if (currency === CurrencyType.GEMS) {
                        // 2. Scale gems linearly based on player level (3 to 50 range)
                        // Base pot grows as player levels up
                        const gemPot = 20 + (playerLvl * 5);
                        amount = gemPot * percentage;

                        // Clamp between 3 and 50 as per your requirements
                        amount = Math.max(3, Math.min(amount, 50));
                    }

                    // 3. Apply the "Bounty Hunter" modifier bonus
                    amount *= missionBonus;

                    // 4. Finalize
                    const finalAmount = Math.floor(amount);
                    InGameEconomy.instance.add(currency, finalAmount);
                    claimedCurrencies[currency] = finalAmount;
                }
            }
        }

        st.claimed = true;
        st.claimedAt = Date.now();

        // Clear active mission refs (serializable only)
        this.clearActiveMissionPointers();

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

        return {
            success: true,
            missionId: def.id,
            templateId: def.templateId,
            rewards: {
                currencies: Object.keys(claimedCurrencies).length ? claimedCurrencies : undefined
            }
        };
    }

    // ----- Calculations -----

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
                return def.currencyType ? (stats.lifetimeEarned[def.currencyType] || 0) : 0;

            case "reach_player_level":
                return InGameProgress.instance.getProgression(ProgressionType.MAIN).level;

            case "reach_creature_level":
                return InGameProgress.instance.getProgression(ProgressionType.MAIN).highestMergeLevel;

            default:
                return 0;
        }
    }

    private computeMissionProgress(def: MissionDefinition, st: IMissionState): number {
        const raw = this.getRawProgressValue(def);

        // “Reach” missions are absolute, not delta-from-start.
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
        const id = this._save.activeMissionId;
        if (!id) return null;

        const def = this._defsById.get(id) || null;

        // HEAL: pointer exists but runtime def is missing (e.g. missing template / init order)
        if (!def) {
            this.clearActiveMissionPointers();
            this.sync();
            return null;
        }

        return def;
    }

    public get activeMissionState(): IMissionState | null {
        if (!this._save.activeMissionId) return null;
        return this._save.states[this._save.activeMissionId] || null;
    }

    private ensureStateExists(id: string): void {
        if (!this._save.states[id]) {
            this._save.states[id] = {
                id,
                progress: 0,
                completed: false,
                claimed: false
            };
        }
    }

    private clearActiveMissionPointers(): void {
        this._save.activeMissionId = null;
        this._save.activeTemplateId = undefined;
        this._save.activeK = undefined;

        // Never persist definitions
        delete (this._save as any).activeDef;
    }

    /**
     * Persist missions safely (never save MissionDefinition).
     */
    private sync(): void {
        // Strip any legacy field that could break JSON.stringify
        delete (this._save as any).activeDef;

        GameStorage.instance.updateState({ missions: this._save });
    }
}
