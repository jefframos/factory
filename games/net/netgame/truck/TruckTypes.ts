import { Vector } from "matter-js";
import { TruckPart } from "./TruckEntity";

export interface TruckViewConfig {
    [TruckPart.CHASSIS]: { asset: string; anchor: Vector; size?: { width: number; height: number } };
    [TruckPart.FRONT_WHEEL]: { asset: string; anchor?: Vector };
    [TruckPart.BACK_WHEEL]: { asset: string; anchor?: Vector };
}

// Example Data (can be loaded from JSON)
export const TRUCK_ASSET_DATA: TruckViewConfig = {
    [TruckPart.CHASSIS]: {
        asset: "Button_SkillBtn_Blue",
        anchor: { x: 0.6, y: 0.5 },
        size: { width: 150, height: 50 }
    },
    [TruckPart.FRONT_WHEEL]: { asset: "BorderFrame_Round20_Single_Dark" },
    [TruckPart.BACK_WHEEL]: { asset: "BorderFrame_Round20_Single_Dark" }
};