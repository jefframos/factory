import * as PIXI from 'pixi.js';

export class TruckView {
    public static draw(container: PIXI.Container) {
        const chassisGfx = new PIXI.Graphics();

        // 1. Draw Chassis (Main Body)
        chassisGfx.beginFill(0x3366ff); // Blue Truck
        chassisGfx.drawRect(-60, -20, 120, 40);
        chassisGfx.endFill();

        // 2. Draw Cabin
        chassisGfx.beginFill(0x2244aa);
        chassisGfx.drawRect(0, -50, 50, 30); // Cabin sits on top right
        chassisGfx.endFill();

        // 3. Draw Windows
        chassisGfx.beginFill(0x88ccff);
        chassisGfx.drawRect(25, -45, 20, 20);
        chassisGfx.endFill();

        // 4. Draw Wheels
        chassisGfx.beginFill(0x333333); // Dark Gray Tires
        chassisGfx.drawCircle(-40, 25, 15);
        chassisGfx.drawCircle(40, 25, 15);
        chassisGfx.endFill();

        // 5. Draw Hubcaps (so we can see rotation)
        chassisGfx.beginFill(0xcccccc);
        chassisGfx.drawRect(-42, 23, 4, 4);
        chassisGfx.drawRect(38, 23, 4, 4);
        chassisGfx.endFill();

        container.addChild(chassisGfx);
    }
}