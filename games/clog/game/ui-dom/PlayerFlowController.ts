import * as PIXI from 'pixi.js';
import { DomUiRoot } from '../dom-ui/DomUiRoot';
import { ModalOverlay } from '../dom-ui/ModalOverlay';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { leaderboardRow, windowAround, type LeaderboardEntry } from './LeaderboardPanel';
import { renderShopScreen } from './ShopScreen';
import { HighScoreStorage } from '../data/HighScoreStorage';
import { Localization } from '../i18n/Localization';
import shopIcon from '../dom-ui/images/shop.png';
import videoIcon from '../dom-ui/images/video-icon.png';
import whaleLogo from '../dom-ui/images/whaleLogo.png';
import trophyIcon from '../dom-ui/images/ItemIcon_Trophy_Gold-2.png';

export type DeathSnapshot = { value: number; tailValues: number[]; entries: LeaderboardEntry[] };

/** Mirrors the .btn-* role classes in ../dom-ui/buttons.css. */
type BtnRole = 'primary' | 'secondary' | 'accent' | 'shop' | 'danger';

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
    private pendingIsNewHighScore = false;
    private deathCountdownHandle: number | null = null;

    private onJoin: (() => void) | null = null;
    private onRevive: ((keepSize: DeathSnapshot) => void) | null = null;
    private onEndGame: (() => void) | null = null;
    private onContinue: (() => void) | null = null;

    /** Whichever render*() call last drew the visible screen — re-invoked on a locale change so the screen currently on-screen picks up the new language (see refreshScreen). */
    private currentScreen: () => void = () => {};

    constructor() {
        DomUiRoot.instance.mount(this.overlay.element);
        Localization.onLocaleChange.add(this.refreshScreen, this);
    }

    private refreshScreen(): void {
        if (this.overlay.isVisible) this.currentScreen();
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
     * instead moves to the End Game rank screen (`onEndGame` fires right as
     * that screen appears — e.g. to hide the live in-game leaderboard, which
     * would otherwise sit redundantly next to the End Game screen's own rank
     * list), whose "Continue" then calls `onContinue` to return to the boot
     * menu for a fresh join.
     */
    showDeath(snapshot: DeathSnapshot, isNewHighScore: boolean, onRevive: (keepSize: DeathSnapshot) => void, onEndGame: () => void, onContinue: () => void): void {
        this.pendingDeath = snapshot;
        this.pendingIsNewHighScore = isNewHighScore;
        this.onRevive = onRevive;
        this.onEndGame = onEndGame;
        this.onContinue = onContinue;
        this.renderDeath();
        this.overlay.show();
    }

    destroy(): void {
        Localization.onLocaleChange.remove(this.refreshScreen, this);
        this.clearDeathCountdown();
        DomUiRoot.instance.unmount(this.overlay.element);
        this.overlay.destroy();
    }

    // ── Screens ──────────────────────────────────────────────────────────────

    private renderMenu(): void {
        this.currentScreen = () => this.renderMenu();
        this.overlay.setFullContent(root => {
            root.appendChild(gameLogo());
            root.appendChild(cornerButton('left', pillButton(Localization.getString('shop'), () => this.renderShop(), { icon: shopIcon, role: 'shop' })));
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
        section.appendChild(pillButton(Localization.getString('tapToStart'), () => {
            this.overlay.hide();
            this.onJoin?.();
        }, { role: 'primary', big: true }));
        return section;
    }

    /** Same full-viewport, dimmed-fade layout as the End Game screen (see renderEndGame) — countdown pinned top-center, Revive/Next pinned bottom-center, world still visible (dimmed, not boxed) behind it. */
    private renderDeath(): void {
        this.currentScreen = () => this.renderDeath();
        this.clearDeathCountdown();
        let remainingMs = DEATH_COUNTDOWN_SECONDS * 1000;

        this.overlay.setFullContent(root => {
            const { group, setRemaining } = deathCountdownGroup(DEATH_COUNTDOWN_SECONDS);
            root.appendChild(group);
            root.appendChild(deathBottomButtons(() => this.handleWatchAd(), () => this.goToEndGame()));

            this.deathCountdownHandle = window.setInterval(() => {
                remainingMs -= DEATH_TICK_MS;
                if (remainingMs <= 0) {
                    this.goToEndGame();
                    return;
                }
                setRemaining(remainingMs, DEATH_COUNTDOWN_SECONDS * 1000);
            }, DEATH_TICK_MS);
        });
        this.overlay.setDimmed(true);
    }

    /** "Next," or the countdown running out — same destination either way (see showDeath). */
    private goToEndGame(): void {
        this.clearDeathCountdown();
        this.onEndGame?.();
        if (this.pendingDeath) this.renderEndGame(this.pendingDeath);
    }

    /** Full-viewport, dimmed rank screen — no boxed container, since it's meant to read as a true blocking screen rather than the light "world stays visible" overlays the rest of the flow uses. */
    private renderEndGame(snapshot: DeathSnapshot): void {
        this.currentScreen = () => this.renderEndGame(snapshot);
        const sorted = [...snapshot.entries].sort((a, b) => b.score - a.score);
        const youIndex = sorted.findIndex(e => e.isYou);
        const rank = youIndex + 1;
        const { start, end } = windowAround(sorted.length, youIndex, END_GAME_WINDOW.size, END_GAME_WINDOW.ahead, END_GAME_WINDOW.behind);

        this.overlay.setFullContent(root => {
            root.appendChild(endGameTitle());

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
            rankEl.textContent = Localization.getString('rank', { rank });
            Object.assign(rankEl.style, { fontSize: '52px', fontWeight: 'bold', color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.7)' });
            col.appendChild(rankEl);

            const list = document.createElement('div');
            Object.assign(list.style, { width: '280px', background: 'rgba(16,20,30,0.55)', borderRadius: '10px', overflow: 'hidden' });
            for (let i = start; i <= end; i++) list.appendChild(leaderboardRow(i, sorted[i]));
            col.appendChild(list);

            col.appendChild(goldButton(Localization.getString('continue'), () => {
                this.overlay.hide();
                this.overlay.setDimmed(false);
                this.onContinue?.();
            }, { role: 'primary' }));

            if (this.pendingIsNewHighScore) col.appendChild(newHighScoreCallout(sorted[youIndex].score));

            root.appendChild(col);
        });
        this.overlay.setDimmed(true);
    }

    private renderShop(): void {
        this.currentScreen = () => this.renderShop();
        this.overlay.setFullContent(root => renderShopScreen(root, () => this.back()));
        this.overlay.setDimmed(true); // reads as a true blocking screen, like End Game
    }

    private renderBoost(): void {
        this.currentScreen = () => this.renderBoost();
        this.overlay.setContent(box => {
            box.appendChild(heading(Localization.getString('boostTitle')));
            const note = document.createElement('div');
            note.textContent = Localization.getString('comingSoon');
            Object.assign(note.style, { opacity: '0.7', textAlign: 'center', marginBottom: '14px' });
            box.appendChild(note);
            box.appendChild(button(Localization.getString('back'), () => this.back()));
        });
    }

    private renderRename(): void {
        this.currentScreen = () => this.renderRename();
        this.overlay.setContent(box => {
            box.appendChild(heading(Localization.getString('rename')));

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

            box.appendChild(button(Localization.getString('save'), () => this.saveName(input.value), { role: 'primary' }));
            box.appendChild(button(Localization.getString('back'), () => this.back()));
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
            background: 'linear-gradient(rgba(34,38,48,0.92), rgba(14,16,22,0.92))',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
            boxSizing: 'border-box',
        });

        const label = document.createElement('span');
        label.textContent = this.playerName;
        Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'bold' });

        const renameIcon = document.createElement('button');
        renameIcon.textContent = '✏️';
        renameIcon.title = Localization.getString('rename');
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

/** Fixed, top-center game logo for the edge-anchored boot menu — the WHALE.IO wordmark image stacked over a bigger gold "2048" line, rather than a plain text heading. */
function gameLogo(): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        position: 'fixed',
        top: '48px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0px',
        pointerEvents: 'none',
    });

    const word = document.createElement('img');
    word.src = whaleLogo;
    Object.assign(word.style, {
        width: '230px',
        height: 'auto',
        filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.45))',
    });
    wrap.appendChild(word);

    const badge = document.createElement('div');
    badge.textContent = '2048';
    Object.assign(badge.style, {
        fontSize: '30px',
        fontWeight: '900',
        letterSpacing: '1px',
        color: '#3a2a00',
        background: 'linear-gradient(#ffd873, #e8a93a)',
        padding: '4px 18px',
        borderRadius: '10px',
        transform: 'rotate(-6deg)',
        boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
        marginTop: '4px',
    });
    wrap.appendChild(badge);
    wrap.appendChild(highScoreBadge());

    return wrap;
}

