// Profile.ts
//
// Usernames, for the player (made once, for good: UfoProgress) and the made-up players in the rankings, and the avatars the
// player can choose from: every face in every colour.

const WORDS_A = ['shadow', 'pixel', 'turbo', 'lucky', 'neon', 'cosmic', 'silent', 'crazy', 'mega', 'tiny', 'golden', 'frosty', 'ninja', 'alien', 'astro', 'captain', 'mister', 'lil', 'happy', 'wild', 'dark', 'super', 'red', 'blue', 'sneaky'];
const WORDS_B = ['fox', 'wolf', 'gamer', 'panda', 'rider', 'hunter', 'wizard', 'tiger', 'pilot', 'cat', 'dragon', 'slayer', 'king', 'bear', 'boss', 'ghost', 'comet', 'knight', 'hero', 'shark', 'owl', 'ufo', 'rocket', 'monkey', 'beast'];
const THINGS = ['pizza', 'waffle', 'cactus', 'toaster', 'pickle', 'taco', 'donut', 'banana', 'robot', 'magnet', 'marble', 'noodle', 'turnip', 'anchor', 'pretzel', 'muffin', 'mango', 'lemon', 'cookie', 'bubble', 'cloud', 'acorn', 'teapot', 'walnut', 'pumpkin'];

const FACE_COUNT = 8;
const COLORS = [0x6fc3ff, 0xff7ab8, 0x5fe87a];

export interface AvatarLook {
    face: string;
    color: number;
}

export const AVATARS: AvatarLook[] = COLORS.flatMap((color) => Array.from({ length: FACE_COUNT }, (_, i) => ({ face: `ProfileFace_s_0${i}`, color })));

/** A well-mixed number from some words: the same words always give the same one. */
export function hashWords(text: string): number {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    return (value ^ (value >>> 16)) >>> 0;
}

const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

/** A believable username from a number: made of things, never people's real names. */
export function usernameFrom(seed: number): string {
    const a = WORDS_A[seed % WORDS_A.length];
    const b = WORDS_B[(seed >>> 5) % WORDS_B.length];
    const thing = THINGS[(seed >>> 10) % THINGS.length];
    const twoDigits = (seed >>> 15) % 100;
    const year = 1995 + ((seed >>> 15) % 20);
    switch ((seed >>> 24) % 8) {
        case 0: return `${a}_${b}`;
        case 1: return `${a}${capital(b)}${twoDigits}`;
        case 2: return `${b}${year}`;
        case 3: return `${thing}${twoDigits}`;
        case 4: return `${thing}_${b}`;
        case 5: return `${a}.${b}`;
        case 6: return `${capital(thing)}${capital(b)}`;
        default: return `the_${a}_${b}`;
    }
}
