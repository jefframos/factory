import * as PIXI from 'pixi.js';
export type CharacterAnimationData = {
    name: string;
    frames: string[]; // sprite IDs
    frameRate: number; // frames per second
    loop?: boolean;
};

export type PieceData = {
    id: string;
    idle: CharacterAnimationData;
    walk: CharacterAnimationData;
};

export class CharacterTable {
    public static characters: PieceData[] = [];

    public static getCharacter(index: number): PieceData {
        return CharacterTable.characters[index];
    }

    public static load(characters: PieceData[]) {
        CharacterTable.characters = characters;
    }
}

export function generateFrames(base: string, start: number, end: number): string[] {
    const match = base.match(/^(.*?)(\d{2})$/);
    if (!match) throw new Error(`Invalid base format: ${base}`);

    const prefix = match[1];
    const digitCount = match[2].length;

    const frames: string[] = [];
    for (let i = start; i <= end; i++) {
        const frame = `${prefix}${i.toString().padStart(digitCount, '0')}`;
        frames.push(frame);
    }
    return frames;
}

export const Fonts = {
    Main: new PIXI.TextStyle({
        fontFamily: 'LEMONMILK-Bold',
        fontSize: 32,
        fill: 0xffffff,
        align: 'center',
        stroke: 0,
        strokeThickness: 8

    })
} as const;


export const CharacterTableData: PieceData[] = [
    {
        id: "doge",
        idle: {
            name: "idle",
            frames: generateFrames("meme-small-10000", 1, 6),
            frameRate: 10,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-small-10000", 7, 24),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "shark",
        idle: {
            name: "idle",
            frames: generateFrames("meme-small-20000", 1, 6),
            frameRate: 10,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-small-20000", 7, 24),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "grumps",
        idle: {
            name: "idle",
            frames: generateFrames("meme-small-30000", 1, 6),
            frameRate: 10,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-small-30000", 7, 24),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "toilet",
        idle: {
            name: "idle",
            frames: generateFrames("meme-small-40000", 1, 8),
            frameRate: 6,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-small-40000", 1, 8),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "pepe",
        idle: {
            name: "idle",
            frames: generateFrames("meme-10000", 2, 2),
            frameRate: 6,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-10000", 1, 12),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "woj",
        idle: {
            name: "idle",
            frames: generateFrames("meme-20000", 2, 2),
            frameRate: 6,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-20000", 1, 12),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "woj2",
        idle: {
            name: "idle",
            frames: generateFrames("meme-30000", 2, 2),
            frameRate: 6,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-30000", 1, 12),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "woj3",
        idle: {
            name: "idle",
            frames: generateFrames("meme-40000", 2, 2),
            frameRate: 6,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-40000", 1, 12),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "woj4",
        idle: {
            name: "idle",
            frames: generateFrames("meme-50000", 2, 2),
            frameRate: 6,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-50000", 1, 12),
            frameRate: 15,
            loop: true
        }
    },
    {
        id: "woj5",
        idle: {
            name: "idle",
            frames: generateFrames("meme-60000", 2, 2),
            frameRate: 6,
            loop: true
        },
        walk: {
            name: "walk",
            frames: generateFrames("meme-60000", 1, 12),
            frameRate: 15,
            loop: true
        }
    },
]