// Wardrobe.ts
//
// What the squad can wear and what the player owns: faces and hats are bought with the shared
// money (GameState). What is currently equipped lives in CharacterViews (setSquadFace/setSquadHat).

import { CHARACTER_VIEWS, FACE_OPTIONS, SQUAD_VIEW_NAMES } from './CharacterViews';
import { GameState } from './GameState';

export interface WardrobeItem {
    id: string;
    name: string;
    price: number;
}

const OWNED_KEY = 'bandit-controller.wardrobe';

const FACE_NAMES: Record<string, string> = {
    'cool': 'Cool',
    'face-smirk-1': 'Smirk',
    'face-sunglasses-2': 'Shades',
    'face-brave-1': 'Brave',
    'face-smile-1': 'Smile',
    'face-laughing-1': 'Laugh',
    'face-money-1': 'Money',
    'face-mustache-1': 'Stache',
    'face-glasses-1': 'Nerd',
    'face-star-1': 'Star',
    'face-hearts-1': 'Love',
    'cat': 'Cat',
    'dog': 'Dog',
    'panda': 'Panda',
    'pirate': 'Pirate',
    'clown': 'Clown',
    'devil': 'Devil',
    'ninja': 'Ninja',
};

const STARTER_FACES = ['skins/cool.webp', 'skins/face-smirk-1.webp', 'skins/face-sunglasses-2.webp'];

const HAT_LIST: [string, string, number][] = [
    ['Cashier_Hat', 'Cashier', 100],
    ['Chef_Hat', 'Chef', 120],
    ['Hard_Hat', 'Builder', 150],
    ['Green_Hat', 'Elf', 150],
    ['Mexican_Hat', 'Sombrero', 200],
    ['American_Hat', 'Patriot', 200],
    ['Cowboy_Hat', 'Cowboy', 250],
    ['Police_Hat', 'Police', 250],
    ['Fireman_Hat', 'Fireman', 300],
    ['Santa_Hat', 'Santa', 300],
    ['Pirate_Hat', 'Pirate', 400],
    ['Jester_Hat', 'Jester', 400],
    ['Boxing_Hat', 'Boxer', 450],
    ['Millitary_Hat', 'General', 500],
    ['Viking_Hat', 'Viking', 600],
    ['Warrior_Hat', 'Warrior', 700],
    ['Armor_Hat', 'Knight', 800],
    ['Crown', 'Crown', 1500],
];

export const FACES: WardrobeItem[] = FACE_OPTIONS.map((face, index) => ({
    id: face,
    name: FACE_NAMES[face.replace(/^skins\//, '').replace(/\.webp$/, '')] ?? 'Face',
    price: STARTER_FACES.includes(face) ? 0 : 60 + Math.floor((index - 2) / 3) * 40,
}));

export const HATS: WardrobeItem[] = HAT_LIST.map(([id, name, price]) => ({ id, name, price }));

interface Owned {
    faces: string[];
    hats: string[];
}

function read(): Owned {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(OWNED_KEY) ?? '{}') as Partial<Owned>;
        return { faces: parsed.faces ?? [], hats: parsed.hats ?? [] };
    } catch {
        return { faces: [], hats: [] };
    }
}

export const Wardrobe = {
    ownsFace(face: string): boolean {
        const equipped = SQUAD_VIEW_NAMES.some((name) => CHARACTER_VIEWS[name].face === face);
        return equipped || STARTER_FACES.includes(face) || read().faces.includes(face);
    },

    ownsHat(hat: string): boolean {
        const equipped = SQUAD_VIEW_NAMES.some((name) => CHARACTER_VIEWS[name].hat === hat);
        return equipped || read().hats.includes(hat);
    },

    /** Buys a face or hat; false when the money isn't there. Already owned items are free to take. */
    buy(kind: 'face' | 'hat', item: WardrobeItem): boolean {
        const owned = kind === 'face' ? this.ownsFace(item.id) : this.ownsHat(item.id);
        if (owned) {
            return true;
        }
        if (!GameState.spendMoney(item.price)) {
            return false;
        }
        const state = read();
        (kind === 'face' ? state.faces : state.hats).push(item.id);
        window.localStorage.setItem(OWNED_KEY, JSON.stringify(state));
        return true;
    },
};
