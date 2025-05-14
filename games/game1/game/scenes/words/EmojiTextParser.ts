import * as PIXI from 'pixi.js';

export class EmojiTextParser {
    constructor(private emojiMap: Record<string, PIXI.Texture>) { }

    parse(text: string, style: PIXI.TextStyle): PIXI.Container[] {
        const elements: PIXI.Container[] = [];

        const regex = /\{([a-zA-Z0-9_]+)\}|([^{]+)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            if (match[1]) {
                // Emoji match: {happy}
                const emojiTexture = this.emojiMap[match[1]];
                if (emojiTexture) {
                    const emoji = new PIXI.Sprite(emojiTexture);
                    const size = style.fontSize as number;
                    emoji.width = emoji.height = size;
                    elements.push(emoji);
                }
            } else if (match[2]) {
                // Text chunk match: split into words
                const words = match[2].split(/(\s+)/); // keep spaces
                for (const word of words) {
                    if (word.trim() === '' && !word.includes(' ')) continue; // skip weird empty strings
                    const textObj = new PIXI.Text(word, style);
                    elements.push(textObj);
                }
            }
        }

        return elements;
    }
}
