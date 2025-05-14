
import InteractiveEventUtils from '@core/utils/InteractiveEventUtils';
import ObjectCloner from '@core/utils/ObjectCloner';
import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';

export enum ButtonState {
    STANDARD = 'standard',
    DEACTIVE = 'deactive',
    DEACTIVE_OVER = 'deactive_over',
    OVER = 'over',
    CLICK = 'click',
    DISABLED = 'disabled',
    DOWN = 'down'
}

export interface ButtonAttributes {
    fontStyle?: PIXI.TextStyle | PIXI.BitmapFont;
    textResolution?: number;
    texture?: PIXI.Texture;
    fontColor?: number;
    texturePadding?: PIXI.Rectangle; // For nine-slice
    allPadding?: number; // For nine-slice
    anchor?: PIXI.Point; // Anchor point for the button
    sound?: HTMLAudioElement; // Sound to play on state
    callback?: () => void; // Callback function to call on state
    width?: number; // Width of the button
    height?: number; // Height of the button


    fitText?: number; // Scale factor for fitting text within the button 
    textOffset?: PIXI.Point; // Offset for the text label
    textureOffset?: PIXI.Point;
    textAnchor?: PIXI.Point;

    iconTexture?: PIXI.Texture; // Texture for the icon
    iconOffset?: PIXI.Point; // Offset for the icon position
    iconSize?: { width?: number, height?: number }; // Size of the icon
    iconAnchor?: PIXI.Point; // Size of the icon

    centerIconVertically?: boolean;
    centerIconHorizontally?: boolean;
}


export interface ButtonData {
    [ButtonState.STANDARD]: ButtonAttributes;
    [ButtonState.OVER]?: ButtonAttributes;
    [ButtonState.CLICK]?: ButtonAttributes;
    [ButtonState.DOWN]?: ButtonAttributes;
    [ButtonState.DISABLED]?: ButtonAttributes;
    [ButtonState.DEACTIVE]?: ButtonAttributes;
    [ButtonState.DEACTIVE_OVER]?: ButtonAttributes;
}

export default class BaseButton extends PIXI.Container {
    protected buttonDataSet: ButtonData;
    protected button: PIXI.NineSlicePlane;
    protected _currentState: ButtonState = ButtonState.STANDARD;
    protected label?: PIXI.Text | PIXI.BitmapText; // Store the label text
    protected icon?: PIXI.Sprite; // Store the icon sprite
    protected alertIcon?: PIXI.Sprite; // Store the icon sprite
    protected hitWidth: number = 0; // Store the icon sprite
    protected hitHeight: number = 0; // Store the icon sprite

    public get currentState(): ButtonState {
        return this._currentState;
    }

