export interface DialogueLine {
    name: string;
    text: string;
}

export interface EmojiDefinition {
    name: string;
    url: string;
}

export type AvatarPosition = 'left' | 'right';

export interface AvatarDefinition {
    name: string;
    url: string;
    position: AvatarPosition;
}

export interface DialogueData {
    dialogue: DialogueLine[];
    emojies: EmojiDefinition[];
    avatars: AvatarDefinition[];
}