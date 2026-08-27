// SettingsPopup.ts
//
// Settings panel content for SettingsButton (see ../SettingsUIService) —
// just Clear Data for now. Extends Popup (see that file's own doc) so this
// only has to describe ITS OWN content via buildContent(); the title/close
// button/panel chrome/transition are all handled generically.

import * as PIXI from 'pixi.js';
import Popup from './Popup';
import { createPopupButton, POPUP_BUTTON_WIDTH } from './PopupButtonStyles';
import { GlobalResourceStorage } from '../../data/GlobalResourceStorage';
import { BackpackStorage } from '../../data/BackpackStorage';
import { BuildingStorage } from '../../data/BuildingStorage';
import { GateStorage } from '../../data/GateStorage';
import { QueueStorage } from '../../data/QueueStorage';
import { EconomyStorage } from '../../data/EconomyStorage';
import { ShopUpgradeStorage } from '../../shop/ShopUpgradeStorage';
import { ShopStorage } from '../../data/ShopStorage';
import { HighScoreStorage } from '../../data/HighScoreStorage';
import { CraftStorage } from '../../crafting/CraftStorage';
import { ItemStorage } from '../../crafting/ItemStorage';
import { DynamicResourceStorage } from '../../world/DynamicResourceStorage';
import { ShapeResourceStorage } from '../../world/ShapeResourceStorage';
import { AnimalFollowStorage } from '../../data/AnimalFollowStorage';
import { PlayerPositionStorage } from '../../data/PlayerPositionStorage';

export default class SettingsPopup extends Popup {
    public constructor() {
        super('Settings', { contentWidth: POPUP_BUTTON_WIDTH });
    }

    protected buildContent(content: PIXI.Container, contentWidth: number): void {
        // The one action this popup has right now — see createPopupButton's own doc for how to
        // add a second one at a different emphasis level (role: 'secondary'/'accent').
        const clearDataButton = createPopupButton('Clear Data', 'primary', () => this.handleClearData());
        clearDataButton.position.set((contentWidth - POPUP_BUTTON_WIDTH) / 2, 0);
        content.addChild(clearDataButton);
    }

    /**
     * Same storage list PizzaScene's own dev "Reset Everything" button clears (including
     * ShapeResourceStorage/AnimalFollowStorage — the latter's persisted follower list is why a
     * caught animal used to SURVIVE this clear: with it left out here, a reload just reconstructed
     * the same followers straight back from an untouched save, per PizzaScene.setupAnimalFollowers()),
     * plus ShopStorage/HighScoreStorage (which that dev button doesn't touch but genuinely
     * should for a PLAYER-facing clear). Reloads afterward so a fresh boot picks up the cleared state
     * exactly like a first-ever visit would, rather than trying to reset every in-memory
     * cache/UI by hand.
     *
     * CraftStorage/ItemStorage use ItemStorage.resetToDefaults() rather than
     * ItemStorage.clearAll() — a plain wipe would leave the reload with NO tools at all
     * (nothing left to re-seed the starting axe once index.ts's ItemStorage.load() sees an
     * already-empty-but-still-written save), where the reload should land back at "one axe,
     * craft1 available again," the same state a first-ever visit gets.
     *
     * PlayerPositionStorage.clearAll() is in this list for exactly the same reason every
     * gated-progress storage is — GateStorage.clearAll() re-locks every gate, but without also
     * wiping the saved "last stable tile" the player would reload standing wherever they last
     * were, which after a real gate re-locks could easily be on the far side of one with no way
     * back (see this popup's own reload). Clearing it here lets PizzaScene's constructor fall
     * back to the map's own "playerStart" point instead, same as an actual first-ever visit.
     */
    private handleClearData(): void {
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
        ]).then(() => window.location.reload());
    }
}