    constructor(attributes: ButtonData, defaultAnchor: PIXI.Point = new PIXI.Point(0.5, 0.5)) {
        super();
        this.buttonDataSet = attributes;

        // Create the button sprite as a NineSlicePlane
        this.button = new PIXI.NineSlicePlane(PIXI.Texture.EMPTY);
        this.interactive = true;
        this.cursor = 'pointer'

        // Set default state

        // Set the anchor point
        this.updateTexturePosition(defaultAnchor);

        // Add event listeners
        InteractiveEventUtils.addPointerOver(this, this.onMouseOver.bind(this))
        InteractiveEventUtils.addPointerOut(this, this.onMouseOut.bind(this))
        InteractiveEventUtils.addClickTap(this, this.onMouseUp.bind(this))
        InteractiveEventUtils.addPointerDown(this, this.onMouseDown.bind(this))

        // Add button to container
        this.addChild(this.button);

        this.setState(ButtonState.STANDARD);


        this.updateHitArea();
    }
    public overrider(state: ButtonState, attributes: ButtonAttributes) {

        if (this.buttonDataSet[state]) {
            this.buttonDataSet[state] = ObjectCloner.clone(this.buttonDataSet[state], attributes)

            if (state == this._currentState) {
                this.setState(state);
            }
        } else {
            this.buttonDataSet[state] = { ...attributes }
        }

        this.updateHitArea();
    }
    private setState(state: ButtonState) {
        this._currentState = state;

        // Determine the attributes to use based on state fallback
        const attr = this.getAttributesForState(state);

        // Apply texture
        if (attr.texture) {
            this.button.texture = attr.texture || this.buttonDataSet[ButtonState.STANDARD].texture;
        }

        // Apply texture padding if needed (for nine-slice)
        if (attr.allPadding) {
            this.button.leftWidth = attr.allPadding;
            this.button.topHeight = attr.allPadding;
            this.button.rightWidth = attr.allPadding;
            this.button.bottomHeight = attr.allPadding;
        }
        else if (attr.texturePadding) {
            this.button.leftWidth = attr.texturePadding.left || 0;
            this.button.topHeight = attr.texturePadding.top || 0;
            this.button.rightWidth = attr.texturePadding.right || 0;
            this.button.bottomHeight = attr.texturePadding.bottom || 0;
        }

        // Apply width and height
        this.button.width = attr.width ?? this.buttonDataSet[ButtonState.STANDARD].width!;
        this.button.height = attr.height ?? this.buttonDataSet[ButtonState.STANDARD].height!;

        // Apply anchor offset
        this.updateTexturePosition(attr.anchor);

        // Apply icon settings
        if (attr.iconTexture) {
            this.setIcon(attr.iconTexture);
        }


        const centerIconH = attr.centerIconHorizontally ?? this.buttonDataSet[ButtonState.STANDARD].centerIconHorizontally!;
        const centerIconV = attr.centerIconVertically ?? this.buttonDataSet[ButtonState.STANDARD].centerIconVertically!;

        this.updateIconSettings(
            attr.iconOffset ?? this.buttonDataSet[ButtonState.STANDARD].iconOffset!,
            attr.iconSize ?? this.buttonDataSet[ButtonState.STANDARD].iconSize!,
            attr.iconAnchor ?? this.buttonDataSet[ButtonState.STANDARD].iconAnchor!,
            centerIconH,
            centerIconV
        )

        // Play sound if provided
        if (attr.sound) {
            attr.sound.play();
        }

        // Call callback if provided
        if (attr.callback) {
            attr.callback();
        }

        this.updateLabel();
    }
    public addAlertIcon(texture: PIXI.Texture, size?: number, anchor: PIXI.Point = new PIXI.Point(1, 0)) {
        if (!this.alertIcon) {
            this.alertIcon = new PIXI.Sprite(texture);
            this.addChild(this.alertIcon)
        } else {
            this.alertIcon.texture = texture
        }
        this.alertIcon.anchor.set(1, 0)
        this.alertIcon.visible = true

        if (size) {
            this.alertIcon.scale.set(ViewUtils.elementScaler(this.alertIcon, size))
        }

        if (anchor) {
            this.alertIcon.x = this.hitWidth * anchor.x
            this.alertIcon.y = this.hitHeight * anchor.y
        }

    }
    public removeAlertIcon() {
        if (this.alertIcon) {
            this.alertIcon.visible = false
        }
    }
    private getAttributesForState(state: ButtonState): ButtonAttributes {
        // Get attributes for the state, falling back if necessary
        return this.buttonDataSet[state] || this.buttonDataSet[ButtonState.STANDARD];
    }

    private onMouseOver() {
        if (this._currentState !== ButtonState.DISABLED) {
            if (this._currentState == ButtonState.DEACTIVE) {
                this.setState(ButtonState.DEACTIVE_OVER);
            } else {
                this.setState(ButtonState.OVER);
            }
        }
    }

    private onMouseOut() {
        if (this._currentState !== ButtonState.DISABLED) {
            if (this._currentState == ButtonState.DEACTIVE_OVER) {
                this.setState(ButtonState.DEACTIVE);
            } else {
                this.setState(ButtonState.STANDARD);
            }
        }
    }

    private onMouseUp() {
        if (this._currentState !== ButtonState.DISABLED) {
            this.setState(ButtonState.CLICK);
        }
    }
    private onMouseDown() {
        if (this._currentState !== ButtonState.DISABLED) {
            this.setState(ButtonState.DOWN);
        }
    }

    public deactive() {
        this.setState(ButtonState.DEACTIVE);
    }

    public active() {
        this.interactive = true;
        this.cursor = 'pointer'
        this.setState(ButtonState.STANDARD);
    }

    public enable() {
        this.interactive = true;
        this.cursor = 'pointer'
        this.setState(ButtonState.STANDARD);
    }

    public disable() {
        this.interactive = false;
        this.cursor = 'auto'
        this.setState(ButtonState.DISABLED);
    }

