import { AsyncGameStorage, LocalStorageGameStorage } from "./AsyncGameStorage";
import type { GameEconomyData } from "./GameEconomyStorage";
import type { LiftSaveState } from "./MiningDemoTypes";

export interface FarmSaveData {
    version: number;
    updatedAt: number;
    economy: GameEconomyData;
    laneProgressById: Record<string, number>;
    laneDepositById: Record<string, number>;
    boughtLanes: { resourceType: string }[];
    liftState: LiftSaveState | null;
    officeDropbox: GameEconomyData;
}

export class FarmSaveStorage {
    private static readonly STORAGE_KEY = "mining-demo:save";

    private readonly storage: AsyncGameStorage<FarmSaveData>;
    private writeChain: Promise<void> = Promise.resolve();
    private cachedData: FarmSaveData | undefined;
    private initializationPromise: Promise<void> | undefined;

    public constructor() {
        this.storage = new LocalStorageGameStorage<FarmSaveData>(FarmSaveStorage.STORAGE_KEY);
    }

    public async initialize(): Promise<void> {
        if (this.initializationPromise) {
            await this.initializationPromise;
            return;
        }

        this.initializationPromise = (async () => {
            await this.writeChain;

            const loaded = await this.storage.load();
            this.cachedData = normalizeSaveData(loaded);
        })();

        await this.initializationPromise;
    }

    public async load(): Promise<FarmSaveData> {
        await this.ensureInitialized();
        return cloneSaveData(this.cachedData!);
    }

    public async saveEconomy(economy: GameEconomyData): Promise<void> {
        await this.update((data) => {
            data.economy = {
                gold: economy.gold,
                iron: economy.iron,
                coal: economy.coal,
                crystal: economy.crystal,
            };
        });
    }

    public async saveLaneProgress(laneProgressById: Record<string, number>): Promise<void> {
        await this.update((data) => {
            data.laneProgressById = { ...laneProgressById };
        });
    }

    public async loadEconomy(): Promise<GameEconomyData> {
        const data = await this.load();
        return {
            gold: data.economy.gold,
            iron: data.economy.iron,
            coal: data.economy.coal,
            crystal: data.economy.crystal,
        };
    }

    public async saveOfficeDropbox(dropbox: GameEconomyData): Promise<void> {
        await this.update((data) => {
            data.officeDropbox = {
                gold: dropbox.gold,
                iron: dropbox.iron,
                coal: dropbox.coal,
                crystal: dropbox.crystal,
            };
        });
    }

    public async loadOfficeDropbox(): Promise<GameEconomyData> {
        const data = await this.load();
        return {
            gold: data.officeDropbox.gold,
            iron: data.officeDropbox.iron,
            coal: data.officeDropbox.coal,
            crystal: data.officeDropbox.crystal,
        };
    }

    public async loadLaneProgress(): Promise<Record<string, number>> {
        const data = await this.load();
        return { ...data.laneProgressById };
    }

    public async saveLaneDeposits(depositById: Record<string, number>): Promise<void> {
        await this.update((data) => {
            data.laneDepositById = { ...depositById };
        });
    }

    public async loadLaneDeposits(): Promise<Record<string, number>> {
        const data = await this.load();
        return { ...data.laneDepositById };
    }

    public async saveBoughtLanes(lanes: { resourceType: string }[]): Promise<void> {
        await this.update((data) => {
            data.boughtLanes = lanes.map(l => ({ resourceType: l.resourceType }));
        });
    }

    public async loadBoughtLanes(): Promise<{ resourceType: string }[]> {
        const data = await this.load();
        return [...data.boughtLanes];
    }

    public async saveLiftState(state: LiftSaveState | null): Promise<void> {
        await this.update((data) => {
            data.liftState = state;
        });
    }

    public async loadLiftState(): Promise<LiftSaveState | null> {
        const data = await this.load();
        return data.liftState;
    }

    private async update(mutator: (data: FarmSaveData) => void): Promise<void> {
        this.writeChain = this.writeChain.then(async () => {
            await this.ensureInitialized();

            const baseData = this.cachedData
                ? cloneSaveData(this.cachedData)
                : normalizeSaveData(await this.storage.load());

            mutator(baseData);

            baseData.updatedAt = Date.now();
            await this.storage.save(baseData);

            this.cachedData = baseData;
        });

        return this.writeChain;
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initializationPromise) {
            await this.initialize();
            return;
        }

