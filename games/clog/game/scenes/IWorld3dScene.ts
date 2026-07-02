import type { BotParams } from '../ai/Blackboard';

export interface IWorld3dScene {
    moveInput: { x: number; z: number };
    cameraZoom: number;
    readonly playerValue: number;
    readonly playerScore: number;
    readonly playerPosition: { x: number; z: number };
    readonly currentRoomIndex: number;
    readonly nextGateValue: number;
    build(): Promise<void>;
    update(delta: number): void;
    destroy(): void;
    debugDoublePlayerValue(): void;
    spawnBot(value: number, params?: Partial<BotParams>): void;
}
