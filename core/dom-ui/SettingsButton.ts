import { DomUiRoot } from './DomUiRoot';
import { ModalOverlay } from './ModalOverlay';
import settingsIcon from './images/settings.png';
import closeIcon from './images/Icon_Close02.png';

/**
 * Persistent top-left gear button — opens a small, truly-centered menu (via
 * its own dimmed ModalOverlay) whose content is entirely supplied by the
 * caller, since what belongs in Settings is game-specific (e.g. clog's Clear
 * Data). Meant to sit at the top-left corner with SoundToggleButton shifted
 * right to make room for it (see BaseDemoScene).
 *
 * Dimmed while open (see ModalOverlay.setDimmed) so it reads as a true
 * blocking screen — same "world/UI dimmed and unclickable behind it"
 * treatment as PlayerFlowController's Shop/End Game screens — closable via
 * the top-right X (same icon/shape as ShopScreen's closeButton) or by
 * clicking the dimmed backdrop itself.
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
        this.element.title = 'Settings';

        const icon = document.createElement('img');
        icon.src = settingsIcon;
        Object.assign(icon.style, { width: '20px', height: '20px' });
        this.element.appendChild(icon);

        this.element.addEventListener('click', () => this.open());

        // Clicking the backdrop itself (not something bubbling up from the
        // centered box or the close button) closes the menu — the box/close
        // button both opt into pointerEvents:auto and sit above the backdrop,
        // so a click landing on the backdrop always reports the overlay's own
        // element as the target.
        this.overlay.element.addEventListener('click', (e) => {
            if (e.target === this.overlay.element) this.close();
        });

        DomUiRoot.instance.mount(this.element);
        DomUiRoot.instance.mount(this.overlay.element);
    }

    private open(): void {
        this.overlay.setFullContent(root => {
            root.appendChild(this.closeButton());

            const box = document.createElement('div');
            Object.assign(box.style, {
                position: 'fixed',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '280px',
                maxWidth: '90vw',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: 'rgba(24, 24, 32, 0.96)',
                color: '#fff',
                borderRadius: '12px',
                padding: '24px 28px',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
                fontFamily: 'inherit',
                pointerEvents: 'auto',
            });
            this.buildMenu(box, () => this.close());
            root.appendChild(box);
        });
        this.overlay.setDimmed(true);
        this.overlay.show();
    }

    /** Same top-right circular X as ShopScreen.closeButton (PlayerFlowController) — kept as its own copy since core/ can't depend on a game-specific file. */
    private closeButton(): HTMLElement {
        const wrap = document.createElement('div');
        Object.assign(wrap.style, { position: 'fixed', top: '20px', right: '20px', pointerEvents: 'auto' });

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

        btn.addEventListener('click', () => this.close());
        wrap.appendChild(btn);
        return wrap;
    }

    private close(): void {
        this.overlay.hide();
        this.overlay.setDimmed(false);
    }

    destroy(): void {
        DomUiRoot.instance.unmount(this.element);
        DomUiRoot.instance.unmount(this.overlay.element);
        this.overlay.destroy();
    }
}
