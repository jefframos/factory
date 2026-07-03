import { DomUiRoot } from '@core/dom-ui/DomUiRoot';
import { ModalOverlay } from '@core/dom-ui/ModalOverlay';
import PlatformHandler from '@core/platforms/PlatformHandler';

export type DeathSnapshot = { value: number; tailValues: number[] };

type ReturnScreen = 'menu' | 'death';

/**
 * Owns every "big blocking screen" in the game: the boot menu, the death/
 * respawn choice, and the Shop/Rename sub-screens shared by both. There is
 * exactly one ModalOverlay — screens are swapped into it, not stacked as
 * separate scenes, since this game never changes scene (see BaseDemoScene:
 * the 3D world keeps running underneath at all times; this overlay is a
 * pure DOM layer on top of it).
 */
export class PlayerFlowController {
    private readonly overlay = new ModalOverlay();

    private playerName = randomPlayerName();
    private returnTo: ReturnScreen = 'menu';
    private pendingDeath: DeathSnapshot | null = null;

    private onJoin: (() => void) | null = null;
    private onRespawnChoice: ((keepSize: DeathSnapshot | null) => void) | null = null;
    private onJoinAnother: (() => void) | null = null;

    constructor() {
        DomUiRoot.instance.mount(this.overlay.element);
    }

    setPlayerName(name: string): void {
        this.playerName = name;
    }

    /** Boot menu, and the screen "Join Another Server" from the death screen returns to. */
    showMenu(onJoin: () => void): void {
        this.onJoin = onJoin;
        this.returnTo = 'menu';
        this.renderMenu();
        this.overlay.show();
    }

    /**
     * Shown the instant the player dies. `onRespawnChoice` is called with
     * the pre-death snapshot if they choose to watch a video (keep their
     * size), or null for a fresh respawn. `onJoinAnother` resets to the menu
     * instead of respawning immediately.
     */
    showDeath(snapshot: DeathSnapshot, onRespawnChoice: (keepSize: DeathSnapshot | null) => void, onJoinAnother: () => void): void {
        this.pendingDeath = snapshot;
        this.onRespawnChoice = onRespawnChoice;
        this.onJoinAnother = onJoinAnother;
        this.returnTo = 'death';
        this.renderDeath();
        this.overlay.show();
    }

    destroy(): void {
        DomUiRoot.instance.unmount(this.overlay.element);
        this.overlay.destroy();
    }

    // ── Screens ──────────────────────────────────────────────────────────────

    private renderMenu(): void {
        this.overlay.setContent(box => {
            box.appendChild(heading('Clog'));
            box.appendChild(this.nameRow());
            box.appendChild(button('Shop', () => this.renderShop()));
            box.appendChild(button('Join Server', () => {
                this.overlay.hide();
                this.onJoin?.();
            }, { primary: true }));
        });
    }

    private renderDeath(): void {
        this.overlay.setContent(box => {
            box.appendChild(heading('You died!'));
            box.appendChild(button('Watch Video to Respawn (keep size)', () => this.handleWatchAd(), { primary: true }));
            box.appendChild(button('Respawn Now', () => {
                this.overlay.hide();
                this.onRespawnChoice?.(null);
            }));
            box.appendChild(button('Shop', () => this.renderShop()));
            box.appendChild(button('Rename', () => this.renderRename()));
            box.appendChild(button('Join Another Server', () => {
                this.onJoinAnother?.();
            }));
        });
    }

    private renderShop(): void {
        this.overlay.setContent(box => {
            box.appendChild(heading('Shop'));
            const note = document.createElement('div');
            note.textContent = 'Coming soon.';
            Object.assign(note.style, { opacity: '0.7', textAlign: 'center', marginBottom: '14px' });
            box.appendChild(note);
            box.appendChild(button('Back', () => this.back()));
        });
    }

    private renderRename(): void {
        this.overlay.setContent(box => {
            box.appendChild(heading('Rename'));

            const input = document.createElement('input');
            input.type = 'text';
            input.value = this.playerName;
            input.maxLength = 16;
            Object.assign(input.style, {
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: 'none',
                marginBottom: '10px',
                boxSizing: 'border-box',
                font: 'inherit',
            });
            box.appendChild(input);

            box.appendChild(button('Save', () => this.saveName(input.value), { primary: true }));
            box.appendChild(button('Back', () => this.back()));
        });
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    private async handleWatchAd(): Promise<void> {
        // PokiPlatform (and CrazyGamesPlatform) currently resolve
        // showRewardedVideo() as Promise<void> in practice — a pre-existing
        // mismatch against IPlatformConnection's declared Promise<boolean>
        // (no platform implementation actually returns a completion signal
        // right now). There's no reliable "did they actually finish
        // watching" flag to check, so this grants the reward as soon as the
        // call resolves — matching every current platform's own behavior.
        await PlatformHandler.instance.platform.showRewardedVideo();
        this.overlay.hide();
        this.onRespawnChoice?.(this.pendingDeath);
    }

    private saveName(value: string): void {
        const trimmed = value.trim();
        if (trimmed) this.playerName = trimmed;
        void PlatformHandler.instance.platform.setItem('playerName', this.playerName);
        this.back();
    }

    private back(): void {
        if (this.returnTo === 'menu') this.renderMenu();
        else this.renderDeath();
    }

    private nameRow(): HTMLElement {
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '14px',
        });

        const label = document.createElement('span');
        label.textContent = this.playerName;
        Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'bold' });

        const renameIcon = document.createElement('button');
        renameIcon.textContent = '✏️';
        renameIcon.title = 'Rename';
        Object.assign(renameIcon.style, {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0',
            lineHeight: '1',
            flexShrink: '0',
        });
        renameIcon.addEventListener('click', () => this.renderRename());

        row.appendChild(label);
        row.appendChild(renameIcon);
        return row;
    }
}

// ── Name generation ──────────────────────────────────────────────────────────

const NAME_ADJECTIVES = ['Swift', 'Brave', 'Lucky', 'Shiny', 'Quick', 'Bold', 'Sneaky', 'Mighty', 'Chubby', 'Rusty'];
const NAME_ANIMALS = ['Fox', 'Wolf', 'Otter', 'Hawk', 'Panda', 'Tiger', 'Shark', 'Eagle', 'Slug', 'Newt'];

function randomPlayerName(): string {
    const adjective = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
    const animal = NAME_ANIMALS[Math.floor(Math.random() * NAME_ANIMALS.length)];
    const suffix = Math.floor(Math.random() * 100);
    return `${adjective}${animal}${suffix}`;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function heading(text: string): HTMLElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, { fontSize: '20px', fontWeight: 'bold', textAlign: 'center', marginBottom: '14px' });
    return h;
}

function button(label: string, onClick: () => void, opts: { primary?: boolean } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    styleButton(btn, opts);
    btn.addEventListener('click', onClick);
    return btn;
}

function styleButton(btn: HTMLButtonElement, opts: { primary?: boolean }): void {
    Object.assign(btn.style, {
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px 14px',
        marginTop: '8px',
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: opts.primary ? 'bold' : 'normal',
        background: opts.primary ? '#4ab8f0' : 'rgba(255,255,255,0.12)',
        color: '#fff',
    });
}