        await this.initializationPromise;
    }
}

function normalizeSaveData(data: FarmSaveData | undefined): FarmSaveData {
    const defaultData = createDefaultSaveData();

    if (!data) {
        return defaultData;
    }

    const economy = data.economy ?? defaultData.economy;

    return {
        version: typeof data.version === "number" ? data.version : defaultData.version,
        updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
        economy: {
            gold: toFiniteNumber(economy.gold),
            iron: toFiniteNumber(economy.iron),
            coal: toFiniteNumber(economy.coal),
            crystal: toFiniteNumber(economy.crystal),
        },
        laneProgressById: sanitizeLaneProgress(data.laneProgressById),
        laneDepositById: sanitizeLaneProgress(data.laneDepositById),
        boughtLanes: sanitizeBoughtLanes(data.boughtLanes),
        liftState: sanitizeLiftState(data.liftState),
        officeDropbox: sanitizeEconomyData((data as unknown as { officeDropbox: unknown }).officeDropbox),
    };
}

function sanitizeEconomyData(raw: unknown): GameEconomyData {
    if (!raw || typeof raw !== "object") {
        return { gold: 0, iron: 0, coal: 0, crystal: 0 };
    }
    const d = raw as Record<string, unknown>;
    return {
        gold: toFiniteNumber(d.gold),
        iron: toFiniteNumber(d.iron),
        coal: toFiniteNumber(d.coal),
        crystal: toFiniteNumber(d.crystal),
    };
}

function sanitizeBoughtLanes(boughtLanes: unknown): { resourceType: string }[] {
    if (!Array.isArray(boughtLanes)) {
        return [];
    }
    return (boughtLanes as unknown[])
        .filter((l): l is { resourceType: string } => !!l && typeof (l as Record<string, unknown>).resourceType === "string")
        .map(l => ({ resourceType: l.resourceType }));
}

function sanitizeLiftState(raw: unknown): LiftSaveState | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.state !== "string") {
        return null;
    }
    const c = (s.cargoByResource && typeof s.cargoByResource === "object")
        ? s.cargoByResource as Record<string, unknown>
        : {};
    return {
        state: s.state,
        currentLaneIndex: typeof s.currentLaneIndex === "number" ? s.currentLaneIndex : 0,
        lanesVisited: typeof s.lanesVisited === "number" ? s.lanesVisited : 0,
        cargoByResource: {
            gold: toFiniteNumber(c.gold),
            iron: toFiniteNumber(c.iron),
            coal: toFiniteNumber(c.coal),
            crystal: toFiniteNumber(c.crystal),
        },
    };
}

function sanitizeLaneProgress(
    laneProgressById: Record<string, number> | undefined
): Record<string, number> {
    if (!laneProgressById) {
        return {};
    }

    const result: Record<string, number> = {};

    for (const [laneId, totalMined] of Object.entries(laneProgressById)) {
        if (!laneId) {
            continue;
        }

        result[laneId] = Math.max(0, toFiniteNumber(totalMined));
    }

    return result;
}

function toFiniteNumber(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }

    return value;
}

function createDefaultSaveData(): FarmSaveData {
    return {
        version: 1,
        updatedAt: Date.now(),
        economy: {
            gold: 0,
            iron: 0,
            coal: 0,
            crystal: 0,
        },
        laneProgressById: {},
        laneDepositById: {},
        boughtLanes: [],
        liftState: null,
        officeDropbox: { gold: 0, iron: 0, coal: 0, crystal: 0 },
    };
}

function cloneSaveData(data: FarmSaveData): FarmSaveData {
    return {
        version: data.version,
        updatedAt: data.updatedAt,
        economy: {
            gold: data.economy.gold,
            iron: data.economy.iron,
            coal: data.economy.coal,
            crystal: data.economy.crystal,
        },
        laneProgressById: { ...data.laneProgressById },
        laneDepositById: { ...data.laneDepositById },
        boughtLanes: data.boughtLanes.map(l => ({ resourceType: l.resourceType })),
        liftState: data.liftState
            ? { ...data.liftState, cargoByResource: { ...data.liftState.cargoByResource } }
            : null,
        officeDropbox: { ...data.officeDropbox },
    };
}
