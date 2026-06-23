import { FarmSaveStorage } from "./FarmSaveStorage";

export class LaneProgressStorage {
    public constructor(private readonly farmSaveStorage: FarmSaveStorage) { }

    public async load(): Promise<Record<string, number>> {
        return this.farmSaveStorage.loadLaneProgress();
    }

    public async save(byLaneId: Record<string, number>): Promise<void> {
        await this.farmSaveStorage.saveLaneProgress(byLaneId);
    }

    public async loadDeposits(): Promise<Record<string, number>> {
        return this.farmSaveStorage.loadLaneDeposits();
    }

    public async saveDeposits(byLaneId: Record<string, number>): Promise<void> {
        await this.farmSaveStorage.saveLaneDeposits(byLaneId);
    }
}
