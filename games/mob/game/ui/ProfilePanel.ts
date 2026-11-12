// ProfilePanel.ts
//
// The player's profile (the arena's main screen, their strip tapped): their avatar (a tap: the next one), name, tier,
// trophies and the most they've had, the arena's tally (matches won, three-crown wins, played), and their battle deck.

import * as PIXI from 'pixi.js';
import { Ladder, tierBadge, tierFor } from '../data/ArenaLadder';
import gsap from 'gsap';
import { DECK_SIZE, STORY_ROW, MobSave } from '../data/MobSave';
import { AVATARS } from '../data/Profile';
import ladderFile from '../../ui/arena-ladder.json';
import { cardTile, lockedTile } from './CardTile';
import { AvatarPicker } from './AvatarPicker';
import { Overlay } from './Overlay';
import { iconSprite, killTweensDeep, label, makeAvatar, plainLabel, tappable } from './UiParts';

const SIZE = { width: 600, height: 820 };
const LADDER = ladderFile as Ladder;

export class ProfilePanel extends Overlay {
    /** `onChange`: the avatar changed (the main screen's strip redraws). */
    public constructor(private readonly onChange: () => void, onClose: () => void) {
        super(SIZE, onClose);
        this.build();
    }

    private build(): void {
        killTweensDeep(this.panel);
        this.panel.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.panel.addChild(this.back(SIZE.width, SIZE.height, 0x1b2a5a, 'PLAYER PROFILE'), this.closeButton(SIZE.width, SIZE.height));
        const record = MobSave.arena;
        const tier = LADDER.tiers[tierFor(LADDER, record)];
        // The top block: avatar (tap: the avatars to choose from), name, tier, trophies.
        const top = -SIZE.height / 2 + 110;
        const block = new PIXI.Graphics().beginFill(0x2a4a9a).drawRoundedRect(-SIZE.width / 2 + 24, top, SIZE.width - 48, 200, 22).endFill();
        const look = AVATARS[MobSave.avatar % AVATARS.length];
        const avatar = makeAvatar(look, 120);
        avatar.position.set(-SIZE.width / 2 + 110, top + 100);
        tappable(avatar, () => {
            // The picker over the profile (its own box, its own dim).
            const picker = new AvatarPicker(() => {
                this.onChange();
                this.build();
            }, () => undefined);
            this.addChild(picker);
            picker.show();
        });
        const name = label(34);
        name.anchor.set(0, 0.5);
        name.text = MobSave.username;
        name.position.set(-SIZE.width / 2 + 190, top + 50);
        const tierText = label(24, 0xc9a2ff);
        tierText.anchor.set(0, 0.5);
        tierText.text = tier.name.toUpperCase();
        tierText.position.set(-SIZE.width / 2 + 190, top + 90);
        // The grade badge, big on the block's right, its tier under it.
        const badge = iconSprite(tierBadge(LADDER, tierFor(LADDER, record)), 132);
        badge.position.set(SIZE.width / 2 - 104, top + 90);
        gsap.to(badge.scale, { x: badge.scale.x * 1.05, y: badge.scale.y * 1.05, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        const cup = iconSprite('ItemIcon_Trophy_Gold', 52);
        cup.position.set(-SIZE.width / 2 + 214, top + 146);
        const trophies = label(34, 0xffe066);
        trophies.anchor.set(0, 0.5);
        trophies.text = `${record.rating}`;
        trophies.position.set(-SIZE.width / 2 + 248, top + 146);
        const hint = plainLabel(16, 0xc9d3ff);
        hint.text = 'TAP TO CHANGE';
        hint.position.set(-SIZE.width / 2 + 110, top + 182);
        this.panel.addChild(block, avatar, name, tierText, cup, trophies, hint, badge);
        // The tally.
        // The tally: each with its icon on the left, its name and number beside.
        const stats: [string, string, string][] = [
            ['ItemIcon_Trophy_Gold', 'BEST TROPHIES', `${MobSave.bestTrophies}`],
            ['ItemIcon_Medal_Gold_1', 'WINS', `${record.won}`],
            ['Icon_Crown', 'THREE-CROWN WINS', `${MobSave.threeCrowns}`],
            ['ItemIcon_Battle', 'MATCHES PLAYED', `${record.played}`],
        ];
        stats.forEach(([frame, what, value], i) => {
            const x = i % 2 === 0 ? -140 : 140;
            const y = top + 250 + Math.floor(i / 2) * 84;
            const cell = new PIXI.Graphics().beginFill(0x10123a, 0.6).drawRoundedRect(x - 130, y - 34, 260, 70, 14).endFill();
            const icon = iconSprite(frame, 52);
            icon.position.set(x - 92, y);
            const name2 = plainLabel(16, 0x9fb4ff);
            name2.anchor.set(0, 0.5);
            name2.text = what;
            name2.position.set(x - 56, y - 14);
            const amount = label(28);
            amount.anchor.set(0, 0.5);
            amount.text = value;
            amount.position.set(x - 56, y + 14);
            this.panel.addChild(cell, icon, name2, amount);
        });
        // The battle deck.
        const deckTitle = label(28);
        deckTitle.text = 'BATTLE DECK';
        deckTitle.y = top + 440;
        this.panel.addChild(deckTitle);
        const deck = MobSave.deckSlots;
        const scale = 0.56;
        const step = 116 * scale + 8;
        // (The story row and the versus row a little apart.)
        const split = 18;
        for (let i = 0; i < DECK_SIZE; i++) {
            const kind = deck[i];
            const tile = kind ? cardTile(kind, scale, false) : lockedTile(scale, 'EMPTY', false);
            tile.position.set((i - (DECK_SIZE - 1) / 2) * step + (i < STORY_ROW ? -split / 2 : split / 2), top + 530);
            this.panel.addChild(tile);
        }
    }
}
