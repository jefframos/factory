import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import { ProgressBar } from "@core/ui/ProgressBar";
export default class LoaderScene extends GameScene {
    protected progressBar = new ProgressBar({ width: 300, height: 24 });
    public build() {

        this.addChild(this.progressBar);
        // spawn player, enemies...
    }
    public destroy() {
        // clean up...
    }
    public updateLoader(percent: number) {
        this.progressBar.update(percent);
    }
    public update(delta: number) {
        // game logic...
        this.x = Game.gameScreenData?.center.x ?? 0;
        this.y = Game.gameScreenData?.center.y ?? 0;
    }
}