    public updateTexturePosition(anchor?: PIXI.Point) {
        // Update the anchor and recalculate the pivot based on current button size
        const anchorPoint = anchor || new PIXI.Point(0, 0);

        this.button.pivot.set(
            anchorPoint.x * this.button.width,
            anchorPoint.y * this.button.height
        );
        const attr = this.getAttributesForState(this._currentState);
        const textureOffset = attr.textureOffset || this.buttonDataSet[ButtonState.STANDARD].textureOffset || new PIXI.Point(0, 0);

        this.button.x = anchorPoint.x * this.button.width + textureOffset.x
        this.button.y = anchorPoint.y * this.button.height + textureOffset.y
    }
    public setLabel(text: string, fontSize?: number) {
        if (!this.label) {
            // Create label text if it doesn't exist
            const attr = this.getAttributesForState(this._currentState);
            const style = attr.fontStyle || this.buttonDataSet[ButtonState.STANDARD].fontStyle || new PIXI.TextStyle(); // Use default style if not provided

            if (style instanceof PIXI.TextStyle) {
                this.label = new PIXI.Text(text, style);
                if (attr.fontColor) {
                    this.label.style.fill = attr.fontColor
                    if (attr.textResolution) {
                        this.label.resolution = attr.textResolution;
                    }
                    if (fontSize) {
                        this.label.style.fontSize = fontSize;
                    }
                }
            } else if (style) {
                this.label = new PIXI.BitmapText(text, { fontName: style.font });
                if (attr.fontColor) {
                    this.label.tint = attr.fontColor
                }
                if (fontSize) {
                    this.label.fontSize = fontSize;
                }
            }
            if (this.label) {
                const anchor = attr.textAnchor || this.buttonDataSet[ButtonState.STANDARD].textAnchor || new PIXI.Point(0.5, 0.5)
                this.label.anchor.copyFrom(anchor); // Center the text by default
                this.addChild(this.label);
            }

            // Position the label in the center of the button
            this.updateLabel();
        } else {
            // Update the text if label already exists

            this.label.text = text;
            if (this.label instanceof PIXI.BitmapText) {
                if (fontSize) {
                    this.label.fontSize = fontSize;
                }
            }
            this.updateLabel();
        }
    }

    private updateLabel() {
        if (this.label) {
            const attr = this.getAttributesForState(this._currentState);
            if (attr.fontStyle && attr.fontStyle instanceof PIXI.TextStyle && this.label instanceof PIXI.Text) {
                this.label.style = attr.fontStyle;
                if (attr.textResolution) {
                    this.label.resolution = attr.textResolution;
                }
            }

            const anchor = attr.textAnchor || this.buttonDataSet[ButtonState.STANDARD].textAnchor || new PIXI.Point(0.5, 0.5)
            this.label.anchor.copyFrom(anchor); // Center the text by default
            // Apply text offset if provided
            const textOffset = attr.textOffset || this.buttonDataSet[ButtonState.STANDARD].textOffset || new PIXI.Point(0, 0);

            this.label.x = (this.button.width / 2) + textOffset.x;
            this.label.y = (this.button.height / 2) + textOffset.y;

            // Fit text if fitText is set
            if (attr.fitText !== undefined) {
                this.fitTextToButton(attr.fitText);
            }
        }
    }

    private fitTextToButton(scaleFactor: number) {
        if (this.label) {
            const buttonWidth = this.button.width;
            const buttonHeight = this.button.height;

            const maxWidth = buttonWidth * scaleFactor;
            const maxHeight = buttonHeight * scaleFactor;

            // Measure the current text dimensions
            const textWidth = this.label.width / this.label.scale.x;
            const textHeight = this.label.height / this.label.scale.y;

            // Scale the text if it exceeds the maximum allowed size
            if (textWidth > maxWidth || textHeight > maxHeight) {
                this.label.scale.set(ViewUtils.elementScaler(this.label, maxWidth, maxHeight));
            } else {
                // Reset scale if text fits
                this.label.scale.set(1);
            }
        }
    }
    private updateHitArea() {
        // Determine the largest button size across all states
        const sizes = Object.values(ButtonState).map(state => this.getAttributesForState(state));
        const maxWidth = Math.max(...sizes.map(attr => attr.width ?? 0));
        const maxHeight = Math.max(...sizes.map(attr => attr.height ?? 0));

        this.hitWidth = maxWidth
        this.hitHeight = maxHeight
        // Set the hit area to the largest size
        this.hitArea = new PIXI.Rectangle(0, 0, maxWidth, maxHeight);
    }
    private updateIconSettings(offset?: PIXI.Point, size?: { width?: number, height?: number }, anchor?: PIXI.Point, centerIconH?: boolean, centerIconV?: boolean) {
        if (this.icon) {
            anchor?.copyTo(this.icon.anchor)

            this.icon.x = 0;
            this.icon.y = 0;

            if (size) {
                this.icon.scale.set(ViewUtils.elementScaler(this.icon, size.width ?? this.icon.width, size.height ?? this.icon.height))
            }
            if (centerIconH) {
                this.icon.x = this.button.width / 2 - this.icon.width / 2
            }
            if (centerIconV) {
                this.icon.y = this.button.height / 2 - this.icon.height / 2
            }
            if (offset) {
                this.icon.x += offset.x;
                this.icon.y += offset.y;
            }
        }
    }
    private setIcon(texture: PIXI.Texture) {
        if (this.icon) {
            // Update existing icon if it exists
            this.icon.texture = texture;

        } else {
            // Create a new icon sprite
            this.icon = new PIXI.Sprite(texture);
            this.addChild(this.icon);
        }
    }

    public removeIcon() {
        if (this.icon) {
            this.removeChild(this.icon);
            this.icon.destroy();
            this.icon = undefined;
        }
    }
}
