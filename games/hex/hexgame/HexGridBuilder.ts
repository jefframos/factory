import * as PIXI from "pixi.js";
import { GridCellData, GridMatrix } from "./HexTypes";

export class HexGridBuilder {
    public static buildFromMatrix(matrix: GridMatrix): { data: Map<string, GridCellData>, totalSize: PIXI.Rectangle } {
        const data = new Map<string, GridCellData>();

        for (let r = 0; r < matrix.length; r++) {
            for (let q = 0; q < matrix[r].length; q++) {
                if (matrix[r][q] === 1) {
                    // CONVERT TO AXIAL immediately so the Grid matches the Clusters
                    const axialQ = q - Math.floor(r / 2);
                    const axialR = r;

                    data.set(`${axialQ},${axialR}`, {
                        id: r * matrix[r].length + q,
                        type: 1
                    });
                }
            }
        }

        // We can return an empty rectangle; HexGridView.calculateVisualPivot handles centering now
        return { data, totalSize: new PIXI.Rectangle() };
    }
}