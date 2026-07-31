import { DomUiRoot } from './DomUiRoot';

/**
 * Dead-simple centered spinner — shown while the player's FBX mesh/animations
 * load (see PizzaScene.setupThirdPersonCharacter), removed the instant that
 * resolves. Pure CSS spin, no image asset, no dependency on the 3D scene
 * being ready yet.
 */
export class LoadingSpinner {
    private readonly element: HTMLDivElement;

    constructor() {
        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            width: '64px',
            height: '64px',
            marginTop: '-32px',
            marginLeft: '-32px',
            borderRadius: '50%',
            border: '6px solid rgba(255, 255, 255, 0.25)',
            borderTopColor: '#ffffff',
            animation: 'pizza-loading-spin 0.8s linear infinite',
            pointerEvents: 'none',
        });

        if (!document.getElementById('pizza-loading-spin-keyframes')) {
            const style = document.createElement('style');
            style.id = 'pizza-loading-spin-keyframes';
            style.textContent = '@keyframes pizza-loading-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }

        DomUiRoot.instance.mount(this.element);
    }

    destroy(): void {
        DomUiRoot.instance.unmount(this.element);
    }
}
