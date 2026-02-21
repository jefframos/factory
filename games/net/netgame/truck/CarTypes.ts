import { Vector } from "matter-js";
import { CarPart } from "./CarEntity";

export interface CarViewConfig {
    [CarPart.CHASSIS]: { asset: string; anchor: Vector; size?: { width: number; height: number } };
    [CarPart.FRONT_WHEEL]: { asset: string; anchor?: Vector };
    [CarPart.BACK_WHEEL]: { asset: string; anchor?: Vector };
}

// Example Data (can be loaded from JSON)
export const CAR_ASSET_DATA: CarViewConfig = {
    [CarPart.CHASSIS]: {
        asset: "Button_SkillBtn_Blue",
        anchor: { x: 0.6, y: 0.5 },
        size: { width: 150, height: 50 }
    },
    [CarPart.FRONT_WHEEL]: { asset: "BorderFrame_Round20_Single_Dark" },
    [CarPart.BACK_WHEEL]: { asset: "BorderFrame_Round20_Single_Dark" }
};