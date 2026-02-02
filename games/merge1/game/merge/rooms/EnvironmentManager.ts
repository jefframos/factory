// manager/EnvironmentManager.ts
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledContainer from "@core/tiled/TiledContainer";
import * as PIXI from "pixi.js";
import { RoomId, RoomRegistry } from "../rooms/RoomRegistry";

export class EnvironmentManager {
    constructor(
        private readonly floorContainer: PIXI.Container,
        private readonly foregroundContainer: PIXI.Container,
        private readonly setBackgroundCallback: (bg: TiledContainer) => void
    ) { }

    public updateEnvironment(roomId: RoomId): PIXI.Rectangle {
        const config = RoomRegistry.get(roomId);
        console.log(config)
        const mapKey = config.mapId;
        const tiledData = ExtractTiledFile.getTiledFrom('garden');

        // 1. Clear existing visuals
        this.floorContainer.removeChildren().forEach(c => c.destroy());
        this.foregroundContainer.removeChildren().forEach(c => c.destroy());

        // 2. Create and Add Floor
        const floor = new TiledContainer(tiledData, ['Floor-' + mapKey]);
        this.floorContainer.addChild(floor);

        // 3. Create and Add Foreground
        const foreground = new TiledContainer(tiledData, ['Foreground-' + mapKey]);
        this.foregroundContainer.addChild(foreground);

        // 4. Update Background via Mediator Callback
        const background = new TiledContainer(tiledData, ['Background-' + mapKey]);
        this.setBackgroundCallback(background);

        // 5. Return new bounds for the room
        const walkArea = tiledData?.settings?.objects?.find((v: any) => v.name == 'WalkArea');
        return new PIXI.Rectangle(
            walkArea?.x ?? 0,
            walkArea?.y ?? 0,
            walkArea?.width ?? 800,
            walkArea?.height ?? 800
        );
    }
}