// DepositReservations.ts
//
// One shared ledger of what's currently FLYING out of the player's backpack/wallet toward
// something being paid for — every depositor (StoragePurchaseZone, BuildingZone, FarmZone)
// reserves a unit when its icon departs and releases it when the icon lands (where the backpack
// /wallet is actually charged). Each depositor used to subtract only its OWN in-flight units, so
// standing in two pay spots at once (e.g. two lined-up storages both costing wood) let both
// launch icons for the same logs — one landed with nothing left to take.

const reserved = new Map<string, number>();

export const DepositReservations = {
    /** Key for a backpack resource. */
    resourceKey(type: string): string {
        return `resource:${type}`;
    },

    /** Key for a wallet currency. */
    currencyKey(currency: string): string {
        return `currency:${currency}`;
    },

    /** Units of `key` already on their way somewhere. */
    get(key: string): number {
        return reserved.get(key) ?? 0;
    },

    /** True while `have` (what the backpack/wallet holds) covers one more unit after everything already flying. */
    canReserve(key: string, have: number): boolean {
        return have - (reserved.get(key) ?? 0) > 0;
    },

    reserve(key: string): void {
        reserved.set(key, (reserved.get(key) ?? 0) + 1);
    },

    release(key: string): void {
        reserved.set(key, Math.max(0, (reserved.get(key) ?? 0) - 1));
    },
};
