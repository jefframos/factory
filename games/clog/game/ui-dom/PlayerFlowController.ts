import { DomUiRoot } from '@core/dom-ui/DomUiRoot';
import { ModalOverlay } from '@core/dom-ui/ModalOverlay';
import PlatformHandler from '@core/platforms/PlatformHandler';
import { leaderboardRow, windowAround, type LeaderboardEntry } from './LeaderboardPanel';
import shopIcon from '@core/dom-ui/images/shop.png';
import videoIcon from '@core/dom-ui/images/video-icon.png';

export type DeathSnapshot = { value: number; tailValues: number[]; entries: LeaderboardEntry[] };

const DEATH_COUNTDOWN_SECONDS = 5;
const DEATH_TICK_MS = 100;
const END_GAME_WINDOW = { size: 5, ahead: 3, behind: 1 };

/**
 * Owns every "big blocking screen" in the game: the boot menu, the death/
 * respawn choice, the End Game rank screen, and the Shop/Rename sub-screens
 * shared by the menu. There is exactly one ModalOverlay — screens are
 * swapped into it, not stacked as separate scenes, since this game never
 * changes scene (see BaseDemoScene: the 3D world keeps running underneath
 * at all times; this overlay is a pure DOM layer on top of it).
 */
export class PlayerFlowController {
    private readonly overlay = new ModalOverlay();

    private playerName = randomPlayerName();
    private pendingDeath: DeathSnapshot | null = null;
    private deathCountdownHandle: number | null = null;

    private onJoin: (() => void) | null = null;
    private onRevive: ((keepSize: DeathSnapshot) => void) | null = null;
    private onContinue: (() => void) | null = null;

    constructor() {
        DomUiRoot.instance.mount(this.overlay.element);
    }

    setPlayerName(name: string): void {
        this.playerName = name;
    }

    /** Boot menu — also where Shop/Rename return to (see back()). */
    showMenu(onJoin: () => void): void {
        this.onJoin = onJoin;
        this.renderMenu();
        this.overlay.show();
    }

    /**
     * Shown the instant the player dies, with a countdown ring. `onRevive`
     * is called (with the pre-death snapshot, to keep their size) only if
     * they watch a video — clicking "Next" or letting the countdown run out
     * instead moves to the End Game rank screen, whose "Continue" then calls
     * `onContinue` to return to the boot menu for a fresh join.
     */
    showDeath(snapshot: DeathSnapshot, onRevive: (keepSize: DeathSnapshot) => void, onContinue: () => void): void {
        this.pendingDeath = snapshot;
        this.onRevive = onRevive;
        this.onContinue = onContinue;
        this.renderDeath();
        this.overlay.show();
    }

    destroy(): void {
        this.clearDeathCountdown();
        DomUiRoot.instance.unmount(this.overlay.element);
        this.overlay.destroy();
    }

    // ── Screens ──────────────────────────────────────────────────────────────

    private renderMenu(): void {
        this.overlay.setFullContent(root => {
            root.appendChild(menuHeading('Clog'));
            root.appendChild(cornerButton('left', pillButton('Shop', () => this.renderShop(), { icon: shopIcon })));
            root.appendChild(cornerButton('right', boostBadge(() => this.renderBoost())));
            root.appendChild(this.menuBottomSection());
        });
    }

    /** Name field + primary CTA — a fixed-width column pinned to the bottom-center of the viewport, so it reads as a mobile-sized card instead of stretching edge-to-edge on wide desktop windows. */
    private menuBottomSection(): HTMLElement {
        const section = document.createElement('div');
        Object.assign(section.style, {
            position: 'fixed',
            left: '50%',
            bottom: '32px',
            transform: 'translateX(-50%)',
            width: '340px',
            maxWidth: '90vw',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            pointerEvents: 'auto',
        });
        section.appendChild(this.nameRow());
        section.appendChild(pillButton('Tap to Start', () => {
            this.overlay.hide();
            this.onJoin?.();
        }, { primary: true, big: true }));
        return section;
    }

