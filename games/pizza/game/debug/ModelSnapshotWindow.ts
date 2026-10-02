// ModelSnapshotWindow.ts
//
// A floating DOM window for ModelSnapshotTool — replaces its old dev-GUI folder. Mounted only
// when the page is opened with ?snap=1 (see PizzaScene.setupDebugGui()), independent of ?dev.
//
// What it adds over the old folder: pick a model (group filter + search + prev/next), see a
// LIVE preview of exactly what will be downloaded (same renderer, same framing — see
// ModelSnapshotTool.renderPreview()) along with its pixel size and filename, tweak the settings
// and watch the preview update, then download. Every control writes straight into
// ModelSnapshotTool.settings, so the batch buttons (group / all / random) use the same settings.
//
// Plain DOM appended to document.body — not DomUiRoot, which is the scaled player-facing UI.
// Draggable by its title bar, collapsible; key presses inside it don't reach the game.

import { ModelSnapshotTool } from './ModelSnapshotTool';

const ROOT_ID = 'pizza-model-snapshot-window';
const PREVIEW_DEBOUNCE_MS = 120;
const ALL_GROUPS = '';

type NumberSettingKey = 'pixelsPerWorldUnit' | 'portraitDistance' | 'portraitPitchDeg' | 'portraitYawDeg' | 'portraitTextureSizePx' | 'portraitPaddingPercent';

const STYLE = `
#${ROOT_ID} { position: fixed; top: 12px; right: 12px; width: 340px; z-index: 100000; background: #1e2128; color: #e6e6e6;
  font: 12px/1.4 system-ui, sans-serif; border: 1px solid #3a3f4b; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.45); user-select: none; }
#${ROOT_ID} .msw-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #2a2e37; border-radius: 8px 8px 0 0; cursor: move; font-weight: 600; }
#${ROOT_ID} .msw-head span { flex: 1; }
#${ROOT_ID} .msw-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 80px); overflow-y: auto; }
#${ROOT_ID}.collapsed .msw-body { display: none; }
#${ROOT_ID} .msw-row { display: flex; gap: 6px; align-items: center; }
#${ROOT_ID} .msw-row > label { width: 92px; flex: none; color: #aab; }
#${ROOT_ID} select, #${ROOT_ID} input[type=text], #${ROOT_ID} input[type=number] { flex: 1; min-width: 0; background: #14161b; color: #e6e6e6; border: 1px solid #3a3f4b; border-radius: 4px; padding: 3px 5px; font: inherit; }
#${ROOT_ID} input[type=range] { flex: 1; min-width: 0; }
#${ROOT_ID} input[type=number] { flex: none; width: 58px; }
#${ROOT_ID} .msw-list { width: 100%; height: 120px; }
#${ROOT_ID} button { background: #3b6fd8; color: #fff; border: 0; border-radius: 4px; padding: 5px 8px; font: inherit; cursor: pointer; }
#${ROOT_ID} button:hover { background: #4d80e8; }
#${ROOT_ID} button.msw-secondary { background: #3a3f4b; }
#${ROOT_ID} button.msw-secondary:hover { background: #4a5060; }
#${ROOT_ID} .msw-head button { padding: 1px 8px; }
#${ROOT_ID} .msw-preview { height: 220px; display: flex; align-items: center; justify-content: center; border-radius: 6px; overflow: hidden;
  background: repeating-conic-gradient(#2c2f36 0% 25%, #23262c 0% 50%) 50% / 16px 16px; }
#${ROOT_ID} .msw-preview img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
#${ROOT_ID} .msw-meta { color: #aab; word-break: break-all; }
#${ROOT_ID} .msw-meta b { color: #e6e6e6; font-weight: 600; }
#${ROOT_ID} .msw-section { border-top: 1px solid #3a3f4b; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
#${ROOT_ID} .msw-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#${ROOT_ID} .msw-status { color: #f5c542; min-height: 16px; }
`;

export class ModelSnapshotWindow {
    private static mounted = false;

    /** Mounts the window once. Called by PizzaScene when the page has ?snap=1. */
    public static mount(): void {
        if (this.mounted || document.getElementById(ROOT_ID)) {
            return;
        }
        this.mounted = true;
        new ModelSnapshotWindow();
    }

    private readonly root: HTMLDivElement;
    private readonly groupSelect: HTMLSelectElement;
    private readonly searchInput: HTMLInputElement;
    private readonly modelList: HTMLSelectElement;
    private readonly previewImage: HTMLImageElement;
    private readonly meta: HTMLDivElement;
    private readonly status: HTMLDivElement;
    private readonly portraitSection: HTMLDivElement;
    private readonly fillSection: HTMLDivElement;

    private previewTimer?: number;
    /** Bumped per preview request — a slower, older render finishing late is ignored. */
    private previewToken = 0;

