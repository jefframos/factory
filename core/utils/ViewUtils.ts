import * as PIXI from 'pixi.js';
export default class ViewUtils {
    //get converted scaled based on the percentage of the width and height on the screen
    public static elementScaler(element: PIXI.Container, widthTarget: number, heightTarget: number = 0): number {
        if (!heightTarget) {
            heightTarget = widthTarget;
        }
        return Math.min(Math.abs(widthTarget / element.width * element.scale.x), Math.abs(heightTarget / element.height * element.scale.y));
    }


    //get converted scaled based on the percentage of the width and height on the screen
    public static elementScalerBySize(width: number, height: number, widthTarget: number, heightTarget: number): number {
        return Math.min(widthTarget / width, heightTarget / height);
    }
    public static elementEvelopBySize(width: number, height: number, widthTarget: number, heightTarget: number): number {
        return Math.max(widthTarget / width, heightTarget / height);
    }

    public static elementEvelop(element: PIXI.Container, widthTarget: number, heightTarget: number = 0): number {
        if (!heightTarget) {
            heightTarget = widthTarget;
        }
        return Math.max(Math.abs(widthTarget / element.width * element.scale.x), Math.abs(heightTarget / element.height * element.scale.y));
    }
}