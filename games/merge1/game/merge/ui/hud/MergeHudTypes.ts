import BaseButton from "@core/ui/BaseButton";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { CollectionPanel } from "../../collections/CollectionPanel";
import { CurrencyType } from "../../data/InGameEconomy";
import SpinningWheel from "../../spinningWheel/SpinningWheel";
import { NewEntityDiscoveredView } from "../../vfx/NewEntityDiscoveredView";
import { CurrencyBox } from "../CurrencyBox";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { NotificationRegistry } from "../notifications/NotificationRegistry";
import { RoomSelector } from "../room/RoomSelector";
import ShopView from "../shop/ShopView";
import GeneratorHUD from "./GeneratorHUD";
import { MissionHUD } from "./MissionHUD";
import { ProgressHUD } from "./ProgressHUD";


export type UiId = "shop" | "collection";

export interface MergeHudLayers {
    effectsLayer: PIXI.Container;
    hudLayer: PIXI.Container;
    hintLayer: PIXI.Container;
    modalLayer: PIXI.Container;
    topLayer: PIXI.Container;
    notificationLayer: PIXI.Container;
}

export interface MergeHudCoreViews {
    soundToggleButton: SoundToggleButton;

    shopView: ShopView;
    shopButton: BaseButton;

    collectionPanel: CollectionPanel;
    collectionButton: BaseButton;

    currencyHUD: CurrencyBox;
    currencyHUDGem: CurrencyBox;
    currencyHUDList: Map<CurrencyType, CurrencyBox>;

    progressHUD: ProgressHUD;
    generator: GeneratorHUD;
    missionHUD: MissionHUD;

    roomSelector: RoomSelector;

    newDiscovery: NewEntityDiscoveredView;

    spinningWheel?: SpinningWheel;

    notifications: NotificationCenter;
    notificationRegistry: NotificationRegistry;
}

export interface MergeHudSignals {
    onUiOpen: Signal;
    onUiClose: Signal;
    onFocusChanged: Signal;
    onRoomSelected: Signal;
}
