import PromiseUtils from '@core/utils/PromiseUtils';
import * as PIXI from 'pixi.js';
import DialogueBubble from './DialogueBubble';
import { EmojiTextParser } from './EmojiTextParser';
import type { AvatarDefinition } from './types';


type BubbleBlock = {
    container: PIXI.Container;
    bubble: DialogueBubble;
};
export default class DialogueManager extends PIXI.Container {
    private bubbles: BubbleBlock[] = [];
    private parser: EmojiTextParser;
    private maxBubbles = 5;
    private avatarMap: Map<string, AvatarDefinition>;

    public readonly managerWidth: number = 600;
    private readonly bubbleMaxWidth: number = 500;
    private readonly avatarSize: number = 64;
    private readonly gap: number = 10;
    private readonly spacing: number = 20;
    private readonly wordSpeed: number = 0.05;
    private readonly wordDelay: number = 0;
    private readonly speechInterval: number = 500;

    constructor(
        emojiMap: Record<string, PIXI.Texture>,
        avatarDefs: AvatarDefinition[]
    ) {
        super();
        this.parser = new EmojiTextParser(emojiMap);
        this.avatarMap = new Map(avatarDefs.map(a => [a.name, a]));
    }

    public async addDialogue(text: string, speaker: string): Promise<void> {
        const avatarDef = this.avatarMap.get(speaker);
        if (!avatarDef) {
            console.warn(`No avatar found for: ${speaker}`);
        }

        let isLeft = true;
        let avatarTex = PIXI.Texture.EMPTY;

        if (avatarDef) {
            isLeft = avatarDef.position === 'left';
            avatarTex = PIXI.Texture.from(avatarDef.url);
        }

        const block = new PIXI.Container();

        // avatars setup
        const avatar = new PIXI.Sprite(avatarTex);
        avatar.width = this.avatarSize;
        avatar.height = this.avatarSize;
        avatar.y = 0;

        if (isLeft) {
            avatar.x = 0;
        } else {
            avatar.x = this.managerWidth - this.avatarSize;
        }
        block.addChild(avatar);

        ////////////bubble
        const bubble = new DialogueBubble(this.bubbleMaxWidth);
        if (isLeft) {
            bubble.x = this.avatarSize + this.gap;
        } else {
            bubble.x = this.managerWidth - this.avatarSize - this.gap - this.bubbleMaxWidth;
        }
        block.addChild(bubble);

        this.addChild(block);
        this.bubbles.push({ container: block, bubble });

        if (this.bubbles.length > this.maxBubbles) {
            const old = this.bubbles.shift()!;
            old.bubble.dispose();
            old.container.destroy({ children: true });
        }

        //parse the dialog and create a container for each word/emoji
        const elements = this.parser.parse(text, new PIXI.TextStyle({
            fontFamily: 'LEMONMILK-Bold',
            fill: 0xffffff,
            fontSize: 24,
            stroke: "#0c0808",
            strokeThickness: 4,
            wordWrap: true,
            wordWrapWidth: this.bubbleMaxWidth - bubble.padding * 2
        }));

        this.repositionBubbles()

        await bubble.showMessage(elements, this.wordSpeed, this.wordDelay);
        await PromiseUtils.await(this.speechInterval)

        this.repositionBubbles()

    }
    private repositionBubbles(): void {
        if (this.bubbles.length === 0) return;

        // Always place the newest bubble at y = 0
        const newest = this.bubbles[this.bubbles.length - 1];
        newest.container.y = 0;

        for (let i = this.bubbles.length - 2; i >= 0; i--) {
            const next = this.bubbles[i + 1]; // newer below
            const current = this.bubbles[i];
            current.container.y = next.container.y - current.bubble.height - this.spacing;
        }
    }


    public dispose(): void {
        for (const { container, bubble } of this.bubbles) {
            bubble.dispose();
            container.destroy({ children: true });
        }
        console.log('DISPOSE, this should remove all tweens for the bubble')
        this.bubbles = [];
    }
}
