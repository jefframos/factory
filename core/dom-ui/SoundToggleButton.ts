import SoundManager from 'core/audio/SoundManager';
import { DomUiRoot } from './DomUiRoot';
import soundOnIcon from './images/sound-on.png';
import soundOffIcon from './images/sound-off.png';

/**
 * Persistent top-left mute/unmute toggle — the DOM-UI equivalent of
 * core/ui/SoundToggleButton.ts (which is Pixi-only and expects atlas
 * texture names). Always mounted, independent of any menu/modal state.
 */
export class SoundToggleButton {
    readonly element: HTMLButtonElement;
    private readonly icon: HTMLImageElement;

    constructor() {
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

        this.icon = document.createElement('img');
        Object.assign(this.icon.style, { width: '20px', height: '20px' });
        this.element.appendChild(this.icon);

        this.element.addEventListener('click', () => SoundManager.instance.toggleMute());
        SoundManager.instance.onMuteChange.add(this.updateIcon, this);
        this.updateIcon(SoundManager.instance.isMuted);

        DomUiRoot.instance.mount(this.element);
    }

    private updateIcon(isMuted: boolean): void {
        this.icon.src = isMuted ? soundOffIcon : soundOnIcon;
        this.element.title = isMuted ? 'Unmute' : 'Mute';
    }

    destroy(): void {
        SoundManager.instance.onMuteChange.remove(this.updateIcon, this);
        DomUiRoot.instance.unmount(this.element);
    }
}
