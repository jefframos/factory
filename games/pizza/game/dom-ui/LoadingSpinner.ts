import { DomUiRoot } from './DomUiRoot';

/**
 * Dead-simple centered spinner + label — shown while the player's FBX mesh/animations
 * load (see PizzaScene.loadPlayerCharacter()), removed the instant that resolves. Pure CSS
 * spin, no image asset, no dependency on the 3D scene being ready yet.
 */
export class LoadingSpinner {
    /** Wraps the spinner + label so both center together as one unit — see constructor(). */
    private readonly container: HTMLDivElement;
    private readonly element: HTMLDivElement;
    private readonly label: HTMLDivElement;

    constructor(labelText: string = 'Loading Player') {
        this.container = document.createElement('div');
        Object.assign(this.container.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            pointerEvents: 'none',
        });

        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            border: '6px solid rgba(255, 255, 255, 0.25)',
            borderTopColor: '#ffffff',
            animation: 'pizza-loading-spin 0.8s linear infinite',
        });

        this.label = document.createElement('div');
        this.label.textContent = labelText;
        Object.assign(this.label.style, {
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: '16px',
            textAlign: 'center',
        });

        this.container.appendChild(this.element);
        this.container.appendChild(this.label);

        if (!document.getElementById('pizza-loading-spin-keyframes')) {
            const style = document.createElement('style');
            style.id = 'pizza-loading-spin-keyframes';
            style.textContent = '@keyframes pizza-loading-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }

        DomUiRoot.instance.mount(this.container);
    }

    destroy(): void {
        DomUiRoot.instance.unmount(this.container);
    }
}
