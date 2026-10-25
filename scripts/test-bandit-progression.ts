import assert from 'node:assert/strict';
import { PROGRESSION_STORAGE_KEYS, resetProgressionData } from '../games/bandit-controller/game/data/ProgressionStorage';

const preserved = ['bandit-controller.muted', 'other-game.money', 'daybreak-debug-overlay'];
const values = new Map<string, string>([...PROGRESSION_STORAGE_KEYS, ...preserved].map((key) => [key, 'saved']));
const removed: string[] = [];
const storage = {
    removeItem(key: string): void {
        removed.push(key);
        values.delete(key);
    },
};
resetProgressionData(storage);
assert.deepEqual(removed, [...PROGRESSION_STORAGE_KEYS]);
assert.equal(values.size, preserved.length);
for (const key of preserved) assert.equal(values.get(key), 'saved');
resetProgressionData(storage);
assert.equal(values.size, preserved.length, 'reset must be idempotent');
assert.throws(() => resetProgressionData({
    removeItem(): void { throw new Error('Storage denied'); },
}), /Storage denied/, 'storage failures must be surfaced to the caller');
console.log('Progression reset: exact game keys removed; sound and unrelated data preserved; failures surfaced');
