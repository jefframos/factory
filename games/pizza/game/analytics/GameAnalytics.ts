// GameAnalytics.ts
//
// Every analytics event the pizza game sends — one place, so names stay consistent and stable
// across versions. Goes through PlatformHandler.measure() (Poki: PokiSDK.measure(); see
// https://developers.poki.com/guide/game-events), which cleans the values and never throws.
//
//   category     what                          action        when
//   tutorial     zone<N>                       start         a zone tutorial's first step begins
//   tutorial     zone<N>                       complete      its last step is done
//   tutorial     zone<N>-<index>-<kind>        start         a step becomes the current one
//   tutorial     zone<N>-<index>-<kind>        complete      that step is done
//   level        <storeId>-<level>             start         the store can work toward that level
//   level        <storeId>-<level>             complete      the store reaches it (Lv 1 = it opens)
//   client       <mood>                        paid          a client pays at the cashier
//   client       <reason>                      left          a client walks out without paying
//                                                            (out-of-patience / angry-dumped /
//                                                            angry / nothing-to-buy)
//   build        <buildingId>-<level>          built         a building / store room levels up
//   storage      <storageId>                   bought        a storage is bought
//   farm         <farmId>                      bought        a farm plot is bought
//   upgrade      <tool>-<level>                bought        a shop sells a tool upgrade
//   button       hire-desk                     visible       the staff popup opens
//   button       hire-desk                     interact      hire / upgrade pressed (and paid)
//   worker       <role>                        hired         a worker is hired
//   worker       <role>-<level>                upgraded      a worker is upgraded
//   gather       <providerType>                <actionType>  the player finishes a node (e.g.
//                                                            gather / tree / chop = a tree chopped)
//   harvest      <cropId>                      collect       the player collects a crop
//   demo         end                           complete      the end-of-demo popup shows
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';

/** Why a client walked out without paying — see StoreClient.ts. */
export type ClientLeaveReason = 'out-of-patience' | 'angry-dumped' | 'angry' | 'nothing-to-buy';

function send(category: string, what: string | number, action: string): void {
    PlatformHandler.instance.measure(category, what, action);
}

export const GameAnalytics = {
    tutorialStart(zoneNumber: number): void {
        send('tutorial', `zone${zoneNumber}`, 'start');
    },
    tutorialComplete(zoneNumber: number): void {
        send('tutorial', `zone${zoneNumber}`, 'complete');
    },
    tutorialStepStart(zoneNumber: number, index: number, kind: string): void {
        send('tutorial', `zone${zoneNumber}-${index}-${kind}`, 'start');
    },
    tutorialStepComplete(zoneNumber: number, index: number, kind: string): void {
        send('tutorial', `zone${zoneNumber}-${index}-${kind}`, 'complete');
    },

    /** `level` reached — also starts the next one when the ladder has it. */
    storeLevelReached(storeId: string, level: number, hasNextLevel: boolean): void {
        send('level', `${storeId}-${level}`, 'complete');
        if (hasNextLevel) {
            send('level', `${storeId}-${level + 1}`, 'start');
        }
    },
    clientPaid(mood: string): void {
        send('client', mood, 'paid');
    },
    clientLeft(reason: ClientLeaveReason): void {
        send('client', reason, 'left');
    },

    built(buildingId: string, level: number): void {
        send('build', `${buildingId}-${level}`, 'built');
    },
    storageBought(storageId: string): void {
        send('storage', storageId, 'bought');
    },
    farmBought(farmId: string): void {
        send('farm', farmId, 'bought');
    },
    shopUpgradeBought(tool: string, level: number): void {
        send('upgrade', `${tool}-${level}`, 'bought');
    },

    hireDeskOpened(): void {
        send('button', 'hire-desk', 'visible');
    },
    workerHired(role: string): void {
        send('button', 'hire-desk', 'interact');
        send('worker', role, 'hired');
    },
    workerUpgraded(role: string, level: number): void {
        send('button', 'hire-desk', 'interact');
        send('worker', `${role}-${level}`, 'upgraded');
    },

    resourceDepleted(providerType: string, actionType: string): void {
        send('gather', providerType, actionType);
    },
    cropHarvested(cropId: string): void {
        send('harvest', cropId, 'collect');
    },
    /** A farm upgraded at the farm manager (FarmUpgradesPopup). */
    farmUpgraded(farmId: string, level: number): void {
        send('farm-upgrade', `${farmId}-${level}`, 'bought');
    },

    demoEnded(): void {
        send('demo', 'end', 'complete');
    },
};
