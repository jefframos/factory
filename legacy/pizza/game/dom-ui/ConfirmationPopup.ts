import { DomUiRoot } from './DomUiRoot';
import { ModalOverlay } from './ModalOverlay';
import { withTap } from './PanelChrome';
import { Localization } from '../i18n/Localization';

export interface ConfirmOptions {
    message: string;
    confirmLabel: string;
    /** Defaults to the localized "Cancel". */
    cancelLabel?: string;
    /** Skin for the confirm button — 'danger' (red) for destructive choices like Clear Data, 'primary' otherwise. Cancel is always plain 'secondary'. */
    confirmRole?: 'primary' | 'accent' | 'danger';
}

/**
 * Single shared confirm/cancel dialog for any "are you sure?" decision in
 * the game (see SettingsMenu.handleClearData for the first caller) — mounted
 * only while open, so it always lands as DomUiRoot's *last* child and paints
 * above every other currently-open overlay (Settings, Shop, etc.) regardless
 * of which was constructed first. Resolves `true` on Confirm, `false` on
 * Cancel or on a click on the dimmed backdrop itself (same click-outside
 * convention ModalOverlay/SettingsButton already use).
 */
class ConfirmationPopupService {
    static readonly instance = new ConfirmationPopupService();

    private readonly overlay = new ModalOverlay();
    private resolveCurrent: ((value: boolean) => void) | null = null;

    private constructor() {
        this.overlay.element.addEventListener('click', (e) => {
            if (e.target === this.overlay.element) this.resolve(false);
        });
    }

    confirm(opts: ConfirmOptions): Promise<boolean> {
        return new Promise(resolve => {
            this.resolveCurrent = resolve;

            this.overlay.setContent(box => {
                // Wider side padding and a fixed width than ModalOverlay's
                // shared default (that box is tuned for the Settings/Boost/
                // Rename screens' denser content) — a one-line question reads
                // better in a squarer box than a thin banner stretched full-width.
                Object.assign(box.style, { width: '300px', padding: '32px 34px' });

                const text = document.createElement('div');
                text.textContent = opts.message;
                Object.assign(text.style, { marginBottom: '30px', textAlign: 'center', lineHeight: '1.5' });
                box.appendChild(text);

                const row = document.createElement('div');
                Object.assign(row.style, { display: 'flex', gap: '10px' });

                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = opts.cancelLabel ?? Localization.getString('cancel');
                cancelBtn.className = 'btn btn-secondary btn-md';
                cancelBtn.style.flex = '1';
                cancelBtn.addEventListener('click', withTap(() => this.resolve(false)));

                const confirmBtn = document.createElement('button');
                confirmBtn.textContent = opts.confirmLabel;
                confirmBtn.className = `btn btn-${opts.confirmRole ?? 'primary'} btn-md`;
                confirmBtn.style.flex = '1';
                confirmBtn.addEventListener('click', withTap(() => this.resolve(true)));

                row.appendChild(cancelBtn);
                row.appendChild(confirmBtn);
                box.appendChild(row);
            });

            this.overlay.setDimmed(true);
            DomUiRoot.instance.mount(this.overlay.element);
            this.overlay.show();
        });
    }

    private resolve(value: boolean): void {
        this.overlay.hide();
        DomUiRoot.instance.unmount(this.overlay.element);
        this.resolveCurrent?.(value);
        this.resolveCurrent = null;
    }
}

export const ConfirmationPopup = ConfirmationPopupService.instance;
