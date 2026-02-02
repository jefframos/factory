import BaseButton from "@core/ui/BaseButton";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import { CollectionDataManager } from "../../collections/CollectionDataManager";
import { CollectionPanel } from "../../collections/CollectionPanel";
import { ShopManager } from "../../data/ShopManager";
import MergeAssets from "../../MergeAssets";
import { NotificationIcon } from "../shop/NotificationIcon";
import ShopView from "../shop/ShopView";


export function createHudButtons(args: {
    hudLayer: PIXI.Container;
    modalLayer: PIXI.Container;

    onUiOpened: (uiId: "shop" | "collection") => void;
    onUiClosed: (uiId: "shop" | "collection") => void;
}): {
    soundToggleButton: SoundToggleButton;

    shopView: ShopView;
    shopButton: BaseButton;

    collectionPanel: CollectionPanel;
    collectionButton: BaseButton;
} {
    const soundToggleButton = new SoundToggleButton(
        MergeAssets.Textures.Icons.SoundOn,
        MergeAssets.Textures.Icons.SoundOff
    );
    args.hudLayer.addChild(soundToggleButton);

    const shopView = new ShopView((() => true));
    args.modalLayer.addChild(shopView);

    shopView.onShown.add(() => args.onUiOpened("shop"));
    shopView.onHidden.add(() => args.onUiClosed("shop"));

    const shopButton = new BaseButton({
        standard: {
            width: 100,
            height: 100,
            allPadding: 10,
            texture: PIXI.Texture.EMPTY,
            iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Shop),
            centerIconHorizontally: true,
            centerIconVertically: true,
            iconSize: { height: 100, width: 100 },
            fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 20 })
        },
        over: { tint: 0xeeeeee },
        click: { callback: () => shopView.show() }
    });
    args.hudLayer.addChild(shopButton);

    const shopNotificationIcon = new NotificationIcon(
        () => ShopManager.instance.hasAffordableItems(),
        ShopManager.instance.onAvailabilityChanged
    );
    shopButton.addChild(shopNotificationIcon);
    shopNotificationIcon.x = 10;
    shopNotificationIcon.y = 10;

    const collectionPanel = new CollectionPanel();
    args.modalLayer.addChild(collectionPanel);

    collectionPanel.onHidden.add(() => args.onUiClosed("collection"));

    const collectionButton = new BaseButton({
        standard: {
            width: 100,
            height: 100,
            allPadding: 10,
            texture: PIXI.Texture.EMPTY,
            iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.CollectionIcon),
            iconSize: { height: 100, width: 100 },
            centerIconHorizontally: true,
            centerIconVertically: true
        },
        click: {
            callback: () => {
                collectionPanel.show();
                args.onUiOpened("collection");
            }
        }
    });
    args.hudLayer.addChild(collectionButton);

    collectionButton.pivot.set(50);

    const collectionNotificationIcon = new NotificationIcon(
        () => CollectionDataManager.instance.hasUnclaimedRewards(),
        CollectionDataManager.instance.onNotificationChanged
    );
    collectionButton.addChild(collectionNotificationIcon);
    collectionNotificationIcon.x = 10;
    collectionNotificationIcon.y = 10;

    return {
        soundToggleButton,

        shopView,
        shopButton,

        collectionPanel,
        collectionButton
    };
}