    private renderDeath(): void {
        this.clearDeathCountdown();
        let remainingMs = DEATH_COUNTDOWN_SECONDS * 1000;

        this.overlay.setContent(box => {
            box.appendChild(heading('You died!'));

            const { ring, setRemaining } = countdownRing(DEATH_COUNTDOWN_SECONDS);
            box.appendChild(ring);

            box.appendChild(goldButton('REVIVE?', () => this.handleWatchAd(), { icon: videoIcon }));
            box.appendChild(goldButton('NEXT', () => this.goToEndGame()));

            this.deathCountdownHandle = window.setInterval(() => {
                remainingMs -= DEATH_TICK_MS;
                if (remainingMs <= 0) {
                    this.goToEndGame();
                    return;
                }
                setRemaining(remainingMs, DEATH_COUNTDOWN_SECONDS * 1000);
            }, DEATH_TICK_MS);
        });
    }

    /** "Next," or the countdown running out — same destination either way (see showDeath). */
    private goToEndGame(): void {
        this.clearDeathCountdown();
        if (this.pendingDeath) this.renderEndGame(this.pendingDeath);
    }

    /** Full-viewport, dimmed rank screen — no boxed container, since it's meant to read as a true blocking screen rather than the light "world stays visible" overlays the rest of the flow uses. */
    private renderEndGame(snapshot: DeathSnapshot): void {
        const sorted = [...snapshot.entries].sort((a, b) => b.score - a.score);
        const youIndex = sorted.findIndex(e => e.name === 'You');
        const rank = youIndex + 1;
        const { start, end } = windowAround(sorted.length, youIndex, END_GAME_WINDOW.size, END_GAME_WINDOW.ahead, END_GAME_WINDOW.behind);

        this.overlay.setFullContent(root => {
            root.appendChild(endGameTitle());
            root.appendChild(tailChain(snapshot));

            const col = document.createElement('div');
            Object.assign(col.style, {
                position: 'fixed',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '18px',
                pointerEvents: 'auto',
            });

            const rankEl = document.createElement('div');
            rankEl.textContent = `#${rank}`;
            Object.assign(rankEl.style, { fontSize: '52px', fontWeight: 'bold', color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.7)' });
            col.appendChild(rankEl);

            const list = document.createElement('div');
            Object.assign(list.style, { width: '280px', background: 'rgba(16,20,30,0.55)', borderRadius: '10px', overflow: 'hidden' });
            for (let i = start; i <= end; i++) list.appendChild(leaderboardRow(i, sorted[i]));
            col.appendChild(list);

            col.appendChild(goldButton('CONTINUE', () => {
                this.overlay.hide();
                this.overlay.setDimmed(false);
                this.onContinue?.();
            }));

            root.appendChild(col);
        });
        this.overlay.setDimmed(true);
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

    private renderBoost(): void {
        this.overlay.setContent(box => {
            box.appendChild(heading('Boost'));
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
        this.clearDeathCountdown();
        this.overlay.hide();
        if (this.pendingDeath) this.onRevive?.(this.pendingDeath);
    }

    private clearDeathCountdown(): void {
        if (this.deathCountdownHandle !== null) {
            window.clearInterval(this.deathCountdownHandle);
            this.deathCountdownHandle = null;
        }
    }

    private saveName(value: string): void {
        const trimmed = value.trim();
        if (trimmed) this.playerName = trimmed;
        void PlatformHandler.instance.platform.setItem('playerName', this.playerName);
        this.back();
    }

    /** Shop/Rename are only ever reachable from the boot menu now (the death screen dropped them for the Revive/Next countdown flow), so "back" always means the menu. */
    private back(): void {
        this.renderMenu();
    }

    private nameRow(): HTMLElement {
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 16px',
            borderRadius: '999px',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.25)',
            boxSizing: 'border-box',
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

/** Fixed, top-center title for the edge-anchored boot menu (as opposed to `heading`'s in-flow boxed-screen style). */
function menuHeading(text: string): HTMLElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, {
        position: 'fixed',
        top: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '28px',
        fontWeight: 'bold',
        textAlign: 'center',
        textShadow: '0 2px 6px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
    });
    return h;
}

// Distance from screen-center each side button sits, fixed regardless of
// viewport width — keeps Shop/Boost near the player preview instead of
// pinned to the true (and, on wide desktop windows, far-away) screen edges.
// max(16px, ...) keeps them from overlapping/off-screen on narrow mobile widths.
const MENU_SIDE_OFFSET = 'max(16px, calc(50% - 220px))';

/** Pins a fixed-size element near the left or right of screen-center (not a flex participant), so it stays a corner-anchored HUD element on wide desktop windows instead of stretching with the page. */
function cornerButton(side: 'left' | 'right', el: HTMLElement): HTMLElement {
    Object.assign(el.style, {
        position: 'fixed',
        top: '50%',
        transform: 'translateY(-50%)',
        [side]: MENU_SIDE_OFFSET,
        pointerEvents: 'auto',
    });
    return el;
}

/** Rounded, auto-width button for the edge-anchored boot menu (as opposed to `button`'s full-width boxed-screen style). */
function pillButton(label: string, onClick: () => void, opts: { primary?: boolean; big?: boolean; icon?: string } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
        display: opts.big ? 'block' : 'inline-flex',
        width: opts.big ? '100%' : 'auto',
        boxSizing: 'border-box',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: opts.big ? '16px 24px' : '8px 18px 8px 8px',
        borderRadius: '999px',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: opts.big ? '20px' : '15px',
        fontWeight: 'bold',
        color: '#fff',
        background: opts.primary ? '#5ecf5e' : 'rgba(255,255,255,0.14)',
        boxShadow: opts.primary ? '0 6px 14px rgba(0,0,0,0.35)' : 'none',
    });

    if (opts.icon) {
        const img = document.createElement('img');
        img.src = opts.icon;
        Object.assign(img.style, { width: '24px', height: '24px', borderRadius: '50%' });
        btn.appendChild(img);
    }

    const text = document.createElement('span');
    text.textContent = label;
    btn.appendChild(text);

    btn.addEventListener('click', onClick);
    return btn;
}

/** Speech-bubble style callout for the boost feature, mirroring the reference io-game's "X16 START BIGGER" badge. */
function boostBadge(onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        borderRadius: '14px',
        border: '2px solid #6fdc6f',
        background: 'rgba(20,24,32,0.9)',
        color: '#6fdc6f',
        cursor: 'pointer',
        font: 'inherit',
    });

    const img = document.createElement('img');
    img.src = videoIcon;
    Object.assign(img.style, { width: '22px', height: '22px' });

    const labels = document.createElement('div');
    Object.assign(labels.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' });

    const title = document.createElement('div');
    title.textContent = 'BOOST';
    Object.assign(title.style, { fontSize: '16px', fontWeight: 'bold' });

    const sub = document.createElement('div');
    sub.textContent = 'Start Bigger!';
    Object.assign(sub.style, { fontSize: '10px', color: '#fff', opacity: '0.8' });

    labels.appendChild(title);
    labels.appendChild(sub);
    btn.appendChild(img);
    btn.appendChild(labels);
    btn.addEventListener('click', onClick);
    return btn;
}

