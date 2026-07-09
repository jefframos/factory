import PlatformHandler from 'core/platforms/PlatformHandler';
import '../dom-ui/shop.css';
import lockIcon from '../dom-ui/images/lock.png';
import videoIcon from '../dom-ui/images/video-icon.png';
import checkIcon from '../dom-ui/images/Icon_Check03_s.png';
import { panelCloseButton, panelHeading } from '../dom-ui/PanelChrome';

import { ShopStorage, SHOP_ITEMS, resolveShopImagePath, type ShopItem } from '../data/ShopStorage';
import { Localization } from '../i18n/Localization';

const FALLBACK_IMAGE = resolveShopImagePath('skins/default_cube.webp');

function skinImageUrl(relativePath: string | undefined): string {
    return relativePath ? resolveShopImagePath(relativePath) : FALLBACK_IMAGE;
}

/**
 * The Shop sub-screen, rendered into PlayerFlowController's boxed,
 * semi-transparent ModalOverlay panel (see renderShop() — setContent with a
 * translucent background override) rather than a full dimmed blocker — the
 * live 3D player, wearing whatever skin is equipped, stays visible behind
 * the panel instead of a flat DOM preview image standing in for it (see
 * PlayerEntity.applyEquippedSkin). Self-contained: re-invoking this function
 * redraws the whole screen, which is how card state refreshes after an equip.
 */
export function renderShopScreen(root: HTMLElement, onClose: () => void): void {
    root.innerHTML = '';
    root.className = 'shop-box';
    // Flex column with a height cap — the grid (flex-shrinks to fit, then
    // scrolls via .shop-grid's own overflow-y) is what used to be capped by
    // the old fixed-position wrapper's maxHeight; the close button stays
    // pinned to the panel's corner (position:absolute) rather than scrolling
    // away with it.
    Object.assign(root.style, { display: 'flex', flexDirection: 'column', maxHeight: '66vh' });
    const rerender = () => renderShopScreen(root, onClose);

    root.appendChild(panelCloseButton(onClose));
    root.appendChild(panelHeading(Localization.getString('shop')));

    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    for (const item of SHOP_ITEMS) grid.appendChild(shopItemCard(item, rerender));
    root.appendChild(grid);
}

/**
 * The whole card is the button, colored per role via shop-card-{accent,primary,secondary}
 * (see shop.css). A cosmetic only needs an ad the first time it's equipped
 * *this session* — see ShopStorage.isCosmeticSessionUnlocked — after that,
 * switching back to it is free until the page reloads. 'free' (the default
 * skin) and unlocked 'achievement' items are always free to equip.
 */
function shopItemCard(item: ShopItem, rerender: () => void): HTMLElement {
    const unlocked = item.kind !== 'achievement' || ShopStorage.isAchievementUnlocked(item.id);
    const equipped = ShopStorage.getEquippedSkinId() === item.id;
    const needsAd = item.kind === 'cosmetic' && !ShopStorage.isCosmeticSessionUnlocked(item.id);
    const clickable = unlocked && !equipped;

    // secondary (grey) = locked; equipped (purple) = currently worn; accent (yellow) = needs an ad; primary (green) = free equip.
    const roleClass = !unlocked
        ? 'shop-card-secondary'
        : equipped
            ? 'shop-card-equipped'
            : needsAd
                ? 'shop-card-accent'
                : 'shop-card-primary';

    const card = document.createElement(clickable ? 'button' : 'div');
    card.className = `shop-card ${roleClass}` + (clickable ? ' shop-card-clickable' : '');
    if (!unlocked) card.style.opacity = '0.85';

    const icon = document.createElement('img');
    icon.className = 'shop-card-icon';
    icon.title = item.name;
    icon.src = skinImageUrl(item.icon);
    icon.style.filter = unlocked ? 'none' : 'grayscale(1) brightness(0.55)';
    card.appendChild(icon);

    card.appendChild(actionLabel(item, unlocked, equipped, needsAd));

    if (clickable) {
        card.addEventListener('click', () => {
            if (needsAd) {
                void handleAdEquip(item, card as HTMLButtonElement, rerender);
            } else {
                ShopStorage.equip(item.id);
                rerender();
            }
        });
    }
    return card;
}

/** Plain icon+text row — no chrome of its own now that the whole card carries the role color (see shopItemCard). */
function actionLabel(item: ShopItem, unlocked: boolean, equipped: boolean, needsAd: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'shop-label';

    if (!unlocked) {
        const img = document.createElement('img');
        img.src = lockIcon;
        img.className = 'shop-label-icon';
        row.appendChild(img);

        const text = document.createElement('span');
        text.textContent = Localization.getString('reach', { value: item.shortLabel ?? item.valueThreshold ?? '' });
        row.appendChild(text);
        return row;
    }

    if (equipped) {
        const img = document.createElement('img');
        img.src = checkIcon;
        img.className = 'shop-label-icon';
        row.appendChild(img);

        const text = document.createElement('span');
        text.textContent = Localization.getString('equipped');
        row.appendChild(text);
        return row;
    }

    if (!needsAd) {
        const text = document.createElement('span');
        text.textContent = Localization.getString('equip');
        row.appendChild(text);
        return row;
    }

    const img = document.createElement('img');
    img.src = videoIcon;
    img.className = 'shop-label-icon';
    row.appendChild(img);

    const text = document.createElement('span');
    text.textContent = Localization.getString('equip');
    row.appendChild(text);
    return row;
}

/** First equip of a cosmetic this session requires a rewarded ad (see ShopStorage doc comment) — same fire-and-resolve call shape as PlayerFlowController.handleWatchAd, since no current platform reports a real completion signal. */
async function handleAdEquip(item: ShopItem, cardBtn: HTMLButtonElement, rerender: () => void): Promise<void> {
    cardBtn.disabled = true;
    try {
        await PlatformHandler.instance.platform.showRewardedVideo();
        ShopStorage.markCosmeticSessionUnlocked(item.id);
        ShopStorage.equip(item.id);
        rerender();
    } catch (e) {
        console.error('Shop: rewarded video failed', e);
        cardBtn.disabled = false;
    }
}
