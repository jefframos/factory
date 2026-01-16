import * as PIXI from "pixi.js";
import { JigsawPiece } from "./JigsawPiece";

let _clusterId = 0;

export class JigsawCluster {
    public readonly id: number = ++_clusterId;
    public readonly container: PIXI.Container = new PIXI.Container();
    public readonly pieces: Set<JigsawPiece> = new Set();

    public addPiece(piece: JigsawPiece): void {
        this.pieces.add(piece);
        piece.cluster = this;
        this.container.addChild(piece);
    }
}
