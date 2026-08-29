// PlayerDataReset.ts
//
// The full player-facing "Clear Data" storage wipe — extracted out of SettingsPopup.ts so the
// new debug InGameButtonList button (see PizzaScene.ts's own doc) can trigger the exact same
// reset without duplicating this storage list a second time. See clearAllPlayerData()'s own
// doc for why each entry is here.

import { GlobalResourceStorage } from './GlobalResourceStorage';
import { BackpackStorage } from './BackpackStorage';
import { BuildingStorage } from './BuildingStorage';
import { GateStorage } from './GateStorage';
import { QueueStorage } from './QueueStorage';
import { EconomyStorage } from './EconomyStorage';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import { ShopStorage } from './ShopStorage';
import { HighScoreStorage } from './HighScoreStorage';
import { CraftStorage } from '../crafting/CraftStorage';
import { ItemStorage } from '../crafting/ItemStorage';
import { DynamicResourceStorage } from '../world/DynamicResourceStorage';
import { ShapeResourceStorage } from '../world/ShapeResourceStorage';
import { AnimalFollowStorage } from './AnimalFollowStorage';
import { PlayerPositionStorage } from './PlayerPositionStorage';
import { FarmPlotStorage } from './FarmPlotStorage';
import { TutorialProgressStorage } from '../tutorial/TutorialProgressStorage';
import { TriggerStorage } from './TriggerStorage';

/**
 * Same storage list PizzaScene's own dev "Reset Everything" button clears (including
 * ShapeResourceStorage/AnimalFollowStorage — the latter's persisted follower list is why a
 * caught animal used to SURVIVE this clear: with it left out, a reload just reconstructed the
 * same followers straight back from an untouched save, per PizzaScene.setupAnimalFollowers()),
 * plus ShopStorage/HighScoreStorage (which that dev button doesn't touch but genuinely should
 * for a PLAYER-facing clear). Reloads afterward so a fresh boot picks up the cleared state
 * exactly like a first-ever visit would, rather than trying to reset every in-memory
 * cache/UI by hand.
 *
 * CraftStorage/ItemStorage use ItemStorage.resetToDefaults() rather than
 * ItemStorage.clearAll() — a plain wipe would leave the reload with NO tools at all (nothing
 * left to re-seed the starting axe once index.ts's ItemStorage.load() sees an
 * already-empty-but-still-written save), where the reload should land back at "one axe,
 * craft1 available again," the same state a first-ever visit gets.
 *
 * PlayerPositionStorage.clearAll() is in this list for exactly the same reason every
 * gated-progress storage is — GateStorage.clearAll() re-locks every gate, but without also
 * wiping the saved "last stable tile" the player would reload standing wherever they last
 * were, which after a real gate re-locks could easily be on the far side of one with no way
 * back. Clearing it here lets PizzaScene's constructor fall back to the map's own
 * "playerStart" point instead, same as an actual first-ever visit.
 *
 * TutorialProgressStorage.clearAll() is here for the same "gated progress must reset alongside
 * the systems it gates" reason — CraftStorage/GateStorage above re-lock the axe recipe/gate
 * themselves, but without also wiping the saved completed-step index, ZoneTutorialController
 * would reload thinking the player already finished a step whose real backing progress just
 * got wiped out from under it.
 */
export function clearAllPlayerData(): void {
    void Promise.all([
        GlobalResourceStorage.clearAll(),
        BackpackStorage.clearAll(),
        BuildingStorage.clearAll(),
        GateStorage.clearAll(),
        QueueStorage.clearAll(),
        EconomyStorage.clearAll(),
        ShopUpgradeStorage.clearAll(),
        ShopStorage.clearAll(),
        HighScoreStorage.clearAll(),
        CraftStorage.clearAll(),
        ItemStorage.resetToDefaults(),
        DynamicResourceStorage.clearAll(),
        ShapeResourceStorage.clearAll(),
        AnimalFollowStorage.clearAll(),
        PlayerPositionStorage.clearAll(),
        FarmPlotStorage.clearAll(),
        TutorialProgressStorage.clearAll(),
        TriggerStorage.clearAll(),
    ]).then(() => window.location.reload());
}
