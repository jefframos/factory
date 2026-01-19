import * as PIXI from 'pixi.js';
export type CharacterAnimationData = {
    name: string;
    frame: string | string[]; // sprite IDs
    frameRate: number; // frames per second
    loop?: boolean;
    first?: number;
    last?: number;
};

export type PieceViewData = {
    id: string;
    tile?: string;
    fit?: boolean;
    idle: CharacterAnimationData;
    walk: CharacterAnimationData;
};

export class CharacterTable {
    public static characters: PieceViewData[] = [];

    public static getCharacter(index: number): PieceViewData {
        return CharacterTable.characters[index];
    }

    public static load(characters: PieceViewData[]) {
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

export function convertCharacterSetTable(raw: PieceViewData[]): PieceViewData[] {
    const copy: PieceViewData[] = raw.map(p => ({ ...p, idle: { ...p.idle }, walk: { ...p.walk } }));

    copy.forEach(element => {
        if (typeof element.idle.frame === "string") {
            const source = element.idle.frame;
            if (element.idle.first === undefined || element.idle.last === undefined) {
                element.idle.frame = [source];
            } else {
                element.idle.frame = generateFrames(source, element.idle.first, element.idle.last);
            }
        }

        if (typeof element.walk.frame === "string") {
            const source = element.walk.frame;
            if (element.walk.first === undefined || element.walk.last === undefined) {
                element.walk.frame = [source];
            } else {
                element.walk.frame = generateFrames(source, element.walk.first, element.walk.last);
            }
        }
    });

    return copy;
}

const MainFamily = 'LEMONMILK-Bold';
export const Fonts = {
    MainFamily: MainFamily,
    Main: new PIXI.TextStyle({
        fontFamily: MainFamily,
        fontSize: 32,
        fill: 0xffffff,
        align: 'center',
        stroke: 0x4b2a19,
        strokeThickness: 6

    })
} as const;
