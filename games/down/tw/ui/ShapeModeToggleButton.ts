// ShapeModeToggleButton.ts

import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import Assets from '../../Assets';
import type { PieceShapeMode } from '../PieceShapeMode';

const BG_TEXTURE = 'Button01_s_White_Light1';
const BG_SLICE = 30;
const PADDING_X = 24;
const PADDING_Y = 10;

/**
 * Top-left "Circles / Cubes" toggle — an experimental switch to try the
 * whole merge chain rendered as plain cubes instead of the default circle
 * pieces (see PieceShapeMode). Same NineSlicePlane-bubble-with-centered-text
 * look TowerHeader already uses, so it reads as part of the same HUD family
 * rather than a one-off control.
 *
 * Purely a dumb button — dispatches onToggle with whichever mode it now
 * shows; IslandViewScene is what actually calls setPieceShapeMode() and
 * resets the run, same as GameOverPopup's Replay button already does for a
 * fresh start.
 */
export class ShapeModeToggleButton extends PIXI.Container {
    public readonly onToggle: Signal = new Signal();

    private readonly bg: PIXI.NineSlicePlane;
    private readonly label: PIXI.Text;
    private mode: PieceShapeMode = 'circle';

    public constructor() {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BG_TEXTURE),
            BG_SLICE, BG_SLICE, BG_SLICE, BG_SLICE,
        );
        this.addChild(this.bg);

        this.label = new PIXI.Text('', Assets.TextStyles.NextLabel);
        this.label.anchor.set(0.5, 0.5);
        this.addChild(this.label);

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', this.handleTap, this);

        this.refresh();
    }

    private handleTap(): void {
        this.mode = this.mode === 'circle' ? 'cube' : 'circle';
        this.refresh();
        this.onToggle.dispatch(this.mode);
    }

    private refresh(): void {
        this.label.text = this.mode === 'circle' ? '● Circles' : '■ Cubes';

        this.bg.width = this.label.width + PADDING_X * 2;
        this.bg.height = this.label.height + PADDING_Y * 2;
        this.bg.position.set(0, 0);
        this.label.position.set(this.bg.width * 0.5, this.bg.height * 0.5);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onToggle.removeAll();
        super.destroy(options ?? { children: true });
    }
}
