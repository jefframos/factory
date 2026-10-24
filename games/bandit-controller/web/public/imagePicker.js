// Image picker popup for the UI kit: filter by source, search, large preview with natural size.

import { el, openModal } from './shared.js';

export const imageUrl = (image) => `/ui-images/${image.source}/${encodeURIComponent(image.name)}.png`;

const SOURCE_LABELS = { all: 'All', game: 'In this game', pizza: 'Pizza (imported on save)' };

/**
 * @param {{ images: {name:string, source:string}[], current?: string|null, onPick: (image) => void }} options
 */
export function openImagePicker({ images, current = null, title = 'Choose an image', onPick }) {
    // The same name may exist in both sources; the game's copy wins.
    const byName = new Map();
    for (const image of images) {
        if (!byName.has(image.name) || image.source === 'game') byName.set(image.name, image);
    }
    const unique = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

    let selected = unique.find((image) => image.name === current) ?? null;
    let source = 'all';
    let query = '';

    const modal = openModal({ title, wide: true });
    modal.dialog.classList.add('picker');
    const search = el('input', { class: 'search', type: 'search', placeholder: 'Search images…' });
    const count = el('span', { class: 'muted' });
    const chips = el('div', { class: 'chips' });
    const grid = el('div', { class: 'grid images' });
    const left = el('div', { class: 'picker-main' }, el('div', { class: 'picker-tools' }, search, count), chips, grid);

    const previewImage = el('img', { alt: '' });
    const previewBox = el('div', { class: 'preview-image checker' }, previewImage);
    const nameLabel = el('div', { class: 'preview-name' }, 'Select an image');
    const meta = el('div', { class: 'muted small' });
    const note = el('div', { class: 'note', hidden: true });
    const right = el('aside', { class: 'picker-side' }, previewBox, nameLabel, meta, note);
    modal.body.append(el('div', { class: 'picker-layout' }, left, right));

    const confirm = el('button', { class: 'primary', disabled: true, onclick: () => pick() }, 'Use image');
    modal.footer.append(el('span', { class: 'muted' }, 'Double-click an image to use it right away.'), el('span', { class: 'spacer' }),
        el('button', { onclick: () => modal.close() }, 'Cancel'), confirm);

    function pick() {
        if (!selected) return;
        const image = selected;
        modal.close();
        onPick(image);
    }

    function select(image) {
        selected = image;
        grid.querySelectorAll('.card.selected').forEach((card) => card.classList.remove('selected'));
        grid.querySelector(`.card[data-name="${CSS.escape(image.name)}"]`)?.classList.add('selected');
        nameLabel.textContent = image.name;
        previewImage.src = imageUrl(image);
        previewImage.onload = () => { meta.textContent = `${previewImage.naturalWidth} × ${previewImage.naturalHeight} px`; };
        note.hidden = image.source === 'game';
        note.textContent = 'Not in this game yet — it will be copied from the pizza game when you save. Then run “Pack atlas”.';
        confirm.disabled = false;
    }

    function renderChips() {
        chips.replaceChildren(...Object.entries(SOURCE_LABELS).map(([key, label]) => el('button', {
            class: `chip${key === source ? ' active' : ''}`,
            onclick: () => { source = key; renderChips(); renderGrid(); },
        }, label)));
    }

    function renderGrid() {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const visible = unique.filter((image) => (source === 'all' || image.source === source)
            && terms.every((term) => image.name.toLowerCase().includes(term)));
        count.textContent = `${visible.length} image${visible.length === 1 ? '' : 's'}`;
        grid.replaceChildren(...visible.map((image) => el('div', {
            class: `card${image.name === selected?.name ? ' selected' : ''}`,
            dataset: { name: image.name },
            title: image.name,
            onclick: () => select(image),
            ondblclick: () => { select(image); pick(); },
        }, el('div', { class: 'thumb checker' }, el('img', { src: imageUrl(image), loading: 'lazy', alt: '', draggable: false })),
        el('div', { class: 'label' }, image.name),
        image.source === 'pizza' ? el('div', { class: 'badge' }, 'pizza') : null)));
        grid.querySelector('.card.selected')?.scrollIntoView({ block: 'center' });
    }

    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    renderChips();
    renderGrid();
    if (selected) select(selected);
    search.focus();
}