const RING_SIZE = 140;

/**
 * Circular countdown for the death screen — a conic-gradient sweep masked
 * into a ring (radial-gradient mask cuts out the center, since conic-gradient
 * alone paints a filled disc) with the seconds-remaining number centered on
 * top. `setRemaining` redraws the sweep and label; call once per tick.
 */
function countdownRing(seconds: number): { ring: HTMLElement; setRemaining: (remainingMs: number, totalMs: number) => void } {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        position: 'relative',
        width: `${RING_SIZE}px`,
        height: `${RING_SIZE}px`,
        margin: '0 auto 20px',
    });

    const ringEl = document.createElement('div');
    Object.assign(ringEl.style, {
        position: 'absolute',
        inset: '0',
        borderRadius: '50%',
        filter: 'drop-shadow(0 0 8px rgba(130, 220, 140, 0.55))',
        WebkitMaskImage: 'radial-gradient(closest-side, transparent 76%, #000 78%)',
        maskImage: 'radial-gradient(closest-side, transparent 76%, #000 78%)',
    });
    wrap.appendChild(ringEl);

    const label = document.createElement('div');
    Object.assign(label.style, {
        position: 'absolute',
        inset: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '48px',
        fontWeight: 'bold',
        color: '#fff',
    });
    wrap.appendChild(label);

    const setRemaining = (remainingMs: number, totalMs: number) => {
        const deg = Math.max(0, Math.min(1, remainingMs / totalMs)) * 360;
        ringEl.style.background = `conic-gradient(from -90deg, #e8f26e 0deg, #ffb648 ${deg / 2}deg, #5ecf5e ${deg}deg, transparent ${deg}deg 360deg)`;
        label.textContent = String(Math.ceil(remainingMs / 1000));
    };
    setRemaining(seconds * 1000, seconds * 1000);

    return { ring: wrap, setRemaining };
}

