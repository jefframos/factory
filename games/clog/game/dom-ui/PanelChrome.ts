import closeIcon from './images/Icon_Close02.png';

/**
 * Shared look for every "semi-transparent panel over the still-visible 3D
 * world" screen (Shop, Boost, Settings) — as opposed to a true blocking
 * screen like End Game or the death countdown, which dim the whole backdrop.
 * Pass to ModalOverlay.setContent's `background` option.
 */
export const PANEL_TRANSLUCENT_BACKGROUND = 'rgba(20, 20, 28, 0.75)';

/**
 * Circular close-X anchored to a ModalOverlay box's own top-right corner
 * (the box is position:relative — see ModalOverlay) rather than the full
 * viewport, so it stays with the panel regardless of where ModalOverlay
 * positions it on screen.
 */
export function panelCloseButton(onClick: () => void): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'absolute', top: '10px', right: '10px', pointerEvents: 'auto' });

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

    btn.addEventListener('click', onClick);
    wrap.appendChild(btn);
    return wrap;
}

/**
 * Panel title — bold with a hard 2px black stroke (the same 4-direction,
 * 0-blur text-shadow stack used for the shop card labels, since
 * -webkit-text-stroke doesn't render consistently across every target
 * webview) so it stays legible over the translucent panel and whatever part
 * of the 3D world shows through behind it.
 */
export function panelHeading(text: string): HTMLElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, {
        fontSize: '22px',
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: '14px',
        color: '#fff',
        textShadow: [
            '-2px -2px 0 rgba(0,0,0,0.85)',
            '2px -2px 0 rgba(0,0,0,0.85)',
            '-2px 2px 0 rgba(0,0,0,0.85)',
            '2px 2px 0 rgba(0,0,0,0.85)',
            '0 3px 6px rgba(0,0,0,0.5)',
        ].join(', '),
    });
    return h;
}
