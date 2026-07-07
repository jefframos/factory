import PlatformHandler from '@core/platforms/PlatformHandler';
import { ShopStorage } from '../data/ShopStorage';
import { HighScoreStorage } from '../data/HighScoreStorage';
import { PLAYER_NAME_KEY } from '../scenes/BaseDemoScene';

/** Mirrors the .btn-* role classes in core/dom-ui/buttons.css. */
type BtnRole = 'primary' | 'secondary' | 'accent' | 'shop' | 'danger';

/**
 * Settings menu content for SettingsButton (see core/dom-ui/SettingsButton)
 * — currently just Clear Data. SettingsButton itself provides the close X
 * and click-outside-to-close, so there's no separate Close button here.
 * Reloads the page after wiping every persisted key rather than trying to
 * reset every in-memory cache (ShopStorage, HighScoreStorage, etc.) by hand,
 * so a fresh boot picks up the cleared state exactly like a first-ever visit
 * would.
 */
export function renderSettingsMenu(box: HTMLElement, _close: () => void): void {
    box.appendChild(heading('Settings'));
    box.appendChild(button('Clear Data', () => void handleClearData(), { role: 'danger' }));
}

async function handleClearData(): Promise<void> {
    if (!window.confirm('Clear all saved data? This resets your high score, shop unlocks, and name. This cannot be undone.')) return;
    await Promise.all([
        ShopStorage.clearAll(),
        HighScoreStorage.clearAll(),
        PlatformHandler.instance.platform.removeItem(PLAYER_NAME_KEY),
    ]);
    window.location.reload();
}

function heading(text: string): HTMLElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, { fontSize: '20px', fontWeight: 'bold', textAlign: 'center', marginBottom: '14px' });
    return h;
}

function button(label: string, onClick: () => void, opts: { role?: BtnRole } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = `btn btn-${opts.role ?? 'secondary'} btn-md btn-block`;
    btn.style.marginTop = '8px';
    btn.addEventListener('click', onClick);
    return btn;
}
