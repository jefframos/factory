import { DomUiRoot } from './DomUiRoot';
import { ModalOverlay } from './ModalOverlay';
import { PANEL_TRANSLUCENT_BACKGROUND, panelCloseButton } from './PanelChrome';
import { Localization } from '../i18n/Localization';
import settingsIcon from './images/settings.png';

/**
 * Persistent top-left gear button — opens a small, truly-centered menu whose
 * content is entirely supplied by the caller, since what belongs in
 * Settings is game-specific (e.g. clog's Clear Data). Meant to sit at the
 * top-left corner with SoundToggleButton shifted right to make room for it
 * (see BaseDemoScene).
 *
 * Same translucent panel + corner close-X as PlayerFlowController's
 * Shop/Boost screens (see PanelChrome) — the 3D world stays visible behind
 * it rather than being dimmed into a true blocking screen.
 */
export class SettingsButton {
    readonly element: HTMLButtonElement;
    private readonly overlay = new ModalOverlay();

    constructor(private readonly buildMenu: (box: HTMLElement, close: () => void) => void) {
        this.element = document.createElement('button');
        Object.assign(this.element.style, {
            position: 'fixed',
            top: '12px',
            left: '12px',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(24, 24, 32, 0.85)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            pointerEvents: 'auto',
        });
        Localization.bindLabel(this.element, 'settings', { attr: 'title' });

        const icon = document.createElement('img');
        icon.src = settingsIcon;
        Object.assign(icon.style, { width: '20px', height: '20px' });
        this.element.appendChild(icon);

        this.element.addEventListener('click', () => this.open());

        DomUiRoot.instance.mount(this.element);
        DomUiRoot.instance.mount(this.overlay.element);

        Localization.onLocaleChange.add(this.refreshIfOpen, this);
    }

    /** Re-draws the open menu in place on a locale change — a no-op while closed, since open() is called fresh next time anyway. */
    private refreshIfOpen(): void {
        if (this.overlay.isVisible) this.open();
    }

    private open(): void {
        this.overlay.setContent(box => {
            box.appendChild(panelCloseButton(() => this.close()));
            Object.assign(box.style, { width: '280px', display: 'flex', flexDirection: 'column', gap: '8px' });
            this.buildMenu(box, () => this.close());
        }, { background: PANEL_TRANSLUCENT_BACKGROUND });
        this.overlay.show();
    }

    private close(): void {
        this.overlay.hide();
    }

    destroy(): void {
        Localization.onLocaleChange.remove(this.refreshIfOpen, this);
        Localization.unbindLabel(this.element);
        DomUiRoot.instance.unmount(this.element);
        DomUiRoot.instance.unmount(this.overlay.element);
        this.overlay.destroy();
    }
}