/** Small trophy pill under the logo — gives the high score its own identity instead of reading as plain body text. */
function highScoreBadge(): HTMLElement {
    const pill = document.createElement('div');
    Object.assign(pill.style, {
        marginTop: '28px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 18px',
        borderRadius: '999px',
        background: 'linear-gradient(rgba(34,38,48,0.92), rgba(14,16,22,0.92))',
        border: '1px solid rgba(255,215,115,0.4)',
        boxShadow: '0 3px 12px rgba(0,0,0,0.4)',
    });

    const trophy = document.createElement('img');
    trophy.src = trophyIcon;
    Object.assign(trophy.style, { width: '22px', height: '22px', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' });
    pill.appendChild(trophy);

    const label = document.createElement('span');
    label.textContent = Localization.getString('highScoreLabel');
    Object.assign(label.style, {
        fontSize: '11px',
        fontWeight: 'bold',
        letterSpacing: '0.8px',
        color: 'rgba(255,255,255,0.75)',
    });
    pill.appendChild(label);

    const value = document.createElement('span');
    value.textContent = String(HighScoreStorage.get());
    Object.assign(value.style, {
        fontSize: '16px',
        fontWeight: '900',
        color: '#ffd873',
        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
    });
    pill.appendChild(value);

    return pill;
}

/** Shown under the End Game screen's CONTINUE button, only when this run's final score beat the pre-run best (see PlayerFlowController.pendingIsNewHighScore) — same trophy-pill skin as the boot menu's highScoreBadge, so it reads as the same "record" concept. */
function newHighScoreCallout(score: number): HTMLElement {
    const pill = document.createElement('div');
    Object.assign(pill.style, {
        marginTop: '4px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 18px',
        borderRadius: '999px',
        background: 'linear-gradient(rgba(34,38,48,0.92), rgba(14,16,22,0.92))',
        border: '1px solid rgba(255,215,115,0.4)',
        boxShadow: '0 3px 12px rgba(0,0,0,0.4)',
    });

    const trophy = document.createElement('img');
    trophy.src = trophyIcon;
    Object.assign(trophy.style, { width: '20px', height: '20px', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' });
    pill.appendChild(trophy);

    const label = document.createElement('span');
    label.textContent = Localization.getString('newHighScore', { score });
    Object.assign(label.style, {
        fontSize: '13px',
        fontWeight: '900',
        color: '#ffd873',
        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
    });
    pill.appendChild(label);

    return pill;
}

// Distance from screen-center each side button sits, fixed regardless of
// viewport width — keeps Shop/Boost near the player preview instead of
// pinned to the true (and, on wide desktop windows, far-away) screen edges.
// max(16px, ...) keeps them from overlapping/off-screen on narrow mobile widths.
const MENU_SIDE_OFFSET = 'max(16px, calc(50% - 220px))';

// Anchored from the viewport BOTTOM (not center+translateY) so the button's
// own bottom edge is exactly this far above the true bottom, with no
// half-height math to get wrong. menuBottomSection (nameRow + the big
// Tap-to-Start pill, pinned bottom:32px) is ~190px tall on short mobile
// viewports — the 190px floor keeps this clear of it there; on tall
// desktop windows, "50% - 130px" wins instead, reading as "pushed down
// from center" without needing the floor.
const MENU_SIDE_BOTTOM_OFFSET = 'max(190px, calc(50% - 130px))';

/**
 * Pins a fixed-size element near the left or right of the viewport bottom
 * (not a flex participant), so it stays a corner-anchored HUD element on
 * wide desktop windows instead of stretching with the page, and never
 * overlaps menuBottomSection regardless of viewport height (see
 * MENU_SIDE_BOTTOM_OFFSET). Wraps `el` in its own positioning div rather
 * than styling `el` directly — `el` (e.g. the boostBadge button) may want
 * its own independent `transform` (see .btn-float) without this function
 * fighting it on the same property.
 */
function cornerButton(side: 'left' | 'right', el: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        position: 'fixed',
        bottom: MENU_SIDE_BOTTOM_OFFSET,
        [side]: MENU_SIDE_OFFSET,
        pointerEvents: 'auto',
    });
    wrap.appendChild(el);
    return wrap;
}

/** Rounded, auto-width button for the edge-anchored boot menu (as opposed to `button`'s full-width boxed-screen style). */
function pillButton(label: string, onClick: () => void, opts: { role?: BtnRole; big?: boolean; icon?: string } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    const classes = ['btn', `btn-${opts.role ?? 'secondary'}`, opts.big ? 'btn-lg btn-block' : 'btn-md'];
    if (opts.icon) classes.push('btn-hug-start');
    btn.className = classes.join(' ');

    if (opts.icon) {
        const img = document.createElement('img');
        img.src = opts.icon;
        img.className = `btn-icon ${opts.big ? 'btn-icon-lg' : 'btn-icon-md'}`;
        img.style.borderRadius = '50%';
        btn.appendChild(img);
    }

    const text = document.createElement('span');
    text.textContent = label;
    btn.appendChild(text);

    btn.addEventListener('click', onClick);
    return btn;
}

/** Two-line callout for the boost feature (icon + title + subtitle), on the same accent skin as the ad-rewarded Revive button since it's the same "special edge" promo flavor. Floats continuously (see .btn-float) to stand out as a bonus, not a core action. */
function boostBadge(onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'btn btn-accent btn-md btn-hug-start btn-float';

    const img = document.createElement('img');
    img.src = videoIcon;
    img.className = 'btn-icon btn-icon-md';
    btn.appendChild(img);

    const labels = document.createElement('div');
    Object.assign(labels.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' });

    const title = document.createElement('div');
    title.textContent = Localization.getString('boostBadgeTitle');
    Object.assign(title.style, { fontSize: '16px', fontWeight: 'bold' });

    const sub = document.createElement('div');
    sub.textContent = Localization.getString('boostBadgeSubtitle');
    Object.assign(sub.style, { fontSize: '10px', opacity: '0.85' });

    labels.appendChild(title);
    labels.appendChild(sub);
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
        const remainingDeg = Math.max(0, Math.min(1, remainingMs / totalMs)) * 360;
        const elapsedDeg = 360 - remainingDeg;
        // "from 0deg" — conic-gradient's own 0deg points to 12 o'clock — and
        // the transparent (elapsed) wedge starts there and grows clockwise,
        // like an analog clock eating away the pie, instead of shrinking the
        // colored arc from the wrong (counter-clockwise) side.
        ringEl.style.background = `conic-gradient(from 0deg, transparent ${elapsedDeg}deg, #5ecf5e ${elapsedDeg}deg, #ffb648 ${elapsedDeg + remainingDeg / 2}deg, #e8f26e 360deg)`;
        label.textContent = String(Math.ceil(remainingMs / 1000));
    };
    setRemaining(seconds * 1000, seconds * 1000);

    return { ring: wrap, setRemaining };
}

/** "You died!" heading + countdown ring, pinned fixed top-center (see renderDeath). */
function deathCountdownGroup(seconds: number): { group: HTMLElement; setRemaining: (remainingMs: number, totalMs: number) => void } {
    const group = document.createElement('div');
    Object.assign(group.style, {
        position: 'fixed',
        top: '84px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
    });

    const title = document.createElement('div');
    title.textContent = Localization.getString('youDied');
    Object.assign(title.style, {
        fontSize: '32px',
        fontWeight: 'bold',
        color: '#fff',
        textShadow: '0 2px 6px rgba(0,0,0,0.6)',
        marginBottom: '8px',
    });
    group.appendChild(title);

    const { ring, setRemaining } = countdownRing(seconds);
    group.appendChild(ring);

    return { group, setRemaining };
}

/** Revive/Next, stacked in a fixed-width column pinned bottom-center (see renderDeath) — same "give it a width so it doesn't stretch edge-to-edge" treatment as the boot menu's bottom section. */
function deathBottomButtons(onRevive: () => void, onNext: () => void): HTMLElement {
    const col = document.createElement('div');
    Object.assign(col.style, {
        position: 'fixed',
        left: '50%',
        bottom: '48px',
        transform: 'translateX(-50%)',
        width: '320px',
        maxWidth: '90vw',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        pointerEvents: 'auto',
    });
    col.appendChild(goldButton(Localization.getString('revive'), onRevive, { icon: videoIcon, role: 'accent' }));
    col.appendChild(goldButton(Localization.getString('next'), onNext, { role: 'secondary' }));
    return col;
}

/** Big green-gradient "END GAME" title, fixed top-center. Smaller/bolder on mobile (see PIXI.isMobile.any) — at the desktop size, narrow viewports force this shrink-to-fit fixed-position div to wrap onto two lines, which then overlaps the rank/list column below it. */
function endGameTitle(): HTMLElement {
    const h = document.createElement('div');
    h.textContent = Localization.getString('endGame');
    Object.assign(h.style, {
        position: 'fixed',
        top: '48px',
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: PIXI.isMobile.any ? '34px' : '56px',
        fontWeight: '900',
        letterSpacing: '2px',
        whiteSpace: 'nowrap',
        background: 'linear-gradient(#eafc9c, #4fae6a)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        filter: 'drop-shadow(0 3px 0 rgba(0,0,0,0.35))',
        pointerEvents: 'none',
    });
    return h;
}

/** Full-width pill for the death screen's Revive/Next and the end-game Continue — role picks the skin (accent = ad-reward, secondary = skip, primary = main forward action). */
function goldButton(label: string, onClick: () => void, opts: { icon?: string; role?: BtnRole } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `btn btn-${opts.role ?? 'accent'} btn-lg btn-block`;
    btn.style.marginTop = '10px';

    if (opts.icon) {
        const img = document.createElement('img');
        img.src = opts.icon;
        img.className = 'btn-icon btn-icon-lg';
        btn.appendChild(img);
    }

    const text = document.createElement('span');
    text.textContent = label;
    btn.appendChild(text);

    btn.addEventListener('click', onClick);
    return btn;
}

function button(label: string, onClick: () => void, opts: { role?: BtnRole } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = `btn btn-${opts.role ?? 'secondary'} btn-md btn-block`;
    btn.style.marginTop = '8px';
    btn.addEventListener('click', onClick);
    return btn;
}
