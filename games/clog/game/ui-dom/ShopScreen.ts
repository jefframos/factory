import PlatformHandler from '@core/platforms/PlatformHandler';
import '@core/dom-ui/shop.css';
import lockIcon from '@core/dom-ui/images/lock.png';
import videoIcon from '@core/dom-ui/images/video-icon.png';
import closeIcon from '@core/dom-ui/images/Icon_Close02.png';
import checkIcon from '@core/dom-ui/images/Icon_Check03_s.png';

import iconSunglassesBlue from '@core/dom-ui/images/skins/sunglasses_blue.png';
import iconSunglassesPink from '@core/dom-ui/images/skins/sunglasses_pink.png';
import iconMustacheBrown from '@core/dom-ui/images/skins/mustache_brown.png';
import iconMustacheBlack from '@core/dom-ui/images/skins/mustache_black.png';
import iconUnicornHorn from '@core/dom-ui/images/skins/unicorn_horn.png';
import iconBadge2048 from '@core/dom-ui/images/skins/badge_2048.png';
import iconBadge8192 from '@core/dom-ui/images/skins/badge_8192.png';
import iconBadge16384 from '@core/dom-ui/images/skins/badge_16384.png';
import iconBadge1m from '@core/dom-ui/images/skins/badge_1m.png';
import iconBadge1b from '@core/dom-ui/images/skins/badge_1b.png';
import iconDefaultCube from '@core/dom-ui/images/skins/default_cube.png';

import { ShopStorage, SHOP_ITEMS, type ShopItem } from '../data/ShopStorage';

/** Static import map — Vite needs literal import statements to bundle these, so shopItems.json only carries the icon *key*, resolved here. */
const ICONS: Record<string, string> = {
    sunglasses_blue: iconSunglassesBlue,
    sunglasses_pink: iconSunglassesPink,
    mustache_brown: iconMustacheBrown,
    mustache_black: iconMustacheBlack,
    unicorn_horn: iconUnicornHorn,
    badge_2048: iconBadge2048,
    badge_8192: iconBadge8192,
    badge_16384: iconBadge16384,
    badge_1m: iconBadge1m,
    badge_1b: iconBadge1b,
    default_cube: iconDefaultCube,
};

function iconFor(item: ShopItem): string {
    return ICONS[item.icon] ?? iconDefaultCube;
}

/**
 * The Shop sub-screen, rendered into PlayerFlowController's dimmed, panel-
 * free ModalOverlay full-viewport layer (see renderShop() — setFullContent +
 * setDimmed(true), same "world hidden behind a dark backdrop" treatment as
 * End Game). No boxed card — just the dimmed backdrop, the close button, and
 * fixed-position content. Self-contained: re-invoking this function redraws
 * the whole screen, which is how card/preview state refreshes after an equip.
 */
export function renderShopScreen(root: HTMLElement, onClose: () => void): void {
    root.innerHTML = '';
    const rerender = () => renderShopScreen(root, onClose);

    root.appendChild(closeButton(onClose));

    const wrap = document.createElement('div');
    wrap.className = 'shop-box';
    Object.assign(wrap.style, {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        maxHeight: '82vh',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
    });
    root.appendChild(wrap);

    wrap.appendChild(heading('Shop'));
    wrap.appendChild(centerPreview());

    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    for (const item of SHOP_ITEMS) grid.appendChild(shopItemCard(item, rerender));
    wrap.appendChild(grid);
}

/** Fixed top-right circular close button — replaces the boxed screen's Back button, freeing up the vertical space a full-width bottom button would have used. */
function closeButton(onClick: () => void): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'fixed', top: '14px', right: '14px', pointerEvents: 'auto' });

    const btn = document.createElement('button');
    Object.assign(btn.style, {
        width: '38px',
        height: '38px',
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(20, 20, 28, 0.75)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0',
    });

    const img = document.createElement('img');
    img.src = closeIcon;
    Object.assign(img.style, { width: '20px', height: '20px' });
    btn.appendChild(img);

    btn.addEventListener('click', onClick);
    wrap.appendChild(btn);
    return wrap;
}

function heading(text: string): HTMLElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, {
        fontSize: '20px',
        fontWeight: 'bold',
        textAlign: 'center',
        textShadow: '0 2px 6px rgba(0,0,0,0.6)',
    });
    return h;
}

/** Big preview of whatever's currently equipped (or the default cube, if nothing is). */
function centerPreview(): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'flex', justifyContent: 'center', margin: '10px 0 4px' });

    const equippedId = ShopStorage.getEquippedSkinId();
    const equippedItem = SHOP_ITEMS.find(i => i.id === equippedId);

    const img = document.createElement('img');
    img.className = 'shop-preview-img';
    img.src = equippedItem ? iconFor(equippedItem) : iconDefaultCube;
    wrap.appendChild(img);
    return wrap;
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

    // secondary (grey) = locked or already-equipped; accent (yellow) = needs an ad; primary (green) = free equip.
    const roleClass = !unlocked || equipped
        ? 'shop-card-secondary'
        : needsAd
            ? 'shop-card-accent'
            : 'shop-card-primary';

    const card = document.createElement(clickable ? 'button' : 'div');
    card.className = `shop-card ${roleClass}` + (clickable ? ' shop-card-clickable' : '');
    if (!unlocked) card.style.opacity = '0.85';

    const icon = document.createElement('img');
    icon.className = 'shop-card-icon';
    icon.title = item.name;
    icon.src = iconFor(item);
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
        text.textContent = `Reach ${item.shortLabel ?? item.valueThreshold}`;
        row.appendChild(text);
        return row;
    }

    if (equipped) {
        const img = document.createElement('img');
        img.src = checkIcon;
        img.className = 'shop-label-icon';
        row.appendChild(img);

        const text = document.createElement('span');
        text.textContent = 'EQUIPPED';
        row.appendChild(text);
        return row;
    }

    if (!needsAd) {
        const text = document.createElement('span');
        text.textContent = 'EQUIP';
        row.appendChild(text);
        return row;
    }

    const img = document.createElement('img');
    img.src = videoIcon;
    img.className = 'shop-label-icon';
    row.appendChild(img);

    const text = document.createElement('span');
    text.textContent = 'EQUIP';
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
