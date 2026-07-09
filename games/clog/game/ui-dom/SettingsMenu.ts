import PlatformHandler from 'core/platforms/PlatformHandler';
import { ShopStorage } from '../data/ShopStorage';
import { HighScoreStorage } from '../data/HighScoreStorage';
import { PLAYER_NAME_KEY } from '../scenes/BaseDemoScene';
import { Localization } from '../i18n/Localization';
import { renderLanguageRow } from './LanguagePicker';
import { ConfirmationPopup } from '../dom-ui/ConfirmationPopup';
import { panelHeading } from '../dom-ui/PanelChrome';

/** Mirrors the .btn-* role classes in ../dom-ui/buttons.css. */
type BtnRole = 'primary' | 'secondary' | 'accent' | 'shop' | 'danger';

/**
 * Settings menu content for SettingsButton (see ../dom-ui/SettingsButton)
 * — language picker + Clear Data. SettingsButton itself provides the corner
 * close X, so there's no separate Close button here.
 * Reloads the page after wiping every persisted key rather than trying to
 * reset every in-memory cache (ShopStorage, HighScoreStorage, etc.) by hand,
 * so a fresh boot picks up the cleared state exactly like a first-ever visit
 * would.
 */
export function renderSettingsMenu(box: HTMLElement, _close: () => void): void {
    box.appendChild(panelHeading(Localization.getString('settings')));
    renderLanguageRow(box);
    box.appendChild(button(Localization.getString('clearData'), () => void handleClearData(), { role: 'danger' }));
}

async function handleClearData(): Promise<void> {
    const confirmed = await ConfirmationPopup.confirm({
        message: Localization.getString('clearDataConfirm'),
        confirmLabel: Localization.getString('clearData'),
        confirmRole: 'danger',
    });
    if (!confirmed) return;
    await Promise.all([
        ShopStorage.clearAll(),
        HighScoreStorage.clearAll(),
        PlatformHandler.instance.platform.removeItem(PLAYER_NAME_KEY),
    ]);
    window.location.reload();
}

function button(label: string, onClick: () => void, opts: { role?: BtnRole } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = `btn btn-${opts.role ?? 'secondary'} btn-md btn-block`;
    btn.style.marginTop = '8px';
    btn.addEventListener('click', onClick);
    return btn;
}
