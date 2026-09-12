import { DomUiRoot } from './DomUiRoot';
import { ConfirmationPopup } from './ConfirmationPopup';
import { withTap } from './PanelChrome';
import { Localization } from '../i18n/Localization';
import backIcon from './images/Icon_Back.png';

/**
 * Persistent top-left "end run" button — sits to the right of
 * SoundToggleButton (itself right of SettingsButton), shown only while
 * actually playing (see setEnabled — BaseDemoScene.setFlowState). Confirms
 * first (same ConfirmationPopup SettingsMenu's Clear Data uses), since
 * confirming immediately ends the current run: skips straight to the End
 * Game screen instead of the usual death/revive countdown — see
 * BaseDemoScene's quitToEndGame flag.
 */
export class QuitButton {
    readonly element: HTMLButtonElement;

    constructor(private readonly onQuit: () => void) {
        this.element = document.createElement('button');
        Object.assign(this.element.style, {
            position: 'fixed',
            top: '12px',
            left: '116px', // 12px margin + 40px SettingsButton + 12px gap + 40px SoundToggleButton + 12px gap
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(24, 24, 32, 0.85)',
            cursor: 'pointer',
            display: 'none', // shown by setEnabled(true) once actually playing
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            pointerEvents: 'auto',
        });
        Localization.bindLabel(this.element, 'quitRun', { attr: 'title' });

        const icon = document.createElement('img');
        icon.src = backIcon;
        Object.assign(icon.style, { width: '20px', height: '20px' });
        this.element.appendChild(icon);

        this.element.addEventListener('click', withTap(() => void this.confirmQuit()));

        DomUiRoot.instance.mount(this.element);
    }

    private async confirmQuit(): Promise<void> {
        const confirmed = await ConfirmationPopup.confirm({
            message: Localization.getString('quitRunConfirm'),
            confirmLabel: Localization.getString('quitRun'),
            confirmRole: 'danger',
        });
        if (confirmed) this.onQuit();
    }

    /** Shown only while actually playing — ending a run that hasn't started, or is already ending, doesn't make sense. */
    setEnabled(enabled: boolean): void {
        this.element.style.display = enabled ? 'flex' : 'none';
    }

    destroy(): void {
        Localization.unbindLabel(this.element);
        DomUiRoot.instance.unmount(this.element);
    }
}
