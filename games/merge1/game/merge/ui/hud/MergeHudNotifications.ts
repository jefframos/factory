import { Game } from "@core/Game";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { NotificationRegistry } from "../notifications/NotificationRegistry";

export function createHudNotifications(notificationLayer: PIXI.Container): {
    notifications: NotificationCenter;
    notificationRegistry: NotificationRegistry;
} {
    const notificationRegistry = new NotificationRegistry();
    const notifications = new NotificationCenter(notificationRegistry);

    notificationLayer.addChild(notifications);

    notifications.setStack({
        anchor: "topRight",
        marginX: 18,
        marginY: 200,
        offsetX: 50,
        width: 320,
        height: 85,
        spacing: 10,
        direction: "down"
    });

    notifications.onOverlayChanged(Game.gameScreenData);

    notificationRegistry.setSkin("prize_toast", {
        bgTexture: MergeAssets.Textures.UI.NotificationPanel,
        bgNineSlice: { left: 25, top: 25, right: 25, bottom: 25 },
        shinyAlpha: 0.12,
        defaultDurationSeconds: 2.4,
        padding: 12,
        iconSize: 64,
        titleStyle: { ...MergeAssets.MainFont, fontSize: 32 },
        subtitleStyle: { ...MergeAssets.MainFont, fontSize: 18 }
    });

    notificationRegistry.setSkin("achievement_toast", {
        bgTexture: MergeAssets.Textures.UI.NotificationPanel,
        bgNineSlice: { left: 25, top: 25, right: 25, bottom: 25 },
        shinyAlpha: 0.10,
        defaultDurationSeconds: 3.0,
        padding: 12,
        iconSize: 64,
        titleStyle: { ...MergeAssets.MainFont, fontSize: 24 },
        subtitleStyle: { ...MergeAssets.MainFont, fontSize: 18 }
    });

    notificationRegistry.setSkin("shop_item_toast", {
        bgTexture: MergeAssets.Textures.UI.NotificationPanel,
        bgNineSlice: { left: 25, top: 25, right: 25, bottom: 25 },
        defaultDurationSeconds: 3.2,
        padding: 12,
        iconSize: 64,
        titleStyle: { ...MergeAssets.MainFont, fontSize: 24 },
        subtitleStyle: { ...MergeAssets.MainFont, fontSize: 18 }
    });

    notificationRegistry.setSkin("levelup_interstitial", {
        bgTexture: MergeAssets.Textures.UI.NotificationPanel,
        bgNineSlice: { left: 20, top: 20, right: 20, bottom: 20 },
        shinyAlpha: 0.10,
        padding: 18,
        iconSize: 120,
        titleStyle: { ...MergeAssets.MainFont, fontSize: 44 },
        subtitleStyle: { ...MergeAssets.MainFont, fontSize: 28 },
        blackoutAlpha: 0.70
    });

    return { notifications, notificationRegistry };
}
