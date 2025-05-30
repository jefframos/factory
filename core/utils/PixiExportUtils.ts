import { Game } from '@core/Game';
import * as PIXI from 'pixi.js';

export class PixiExportUtils {
    static exportContainerAsImage(container: PIXI.Container, width: number, height: number, fileName = 'image.png'): void {
        const renderer = Game.renderer;

        // Create an off-screen render texture
        const renderTexture = PIXI.RenderTexture.create({ width, height });

        // Render the container into that texture
        renderer.render(container, { renderTexture });

        // Extract canvas from the render texture
        const canvas = renderer.extract.canvas(renderTexture);

        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/png');

        // Trigger download
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = fileName;
        link.click();

        // Clean up
        renderTexture.destroy(true);
    }
}
