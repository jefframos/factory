import { Signal } from 'signals';
import { DomUiRoot } from './DomUiRoot';
import { Localization } from '../i18n/Localization';
import wingIcon from './images/PictoIcon_Wing.png';

const SIZE = 76;
const ICON_SIZE = 36;

/**
 * Fixed bottom-right touch button — mobile's only way to trigger the held
 * (manual) boost now that mobile always drives movement via the virtual
 * joystick (AnalogInput). Desktop doesn't need this: PointerFollowInput's
 * own click-and-hold already doubles as both movement and boost there (see
 * BaseDemoScene) — this button exists purely because the joystick scheme
 * has no equivalent "hold to boost" gesture built in.
 */
export class BoostButton {
    readonly element: HTMLButtonElement;
    /** Fires whenever the held state flips — active for exactly as long as the button stays pressed, mirroring PointerFollowInput.onBoostChange. */
    public readonly onBoostChange: Signal<{ active: boolean }> = new Signal();

    private held = false;

    constructor() {
        this.element = document.createElement('button');
        Object.assign(this.element.style, {
            position: 'fixed',
            right: '24px',
            bottom: '40px',
            width: `${SIZE}px`,
            height: `${SIZE}px`,
            borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.4)',
            background: 'linear-gradient(#ffd873, #e8a93a)',
            boxShadow: '0 3px 12px rgba(0,0,0,0.4)',
            display: 'none', // shown by setEnabled(true) once actually playing
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
            boxSizing: 'border-box',
            padding: '0',
            touchAction: 'none', // this is a hold gesture, not a scroll/pan target
            userSelect: 'none',
            WebkitUserSelect: 'none',
            // Long-pressing is exactly this button's normal gesture (hold to
            // boost) — without these, that same press triggers iOS/Android's
            // native long-press UI (text-selection handles, "Look Up"/image
            // context menu, tap highlight flash) instead of/on top of our own
            // press handling.
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
            // Rendered as a background-image (below), not an <img> element —
            // sidesteps the "long-press an image -> Look Up/Save Image" OS
            // gesture entirely, since there's no <img> node for it to hook.
            backgroundImage: `url(${wingIcon})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: `${ICON_SIZE}px ${ICON_SIZE}px`,
        });
        this.refreshTitle();
        Localization.onLocaleChange.add(this.refreshTitle, this);
        // Extra safety net for skins/WebViews that still raise a context
        // menu on long-press regardless of the CSS above.
        this.element.addEventListener('contextmenu', (e) => e.preventDefault());

        // Pointer events (not click): a held boost needs press/release, not a
        // single tap completion. setPointerCapture keeps the up/cancel event
        // targeting this element even if the finger drifts off it mid-hold —
        // without it, a touch-move that leaves the button's bounds could
        // leave the boost stuck on with no matching pointerup ever reaching
        // this element.
        this.element.addEventListener('pointerdown', this.onPointerDown);
        this.element.addEventListener('pointerup', this.onPointerUp);
        this.element.addEventListener('pointercancel', this.onPointerUp);
        // Alt-tab / window-blur mid-hold safety net — same reasoning as
        // PointerFollowInput's own 'blur' listener.
        window.addEventListener('blur', this.onPointerUp);

        DomUiRoot.instance.mount(this.element);
    }

    private refreshTitle(): void {
        this.element.title = Localization.getString('boostButtonLabel');
    }

    private onPointerDown = (e: PointerEvent): void => {
        e.preventDefault();
        try { this.element.setPointerCapture(e.pointerId); } catch { /* unsupported — pointerup still fires normally */ }
        if (this.held) return;
        this.held = true;
        this.onBoostChange.dispatch({ active: true });
    };

    private onPointerUp = (): void => {
        if (!this.held) return;
        this.held = false;
        this.onBoostChange.dispatch({ active: false });
    };

    /** Shows/enables (or hides/disables) the button — off while not actually playing (boot/death menu), mirroring AnalogInput/PointerFollowInput.setEnabled. Force-releases an in-progress hold so disabling mid-press can't leave the boost stuck on. */
    setEnabled(enabled: boolean): void {
        this.element.style.display = enabled ? 'flex' : 'none';
        if (!enabled) this.onPointerUp();
    }

    /**
     * Whether a screen-space point (raw CSS-pixel, i.e. PointerEvent.clientX/Y)
     * falls within this button's current on-screen bounds — see
     * AnalogInput.setExclusionZone, which this feeds so a second finger
     * pressing this button can't also start/hijack the joystick underneath.
     * Reads the live bounding rect rather than a cached one, so it stays
     * correct across resizes/orientation changes; returns false while
     * hidden (getBoundingClientRect collapses to a zero rect).
     */
    containsPoint(clientX: number, clientY: number): boolean {
        const rect = this.element.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    destroy(): void {
        this.element.removeEventListener('pointerdown', this.onPointerDown);
        this.element.removeEventListener('pointerup', this.onPointerUp);
        this.element.removeEventListener('pointercancel', this.onPointerUp);
        window.removeEventListener('blur', this.onPointerUp);
        Localization.onLocaleChange.remove(this.refreshTitle, this);
        DomUiRoot.instance.unmount(this.element);
    }
}
