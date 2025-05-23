
import { Game } from "@core/Game";
import ViewUtils from "@core/utils/ViewUtils";
import TiledLayerObject from "./TiledLayerObject";

export default class TiledAutoPositionObject extends TiledLayerObject {

    update(delta: number): void {
        let targetScale = this.scaleToFit
            ? ViewUtils.elementScalerBySize(this.bounds.width, this.bounds.height, Game.gameScreenData.bottomRight.x, Game.gameScreenData.bottomRight.y)
            : ViewUtils.elementEvelopBySize(this.bounds.width, this.bounds.height, Game.gameScreenData.bottomRight.x, Game.gameScreenData.bottomRight.y);

        this.container.scale.set(targetScale);
        this.container.x = Game.gameScreenData.center.x - (this.bounds.width / 2) * this.container.scale.x;
        this.container.y = Game.gameScreenData.center.y - (this.bounds.height / 2) * this.container.scale.y;
    }
}