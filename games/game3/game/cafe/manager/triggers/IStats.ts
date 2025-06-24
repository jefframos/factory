import { UpgradeableAttributes } from "../upgrade/UpgradeManager";

export default interface IStats {
    setStats(stats: UpgradeableAttributes): void;
    rawStats: UpgradeableAttributes;
    getStats(): UpgradeableAttributes;
}