/** Big green-gradient "END GAME" title, fixed top-center. */
function endGameTitle(): HTMLElement {
    const h = document.createElement('div');
    h.textContent = 'END GAME';
    Object.assign(h.style, {
        position: 'fixed',
        top: '48px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '56px',
        fontWeight: 'bold',
        letterSpacing: '2px',
        background: 'linear-gradient(#eafc9c, #4fae6a)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        filter: 'drop-shadow(0 3px 0 rgba(0,0,0,0.35))',
        pointerEvents: 'none',
    });
    return h;
}

/** Vertical stack of the player's final tail (smallest to largest, head value included), pinned to the left edge — a simplified stand-in for the reference's diagonal cube-chain trophy shot. */
function tailChain(snapshot: DeathSnapshot): HTMLElement {
    const values = [snapshot.value, ...snapshot.tailValues].sort((a, b) => a - b);

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        position: 'fixed',
        left: 'max(16px, calc(50% - 480px))',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
    });

    values.forEach((v, i) => {
        const badge = document.createElement('div');
        badge.textContent = String(v);
        Object.assign(badge.style, {
            width: '70px',
            height: '70px',
            marginTop: i === 0 ? '0' : '-14px', // slight overlap, chain-like
            borderRadius: '14px',
            background: cubeColor(v),
            border: '2px solid rgba(255,255,255,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
        });
        wrap.appendChild(badge);
    });

    return wrap;
}

function cubeColor(value: number): string {
    const hue = (Math.log2(Math.max(2, value)) * 47) % 360;
    return `hsl(${hue}, 55%, 55%)`;
}

/** Amber/gold gradient pill for the death screen's Revive/Next actions. */
function goldButton(label: string, onClick: () => void, opts: { icon?: string } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        width: '100%',
        boxSizing: 'border-box',
        padding: '14px 20px',
        marginTop: '10px',
        borderRadius: '10px',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '17px',
        fontWeight: 'bold',
        color: '#3a2a00',
        background: 'linear-gradient(#ffd873, #e8a93a)',
        boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
    });

    if (opts.icon) {
        const img = document.createElement('img');
        img.src = opts.icon;
        Object.assign(img.style, { width: '20px', height: '20px' });
        btn.appendChild(img);
    }

    const text = document.createElement('span');
    text.textContent = label;
    btn.appendChild(text);

    btn.addEventListener('click', onClick);
    return btn;
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
