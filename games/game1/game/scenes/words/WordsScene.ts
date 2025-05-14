import { Game } from '@core/Game';
import PromiseUtils from '@core/utils/PromiseUtils';
import * as PIXI from 'pixi.js';
import BaseDemoScene from "../BaseDemoScene";
import DialogueManager from './DialogueManager';
import type { DialogueData } from './types';
export async function fetchDialogueData(): Promise<DialogueData> {
    const res = await fetch('https://private-624120-softgamesassignment.apiary-mock.com/v2/magicwords');
    if (!res.ok) throw new Error(`Failed to fetch dialogue: ${res.statusText}`);
    return await res.json();
}
export default class WordsScene extends BaseDemoScene {
    private dialogueManager!: DialogueManager;
    private data!: DialogueData;

    constructor() {
        super();
    }

    public async build(): Promise<void> {
        this.data = await fetchDialogueData();

        // Load all images
        await this.loadAllImages(this.data);

        // Create the manager
        const emojiMap: Record<string, PIXI.Texture> = {};
        for (const emoji of this.data.emojies) {
            emojiMap[emoji.name] = PIXI.Texture.from(emoji.url);
        }

        this.dialogueManager = new DialogueManager(emojiMap, this.data.avatars);
        this.addChild(this.dialogueManager);

        this.runDialogue();
    }

    public destroy(): void {
        this.dialogueManager?.dispose();
    }

    public update(delta: number): void {
        super.update(delta);
        if (this.dialogueManager) {

            this.dialogueManager.x = Game.DESIGN_WIDTH / 2 - this.dialogueManager.managerWidth / 2
            this.dialogueManager.y = Game.DESIGN_HEIGHT - 250
        }
    }

    private async loadAllImages(data: DialogueData): Promise<void> {
        const urls = [
            ...data.emojies.map(e => e.url),
            ...data.avatars.map(a => a.url),
        ];

        const promises = urls.map(url => new Promise<void>((resolve, reject) => {
            const texture = PIXI.Texture.from(url);
            if (texture.baseTexture.valid) return resolve(); // already cached

            texture.baseTexture.once('loaded', resolve);
            texture.baseTexture.once('error', reject);
        }));

        await Promise.all(promises);
    }

    private async runDialogue(): Promise<void> {
        for (const entry of this.data.dialogue) {
            await this.dialogueManager.addDialogue(entry.text, entry.name);
            await PromiseUtils.await(300); //<- delay between lines
        }
    }

}
