import './headlessShims';
import assert from 'node:assert/strict';
import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import { PROGRESSION_STORAGE_KEYS, resetProgressionData } from '../games/bandit-controller/game/data/ProgressionStorage';
import { UiAnim } from '../games/bandit-controller/game/ui/UiAnim';

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

try {
    for (const earlyClaim of [false, true]) {
        gsap.globalTimeline.clear().totalTime(0);
        const modal = new PIXI.Container();
        const panel = new PIXI.Container();
        const dim = new PIXI.Container();
        const claim = new PIXI.Container();
        const title = new PIXI.Container();
        panel.addChild(claim, title);
        modal.addChild(dim, panel);
        UiAnim.popIn(panel, dim);
        UiAnim.rays(panel, 100);
        UiAnim.pulse(claim);
        UiAnim.dropIn(title, 80, 0.15);
        if (!earlyClaim) {
            gsap.globalTimeline.totalTime(1);
        }
        let closed = 0;
        const [exit] = UiAnim.popOut(panel, dim, () => {
            closed++;
            modal.destroy({ children: true });
        });
        exit.totalTime(0.19);
        assert.equal(modal.destroyed, false, 'modal must outlive the longer dim fade');
        exit.totalTime(0.2);
        assert.equal(closed, 1, 'claim closes the modal exactly once');
        assert.equal(modal.destroyed, true);
        assert.doesNotThrow(() => gsap.globalTimeline.totalTime(5), 'no animation may access destroyed popup children');
        assert.equal(gsap.globalTimeline.getChildren().length, 0, 'popup idle animations must be stopped');
    }

    gsap.globalTimeline.clear().totalTime(0);
    const root = new PIXI.Container();
    UiAnim.confetti(root, 0, 0, 10);
    assert.doesNotThrow(() => {
        for (let frame = 1; frame <= 300; frame++) {
            gsap.globalTimeline.totalTime(frame / 60);
        }
    }, 'claim confetti must finish without touching destroyed pieces');
    assert.equal(root.children.length, 0, 'finished confetti must be removed');
    assert.equal(gsap.globalTimeline.getChildren().length, 0, 'confetti must not leave endless scale animations behind');
    root.destroy();
    console.log('Reward UI: early and normal claims safely close animated modals; confetti cleans up all animations');
} finally {
    gsap.globalTimeline.clear();
    gsap.ticker.sleep();
}
