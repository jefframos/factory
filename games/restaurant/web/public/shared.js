// Small helpers shared by every editor tab: fetch wrapper, DOM builder, modal dialog and toasts.

export async function api(path, options) {
    const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error ?? response.statusText);
    }
    return body;
}

/** el('div', { class: 'x', onclick }, child, 'text') */
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key in node && typeof value !== 'string') node[key] = value;
        else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child === undefined || child === null || child === false) continue;
        node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
}

/**
 * Opens a modal dialog. Returns { close, body, footer }.
 * Esc and backdrop clicks close it (unless `persistent`).
 */
export function openModal({ title, wide = false, onClose, persistent = false }) {
    const body = el('div', { class: 'modal-body' });
    const footer = el('div', { class: 'modal-footer' });
    const closeButton = el('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: () => close() }, '✕');
    const dialog = el('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
        el('header', { class: 'modal-header' }, el('h3', {}, title), closeButton),
        body,
        footer);
    const backdrop = el('div', { class: 'modal-backdrop' }, dialog);

    function close() {
        window.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        onClose?.();
    }
    function onKey(event) {
        if (event.key === 'Escape' && !persistent) {
            event.stopPropagation();
            close();
        }
    }
    backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop && !persistent) close();
    });
    window.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    return { close, body, footer, dialog };
}

export const isModalOpen = () => Boolean(document.querySelector('.modal-backdrop'));

let toastTimer;
export function toast(message, kind = 'info') {
    let host = document.getElementById('toast');
    if (!host) {
        host = el('div', { id: 'toast' });
        document.body.append(host);
    }
    host.textContent = message;
    host.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => host.classList.remove('show'), 3200);
}

/** Runs `task(item)` for a list one at a time — used for thumbnail rendering. */
export function createQueue() {
    const pending = [];
    let running = false;
    async function pump() {
        if (running) return;
        running = true;
        while (pending.length) {
            const job = pending.shift();
            try { await job(); } catch (error) { console.warn(error); }
        }
        running = false;
    }
    return (job) => { pending.push(job); void pump(); };
}
