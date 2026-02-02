import { Game } from "@core/Game";
import type { MergeHudCoreViews } from "./MergeHudTypes";

export function layoutMergeHud(rootX: number, rootY: number, views: MergeHudCoreViews): void {
    const padding = 20;
    const { topLeft, bottomRight, topRight } = Game.overlayScreenData;

    // Root transform (caller sets, but we keep it centralized)
    // NOTE: Caller should set hud.x/y to topLeft.x/y.
    // Here we use rootX/rootY to compute local positions.
    const x0 = rootX;
    const y0 = rootY;

    // Sound & Currency
    views.soundToggleButton.position.set(
        topRight.x - x0 - views.soundToggleButton.width / 2 - padding,
        padding + views.soundToggleButton.height / 2
    );

    views.currencyHUD.position.set(20, 20);
    views.currencyHUDGem.position.set(160, 20);

    // Top Center
    const centerX = (topRight.x - topLeft.x) / 2;

    const targetXProgress = Math.max(
        centerX,
        views.currencyHUDGem.x + views.currencyHUDGem.width + 30 + views.progressHUD.pivot.x
    );

    views.progressHUD.position.set(targetXProgress, padding * 2);

    if (views["timedRewardsBar"]) {
        (views as any).timedRewardsBar.position.set(centerX, views.progressHUD.y + 50);
    }

    // Bottom Right (Generator)
    views.generator.position.set(
        bottomRight.x - views.generator.width - padding - x0,
        bottomRight.y - 80 - y0
    );

    // Right Column
    views.shopButton.x = topRight.x - x0 - 90 - padding;
    views.shopButton.y = topRight.y - y0 + 90 + padding;

    views.roomSelector.x = views.shopButton.x;
    views.roomSelector.y = views.shopButton.y - views.roomSelector.height - 10;

    views.missionHUD.position.set(0, bottomRight.y - 120 - y0);

    views.shopView.position.set(centerX, (bottomRight.y - topRight.y) / 2);

    // Collection under shop
    views.collectionButton.x = views.shopButton.x + views.collectionButton.pivot.x;
    views.collectionButton.y = views.shopButton.y + views.shopButton.height + 10 + views.collectionButton.pivot.y;

    // Panel center
    views.collectionPanel.position.set(centerX, (bottomRight.y - topRight.y) / 2);

    // Notifications needs overlay sync
    views.notifications.onOverlayChanged(Game.gameScreenData);
}
