import ViewUtils from "@core/utils/ViewUtils";
import { BaseNotificationView } from "./BaseNotificationView";
import { NotificationRegistry } from "./NotificationRegistry";
import {
    AchievementToastData,
    PrizeToastData,
    ShopItemToastData,
    resolveTexture
} from "./NotificationTypes";

export class PrizeToastView extends BaseNotificationView<PrizeToastData> {
    public constructor(registry: NotificationRegistry, w: number, h: number) {
        super({ kind: "prize_toast", registry, width: w, height: h });
    }

    public setData(data: PrizeToastData): void {
        const icon = resolveTexture(data.iconTexture);
        if (!this.titleText || !this.subtitleText) {
            this.buildCommonTextAndIcon(icon);
        }

        // 1. Set text and reset scales
        this.titleText!.text = data.title ?? "Prize!";
        this.subtitleText!.text = data.subtitle ?? "";
        this.titleText?.scale.set(1);
        this.subtitleText?.scale.set(1);

        const skin = this.registry.getSkin(this.kind);
        const pad = skin.padding ?? 12;
        const hasSubtitle = !!data.subtitle && data.subtitle.trim() !== "";

        // 2. Handle Scaling first (so we have final heights for positioning)
        const maxWidth = this.width * 0.5;
        if (this.titleText && this.titleText.width > maxWidth) {
            this.titleText.scale.set(ViewUtils.elementScaler(this.titleText, maxWidth));
        }
        if (this.subtitleText && this.subtitleText.width > maxWidth) {
            this.subtitleText.scale.set(ViewUtils.elementScaler(this.subtitleText, maxWidth));
        }

        // 3. Handle Positioning logic
        if (this.titleText) {
            if (hasSubtitle && this.subtitleText) {
                // Case: Title on top, Subtitle below
                this.titleText.y = pad;
                this.subtitleText.visible = true;
                this.subtitleText.y = this.titleText.y + this.titleText.height / 2 + 8;
            } else {
                // Case: No subtitle, Title centered vertically
                this.titleText.y = (this.height - this.titleText.height) / 2;
                if (this.subtitleText) {
                    this.subtitleText.visible = false;
                }
            }
        }

        if (this.bg) {
            //this.bg.alpha = 0.5;
        }
    }
}
export class AchievementToastView extends BaseNotificationView<AchievementToastData> {
    public constructor(registry: NotificationRegistry, w: number, h: number) {
        super({ kind: "achievement_toast", registry, width: w, height: h });
    }

    public setData(data: AchievementToastData): void {
        const icon = resolveTexture(data.iconTexture);
        if (!this.titleText || !this.subtitleText) {
            this.buildCommonTextAndIcon(icon);
        }

        this.titleText!.text = data.title;
        this.subtitleText!.text = data.subtitle ?? "";
    }
}

export class ShopItemToastView extends BaseNotificationView<ShopItemToastData> {
    public constructor(registry: NotificationRegistry, w: number, h: number) {
        super({ kind: "shop_item_toast", registry, width: w, height: h });
    }

    public setData(data: ShopItemToastData): void {
        // shop item often has custom icon
        const icon = resolveTexture(data.iconTexture);
        if (!this.titleText || !this.subtitleText) {
            this.buildCommonTextAndIcon(icon);
        } else if (this.icon && icon) {
            this.icon.texture = icon;
        }

        this.titleText!.text = data.title ?? "New Shop Item";
        this.subtitleText!.text = data.subtitle ?? "";
    }
}
