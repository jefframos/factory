import { Localization } from '../i18n/Localization';
import { renderLanguageRow } from './LanguagePicker';
import { panelHeading } from '../dom-ui/PanelChrome';

/**
 * Settings menu content for SettingsButton (see ../dom-ui/SettingsButton)
 * — language picker only. SettingsButton itself provides the corner close X,
 * so there's no separate Close button here.
 */
export function renderSettingsMenu(box: HTMLElement, _close: () => void): void {
    box.appendChild(panelHeading(Localization.getString('settings')));
    renderLanguageRow(box);
}