    private constructor() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);

        this.root = document.createElement('div');
        this.root.id = ROOT_ID;
        // The game listens for movement keys on the window — keep typing in here from walking the player.
        for (const type of ['keydown', 'keyup', 'keypress']) {
            this.root.addEventListener(type, event => event.stopPropagation());
        }

        const head = this.el('div', 'msw-head');
        head.append(this.el('span', '', 'Model Snapshots'));
        const collapseButton = this.button('–', () => {
            const collapsed = this.root.classList.toggle('collapsed');
            collapseButton.textContent = collapsed ? '+' : '–';
        }, true);
        head.append(collapseButton);
        this.makeDraggable(head);

        const body = this.el('div', 'msw-body');
        this.root.append(head, body);

        // ---- model picker
        this.groupSelect = document.createElement('select');
        this.groupSelect.append(new Option('All groups', ALL_GROUPS));
        for (const group of ModelSnapshotTool.listGroups()) {
            this.groupSelect.append(new Option(group, group));
        }
        this.groupSelect.value = ModelSnapshotTool.settings.selectedGroup || ALL_GROUPS;
        this.groupSelect.onchange = () => {
            ModelSnapshotTool.settings.selectedGroup = this.groupSelect.value;
            this.refreshModelList();
        };

        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search models…';
        this.searchInput.oninput = () => this.refreshModelList();

        this.modelList = document.createElement('select');
        this.modelList.className = 'msw-list';
        this.modelList.size = 8;
        this.modelList.onchange = () => this.selectModel(this.modelList.value);

        const stepRow = this.el('div', 'msw-row');
        stepRow.append(
            this.button('◀ Prev', () => this.step(-1), true),
            this.button('Next ▶', () => this.step(1), true),
        );

        body.append(this.row('Group', this.groupSelect), this.row('Search', this.searchInput), this.modelList, stepRow);

        // ---- preview
        const preview = this.el('div', 'msw-preview');
        this.previewImage = document.createElement('img');
        this.previewImage.alt = '';
        preview.append(this.previewImage);
        this.meta = this.el('div', 'msw-meta');
        body.append(preview, this.meta);

        // ---- settings
        const settings = this.el('div', 'msw-section');
        const modeSelect = document.createElement('select');
        modeSelect.append(new Option('Top-down (Tiled placeholder)', 'topdown'), new Option('Portrait (icon)', 'portrait'));
        modeSelect.value = ModelSnapshotTool.settings.portraitMode ? 'portrait' : 'topdown';
        modeSelect.onchange = () => {
            ModelSnapshotTool.settings.portraitMode = modeSelect.value === 'portrait';
            this.refreshSections();
            this.schedulePreview();
        };
        settings.append(this.row('Mode', modeSelect), this.numberRow('Px / world unit', 'pixelsPerWorldUnit', 1, 64, 1));

        this.portraitSection = this.el('div', 'msw-section');
        this.portraitSection.append(
            this.numberRow('Distance', 'portraitDistance', 1, 30, 0.5),
            this.numberRow('Pitch °', 'portraitPitchDeg', -89, 89, 1),
            this.numberRow('Yaw °', 'portraitYawDeg', -180, 180, 1),
            this.checkboxRow('Fill texture', ModelSnapshotTool.settings.portraitFillTexture, value => {
                ModelSnapshotTool.settings.portraitFillTexture = value;
                this.refreshSections();
                this.schedulePreview();
            }),
        );
        this.fillSection = this.el('div', 'msw-section');
        this.fillSection.append(
            this.numberRow('Texture px', 'portraitTextureSizePx', 32, 2048, 32),
            this.numberRow('Padding %', 'portraitPaddingPercent', 0, 45, 1),
        );
        this.portraitSection.append(this.fillSection);
        settings.append(this.portraitSection);
        body.append(settings);

        // ---- actions
        const actions = this.el('div', 'msw-section');
        const buttons = this.el('div', 'msw-buttons');
        buttons.append(
            this.button('Download this', () => this.run('Downloading…', () => ModelSnapshotTool.snapshotOne(ModelSnapshotTool.settings.selectedModelRef))),
            this.button('Download group', () => {
                const group = this.groupSelect.value;
                if (!group) {
                    this.setStatus('Pick a group first.');
                    return;
                }
                void this.run(`Downloading group ${group}…`, () => ModelSnapshotTool.snapshotGroup(group));
            }, true),
            this.button('Random', () => this.run('Downloading a random model…', () => ModelSnapshotTool.snapshotRandom()), true),
            this.button('Download ALL', () => {
                if (window.confirm(`Download a snapshot of all ${ModelSnapshotTool.listModelRefs().length} models?`)) {
                    void this.run('Downloading every model…', () => ModelSnapshotTool.snapshotAll());
                }
            }, true),
        );
        this.status = this.el('div', 'msw-status');
        actions.append(buttons, this.status);
        body.append(actions);

        document.body.appendChild(this.root);
        this.refreshSections();
        this.refreshModelList();
    }

    // ---- model picking

    private filteredRefs(): string[] {
        const group = this.groupSelect.value;
        const refs = group ? ModelSnapshotTool.listModelRefsInGroup(group) : ModelSnapshotTool.listModelRefs();
        const query = this.searchInput.value.trim().toLowerCase();
        return query ? refs.filter(ref => ref.toLowerCase().includes(query)) : refs;
    }

    private refreshModelList(): void {
        const refs = this.filteredRefs();
        this.modelList.replaceChildren(...refs.map(ref => new Option(ref, ref)));
        const current = ModelSnapshotTool.settings.selectedModelRef;
        this.selectModel(refs.includes(current) ? current : refs[0] ?? '');
    }

    private selectModel(ref: string): void {
        ModelSnapshotTool.settings.selectedModelRef = ref;
        this.modelList.value = ref;
        this.schedulePreview();
    }

    private step(direction: number): void {
        const refs = this.filteredRefs();
        if (refs.length === 0) {
            return;
        }
        const index = refs.indexOf(ModelSnapshotTool.settings.selectedModelRef);
        this.selectModel(refs[(index + direction + refs.length) % refs.length]);
    }

    // ---- preview

    private schedulePreview(): void {
        window.clearTimeout(this.previewTimer);
        this.previewTimer = window.setTimeout(() => void this.renderPreview(), PREVIEW_DEBOUNCE_MS);
    }

    private async renderPreview(): Promise<void> {
        const ref = ModelSnapshotTool.settings.selectedModelRef;
        const token = ++this.previewToken;
        if (!ref) {
            this.previewImage.removeAttribute('src');
            this.meta.textContent = 'No model matches.';
            return;
        }
        this.meta.textContent = `Rendering ${ref}…`;
        try {
            const { dataUrl, widthPx, heightPx, filename } = await ModelSnapshotTool.renderPreview(ref);
            if (token !== this.previewToken) {
                return;
            }
            this.previewImage.src = dataUrl;
            const size = this.el('div');
            size.innerHTML = `<b>${widthPx} × ${heightPx}</b> px`;
            const name = this.el('div');
            name.textContent = filename;
            this.meta.replaceChildren(size, name);
        } catch (error) {
            if (token === this.previewToken) {
                this.previewImage.removeAttribute('src');
                this.meta.textContent = `Couldn't render ${ref} — see console.`;
                console.error('[ModelSnapshotWindow] preview failed', ref, error);
            }
        }
    }

    // ---- actions / status

    private async run(message: string, action: () => Promise<void>): Promise<void> {
        this.setStatus(message);
        await action();
        this.setStatus('Done.');
    }

    private setStatus(text: string): void {
        this.status.textContent = text;
    }

    private refreshSections(): void {
        this.portraitSection.style.display = ModelSnapshotTool.settings.portraitMode ? '' : 'none';
        this.fillSection.style.display = ModelSnapshotTool.settings.portraitFillTexture ? '' : 'none';
    }

    // ---- small DOM helpers

    private el(tag: 'div' | 'span', className = '', text?: string): HTMLDivElement {
        const element = document.createElement(tag) as HTMLDivElement;
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    private row(labelText: string, ...controls: HTMLElement[]): HTMLDivElement {
        const row = this.el('div', 'msw-row');
        const label = document.createElement('label');
        label.textContent = labelText;
        row.append(label, ...controls);
        return row;
    }

    private button(text: string, onClick: () => void, secondary = false): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        if (secondary) {
            button.className = 'msw-secondary';
        }
        button.onclick = onClick;
        return button;
    }

    /** A slider + number box pair bound to one ModelSnapshotTool.settings number. */
    private numberRow(labelText: string, key: NumberSettingKey, min: number, max: number, step: number): HTMLDivElement {
        const range = document.createElement('input');
        range.type = 'range';
        const box = document.createElement('input');
        box.type = 'number';
        for (const input of [range, box]) {
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.value = String(ModelSnapshotTool.settings[key]);
            input.oninput = () => {
                const value = Number(input.value);
                if (!Number.isFinite(value)) {
                    return;
                }
                ModelSnapshotTool.settings[key] = value;
                (input === range ? box : range).value = input.value;
                this.schedulePreview();
            };
        }
        return this.row(labelText, range, box);
    }

    private checkboxRow(labelText: string, initial: boolean, onChange: (value: boolean) => void): HTMLDivElement {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = initial;
        box.onchange = () => onChange(box.checked);
        return this.row(labelText, box);
    }

    private makeDraggable(handle: HTMLElement): void {
        handle.addEventListener('pointerdown', event => {
            if ((event.target as HTMLElement).tagName === 'BUTTON') {
                return;
            }
            const rect = this.root.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            const move = (moveEvent: PointerEvent): void => {
                const left = Math.min(Math.max(0, moveEvent.clientX - offsetX), window.innerWidth - 60);
                const top = Math.min(Math.max(0, moveEvent.clientY - offsetY), window.innerHeight - 30);
                Object.assign(this.root.style, { left: `${left}px`, top: `${top}px`, right: 'auto' });
            };
            const up = (): void => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }
}
